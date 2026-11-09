"""badge-control: the internal service on port 8090 that survives a Station A outage.

Contract routes (contracts/openapi.yaml, badge.v1.schema.json):
  POST /internal/radar/diagnose
  POST /internal/badges/reroute        (Idempotency-Key)
  GET  /internal/badges/jobs/{job_id}
Service routes: GET /healthz, GET /readyz.
Rehearsal-only routes, enabled by BADGE_ADMIN_ENABLED=true:
  GET /admin/state, POST /admin/seed, /admin/fault, /admin/recover, /admin/reset
"""

import hashlib
import hmac
import json
import logging
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from radar import RadarDiagnoser

from . import SEED_JOB_IDS, tracing
from .signals import SignalOutbox
from .station import Station
from .store import ArtifactStore, JobConflict, MemoryStore

log = logging.getLogger("badge_sim.server")
ID_MAX = 128


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class BadgeApp:
    """Store, stations, signal outbox and Radar adapter for one process."""

    def __init__(self, settings, clock=time.time):
        self.settings = settings
        self.clock = clock
        if settings.store != "mock":
            raise ValueError(f"BADGE_STORE={settings.store!r} is not implemented yet; use mock")
        self.store = MemoryStore(clock)
        root = Path(settings.artifact_dir or tempfile.mkdtemp(prefix="badge-sim-"))
        self.artifacts = ArtifactStore(root / "pdf")
        self.outbox = SignalOutbox(settings.incident_api_base_url, settings.signal_token)
        self.stations = {
            sid: Station(sid, settings, self.store, self.artifacts, self.outbox, clock) for sid in settings.stations
        }
        self.diagnoser = RadarDiagnoser(settings, self.store, clock, root / "evidence")
        self._lock = threading.Lock()

    def start(self):
        self.outbox.start()
        for station in self.stations.values():
            station.start()

    def stop(self):
        for station in self.stations.values():
            station.stop()
        self.outbox.stop()

    # Simulator controls ---------------------------------------------------

    def seed(self, station_id="station-a", job_ids=SEED_JOB_IDS):
        self._known(station_id)
        return [self.store.put_job(job_id, station_id) for job_id in job_ids]

    def fault(self, station_id):
        self._known(station_id)
        self.stations[station_id].stop()

    def recover(self, station_id):
        self._known(station_id)
        self.stations[station_id].start()

    def reset(self):
        for station in self.stations.values():
            station.stop()
        self.store.reset()
        self.outbox.reset()
        for station in self.stations.values():
            station.start()  # start() also begins a new run of signal IDs

    def state(self):
        now = self.clock()
        stations = {}
        for sid, station in self.stations.items():
            last = self.store.last_heartbeat(sid)
            stations[sid] = {
                "running": station.running,
                "heartbeat_age_s": None if last is None else round(now - last, 1),
                "online": self.is_online(sid),
            }
        return {
            "store": self.store.label,
            "radar_mode": self.settings.radar_mode,
            "stations": stations,
            "jobs": [_job_view(job) for job in self.store.list_jobs()],
            "signals_pending": self.outbox.pending_count(),
            "signals_delivered": len(self.outbox.delivered),
        }

    def is_online(self, station_id):
        last = self.store.last_heartbeat(station_id)
        return last is not None and self.clock() - last <= self.settings.heartbeat_timeout

    # Contract operations --------------------------------------------------

    def diagnose(self, body):
        body = _validate(body, required=("incident_id", "station_id"))
        self._known(body["station_id"])
        with tracing.span("radar.diagnose", incident_id=body["incident_id"], station_id=body["station_id"]):
            return self.diagnoser.diagnose(body["incident_id"], body["station_id"])

    def reroute(self, body, idempotency_key):
        if not idempotency_key or len(idempotency_key) > ID_MAX:
            raise ApiError(422, "invalid_payload", "Idempotency-Key header is required")
        body = _validate(body, required=("incident_id", "from_station_id", "to_station_id", "job_ids"))
        source, target, job_ids = body["from_station_id"], body["to_station_id"], body["job_ids"]
        self._known(source)
        self._known(target)
        if source == target:
            raise ApiError(422, "invalid_payload", "from_station_id and to_station_id must differ")
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        scope = body["incident_id"]
        with self._lock:
            previous = self.store.recall(scope, idempotency_key)
            if previous is not None:
                if previous[0] != fingerprint:
                    raise ApiError(409, "idempotency_conflict", "Idempotency-Key was used with a different request")
                return previous[1]
            if not self.is_online(target):
                raise ApiError(409, "invalid_transition", f"{target} is not online")
            with tracing.span("badge.reroute", incident_id=scope, station_id=target):
                try:
                    accepted = self.store.reassign(job_ids, source, target)
                except JobConflict as error:
                    raise ApiError(422, "invalid_payload", str(error)) from None
            response = {"accepted_job_ids": accepted}
            self.store.remember(scope, idempotency_key, fingerprint, response)
            log.info("rerouted %s from %s to %s for %s", accepted, source, target, scope)
            return response

    def job(self, job_id):
        job = self.store.get_job(job_id)
        if job is None:
            raise ApiError(404, "not_found", f"job {job_id} not found")
        return _job_view(job)

    def _known(self, station_id):
        if station_id not in self.stations:
            raise ApiError(403, "forbidden", f"station {station_id} is outside namespace {self.settings.namespace}")


