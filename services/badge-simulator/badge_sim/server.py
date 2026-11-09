"""badge-control: the internal service on port 8090 that survives a Station A outage.

Contract routes (contracts/openapi.yaml, badge.v1.schema.json):
  POST /internal/radar/diagnose
  POST /internal/badges/reroute        (Idempotency-Key)
  GET  /internal/badges/jobs/{job_id}
Service routes: GET /healthz, GET /readyz.
Station routes, used by station pods in the split deployment (BADGE_ROLE=station):
  GET  /internal/stations/{id}[?status=pending]   heartbeat age and queue
  POST /internal/stations/{id}/heartbeat
  POST /internal/stations/{id}/jobs/{job_id}/complete   {"pdf_ref"}
  PUT  /internal/pdfs/{pdf_ref}                   PDF bytes, first write wins
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
from urllib.parse import parse_qs, unquote, urlsplit

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
        self.station_ids = tuple(settings.stations)
        # Stations running in this process. In the control role they run in their own pods.
        local = self.station_ids if settings.role == "all" else ()
        self.stations = {sid: Station(sid, settings, self.store, self.artifacts, self.outbox, clock) for sid in local}
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
        self._local(station_id).stop()

    def recover(self, station_id):
        self._local(station_id).start()

    def _local(self, station_id):
        self._known(station_id)
        if station_id not in self.stations:
            raise ApiError(409, "invalid_transition",
                           f"{station_id} runs in its own pod; scale Deployment badge-{station_id} instead")
        return self.stations[station_id]

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
        for sid in self.station_ids:
            last = self.store.last_heartbeat(sid)
            stations[sid] = {
                "running": self.stations[sid].running if sid in self.stations else None,
                "heartbeat_age_s": None if last is None else round(now - last, 1),
                "online": self.is_online(sid),
            }
        return {
            "role": self.settings.role,
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
        if station_id not in self.station_ids:
            raise ApiError(403, "forbidden", f"station {station_id} is outside namespace {self.settings.namespace}")

    # Station-facing operations (station pods call these) ------------------

    def station_heartbeat(self, station_id):
        self._known(station_id)
        self.store.heartbeat(station_id)
        return {}

    def station_view(self, station_id, status=None):
        self._known(station_id)
        if status not in (None, "pending", "complete"):
            raise ApiError(422, "invalid_payload", "status must be pending or complete")
        now = self.clock()
        last = self.store.last_heartbeat(station_id)
        jobs = [
            {**_job_view(job), "run_id": job["run_id"], "age_s": now - job["created_at"]}
            for job in self.store.list_jobs(station_id=station_id, status=status)
        ]
        return {"station_id": station_id, "heartbeat_age_s": None if last is None else now - last, "jobs": jobs}

    def station_complete(self, station_id, job_id, body):
        self._known(station_id)
        pdf_ref = _id((body or {}).get("pdf_ref") if isinstance(body, dict) else None, "pdf_ref")
        if not self.artifacts.exists(pdf_ref):
            raise ApiError(409, "invalid_transition", f"{pdf_ref} has not been uploaded")
        return {"completed": self.store.complete_job(job_id, station_id, pdf_ref)}

    def put_pdf(self, pdf_ref, data):
        if not PDF_REF.match(pdf_ref):
            raise ApiError(422, "invalid_payload", "pdf reference must look like pdf-<job_id>")
        if not data.startswith(b"%PDF-"):
            raise ApiError(422, "invalid_payload", "body must be a PDF")
        self.artifacts.put(pdf_ref, data)
        return {"pdf_ref": pdf_ref}


PDF_REF = re.compile(r"^pdf-[A-Za-z0-9_.-]{1,120}$")
STATION_ROUTE = re.compile(r"^/internal/stations/([^/]+)(/heartbeat|/jobs/([^/]+)/complete)?$")
PDF_ROUTE = re.compile(r"^/internal/pdfs/([^/]+)$")


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

        def do_PUT(self):
            self._dispatch("PUT")

        def _dispatch(self, method):
            parts = urlsplit(self.path)
            path, self.query = parts.path, parse_qs(parts.query)
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
            match = STATION_ROUTE.match(path)
            if match:
                station_id, action, job_id = unquote(match.group(1)), match.group(2), match.group(3)
                if method == "GET" and not action:
                    return 200, app.station_view(station_id, (self.query.get("status") or [None])[0])
                if method == "POST" and action == "/heartbeat":
                    self._raw()  # drain any body so the connection stays clean
                    return 200, app.station_heartbeat(station_id)
                if method == "POST" and job_id:
                    return 200, app.station_complete(station_id, unquote(job_id), self._body())
            match = PDF_ROUTE.match(path)
            if method == "PUT" and match:
                return 201, app.put_pdf(unquote(match.group(1)), self._raw())
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

        def _raw(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise ApiError(422, "invalid_payload", "Content-Length must be an integer") from None
            if length < 0 or length > 64 * 1024:
                raise ApiError(422, "invalid_payload", "Content-Length must be between 0 and 65536")
            return self.rfile.read(length) if length else b""

        def _body(self, allow_empty=False):
            raw = self._raw()
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
    handler = make_station_handler(app) if isinstance(app, StationApp) else make_handler(app)
    return ThreadingHTTPServer((host, port), handler)


class StationApp:
    """One station in its own pod. badge-control holds its queue and PDFs."""

    def __init__(self, settings, clock=time.time):
        from .remote import ControlClient, RemoteArtifacts, RemoteStore

        if settings.station_id not in settings.stations:
            raise ValueError(f"BADGE_STATION_ID={settings.station_id!r} is not a known station")
        if not settings.internal_token:
            raise ValueError("BADGE_INTERNAL_TOKEN must be set")
        self.settings = settings
        client = ControlClient(settings.control_url, settings.internal_token)
        self.outbox = SignalOutbox(settings.incident_api_base_url, settings.signal_token)
        self.station = Station(
            settings.station_id, settings, RemoteStore(client, clock), RemoteArtifacts(client), self.outbox, clock
        )

    def start(self):
        self.outbox.start()
        self.station.start()

    def stop(self):
        self.station.stop()
        self.outbox.stop()


def make_station_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "badge-station/1"

        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/healthz":
                status, payload = 200, {"status": "ok"}
            elif path == "/readyz" and app.station.running:
                status, payload = 200, {"status": "ok"}
            else:
                status, payload = 404, {"error": {"code": "not_found", "message": "no such route"}}
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def build_app(settings, clock=time.time):
    if settings.role == "station":
        return StationApp(settings, clock)
    if settings.role in ("all", "control"):
        return BadgeApp(settings, clock)
    raise ValueError(f"BADGE_ROLE={settings.role!r} must be all, control or station")