def _job_view(job):
    return {key: job[key] for key in ("job_id", "station_id", "status", "pdf_ref")}


def _id(value, name):
    if not isinstance(value, str) or not 1 <= len(value) <= ID_MAX:
        raise ApiError(422, "invalid_payload", f"{name} must be a string of 1-{ID_MAX} characters")
    return value


def _validate(body, required):
    if not isinstance(body, dict):
        raise ApiError(422, "invalid_payload", "body must be a JSON object")
    extra = set(body) - set(required)
    missing = [key for key in required if key not in body]
    if missing or extra:
        raise ApiError(422, "invalid_payload", f"missing {missing or 'none'}, unexpected {sorted(extra) or 'none'}")
    for key in required:
        if key == "job_ids":
            ids = body[key]
            if not isinstance(ids, list) or not ids or len(set(map(str, ids))) != len(ids):
                raise ApiError(422, "invalid_payload", "job_ids must be a non-empty list of unique IDs")
            for item in ids:
                _id(item, "job_ids[]")
        else:
            _id(body[key], key)
    return body


JOB_ROUTE = re.compile(r"^/internal/badges/jobs/([^/]+)$")


def make_handler(app):
    settings = app.settings

    class Handler(BaseHTTPRequestHandler):
        server_version = "badge-control/1"

        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def _dispatch(self, method):
            path = urlsplit(self.path).path
            parent = tracing.extract(self.headers)
            try:
                with tracing.span(f"{method} {path}", parent=parent):
                    status, payload = self._route(method, path)
            except ApiError as error:
                status, payload = error.status, {"error": {"code": error.code, "message": error.message}}
            except Exception:  # noqa: BLE001 - never leak a stack trace to callers
                log.exception("unhandled error on %s %s", method, path)
                status, payload = 500, {"error": {"code": "internal", "message": "internal error"}}
            self._send(status, payload)

        def _route(self, method, path):
            if method == "GET" and path == "/healthz":
                return 200, {"status": "ok"}
            if method == "GET" and path == "/readyz":
                return 200, {"status": "ok"}
            self._authorize()
            if method == "POST" and path == "/internal/radar/diagnose":
                return 200, app.diagnose(self._body())
            if method == "POST" and path == "/internal/badges/reroute":
                return 202, app.reroute(self._body(), self.headers.get("Idempotency-Key"))
            match = JOB_ROUTE.match(path)
            if method == "GET" and match:
                return 200, app.job(unquote(match.group(1)))
            if settings.admin_enabled and path.startswith("/admin/"):
                return self._admin(method, path)
            raise ApiError(404, "not_found", "no such route")

        def _admin(self, method, path):
            if method == "GET" and path == "/admin/state":
                return 200, app.state()
            if method != "POST":
                raise ApiError(404, "not_found", "no such route")
            body = self._body(allow_empty=True) or {}
            station_id = body.get("station_id", "station-a")
            if path == "/admin/seed":
                app.seed(station_id, tuple(body.get("job_ids") or SEED_JOB_IDS))
            elif path == "/admin/fault":
                app.fault(station_id)
            elif path == "/admin/recover":
                app.recover(station_id)
            elif path == "/admin/reset":
                app.reset()
            else:
                raise ApiError(404, "not_found", "no such route")
            return 200, app.state()

        def _authorize(self):
            header = self.headers.get("Authorization", "")
            token = header[7:] if header.startswith("Bearer ") else ""
            if not settings.internal_token or not token:
                raise ApiError(401, "unauthorized", "missing service credential")
            if not hmac.compare_digest(token.encode(), settings.internal_token.encode()):
                raise ApiError(401, "unauthorized", "invalid service credential")

        def _body(self, allow_empty=False):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise ApiError(422, "invalid_payload", "Content-Length must be an integer") from None
            if length < 0 or length > 64 * 1024:
                raise ApiError(422, "invalid_payload", "Content-Length must be between 0 and 65536")
            raw = self.rfile.read(length) if length else b""
            if not raw and allow_empty:
                return None
            try:
                return json.loads(raw)
            except ValueError:
                raise ApiError(422, "invalid_payload", "body must be JSON") from None

        def _send(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def serve(app, host, port):
    """Create the HTTP server (caller runs serve_forever)."""
    return ThreadingHTTPServer((host, port), make_handler(app))
