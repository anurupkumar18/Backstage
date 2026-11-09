"""Local A-to-B failover smoke test.

Starts badge-control with both stations and a recording incident-API stub
(its first signal post fails with 503 to exercise retries), then:
stop Station A -> seed three jobs on A -> B reports A offline -> diagnose ->
reroute (and replay the same Idempotency-Key) -> B prints all three PDFs ->
the stub receives one completion signal per job. Every payload is checked
against the shared contracts.
"""

import json
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from . import SEED_JOB_IDS
from .config import Settings
from .contract import validators
from .server import BadgeApp, serve
from .signals import wait_until

TOKEN = "smoke-internal-token"
INCIDENT = "inc-badge_stall-room-c"


class IngressStub:
    """Accepts POST /api/v1/signals, deduplicates by signal_id, fails the first call."""

    def __init__(self, fail_first=1):
        self.signals = {}
        self.attempts = 0
        self.fail_first = fail_first
        self.lock = threading.Lock()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                with stub.lock:
                    stub.attempts += 1
                    if stub.attempts <= stub.fail_first:
                        self.send_response(503)
                        self.end_headers()
                        return
                    duplicate = body["signal_id"] in stub.signals
                    stub.signals.setdefault(body["signal_id"], body)
                data = json.dumps({"signal_id": body["signal_id"], "incident_id": INCIDENT, "deduplicated": duplicate})
                self.send_response(202)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data.encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v1"

    def of_kind(self, kind):
        with self.lock:
            return [s for s in self.signals.values() if s["kind"] == kind]


def _call(base, method, path, body=None, headers=None, token=TOKEN):
    all_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        all_headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = Request(base + path, data=data, headers=all_headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def run(verbose=True):
    say = print if verbose else (lambda *a, **k: None)
    check = validators()
    tmp = tempfile.mkdtemp(prefix="badge-smoke-")
    ingress = IngressStub()
    threading.Thread(target=ingress.server.serve_forever, daemon=True).start()
    settings = Settings(
        port=0,
        incident_api_base_url=ingress.url,
        signal_token="smoke-signal-token",
        internal_token=TOKEN,
        artifact_dir=tmp,
        print_seconds=0.1,
        heartbeat_seconds=0.1,
        heartbeat_timeout=0.5,
        health_report_seconds=1.0,
    )
    app = BadgeApp(settings)
    app.outbox.retry_seconds = 0.2
    app.start()
    server = serve(app, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"

    def ok(condition, message):
        if not condition:
            raise AssertionError(message)
        say(f"  ok  {message}")

    try:
        say(f"badge-control at {base}, incident API stub at {ingress.url}, contracts {'on' if check else 'skipped'}")
        status, body = _call(base, "GET", "/internal/badges/jobs/badge-job-001", token=None)
        ok(status == 401 and body["error"]["code"] == "unauthorized", "requests without the service credential get 401")

        app.fault("station-a")
        app.seed("station-a")
        ok(not app.stations["station-a"].running, "Station A stopped; seeded " + ", ".join(SEED_JOB_IDS))

        def offline_report():
            return [
                s for s in ingress.of_kind("badge_health")
                if s["data"]["station_id"] == "station-a" and s["data"]["status"] == "offline"
            ]

        ok(wait_until(offline_report, 10), "Station B reported Station A offline to the incident API")
        report = offline_report()[0]
        ok(report["source_id"] == "station-b" and report["data"]["pending_job_ids"] == list(SEED_JOB_IDS),
           "outage report comes from station-b and lists all three pending jobs")
        ok(ingress.attempts > len(ingress.signals), "first signal post got 503 and was retried")

        status, diagnosis = _call(base, "POST", "/internal/radar/diagnose",
                                  {"incident_id": INCIDENT, "station_id": "station-a"})
        ok(status == 200 and diagnosis["mode"] == "mock" and "offline" in diagnosis["diagnosis"],
           f"diagnose ({diagnosis.get('mode')}): {diagnosis.get('diagnosis')}")

        status, body = _call(base, "POST", "/internal/radar/diagnose",
                             {"incident_id": INCIDENT, "station_id": "station-z"})
        ok(status == 403, "diagnose refuses a station outside the namespace")

        reroute = {"incident_id": INCIDENT, "from_station_id": "station-a", "to_station_id": "station-b",
                   "job_ids": list(SEED_JOB_IDS)}
        key = {"Idempotency-Key": "smoke-reroute-1"}
        status, first = _call(base, "POST", "/internal/badges/reroute", reroute, key)
        ok(status == 202 and first["accepted_job_ids"] == list(SEED_JOB_IDS), "reroute accepted all three jobs")
        status, again = _call(base, "POST", "/internal/badges/reroute", reroute, key)
        ok(status == 202 and again == first, "replaying the same Idempotency-Key returns the original result")
        status, body = _call(base, "POST", "/internal/badges/reroute", {**reroute, "job_ids": ["badge-job-001"]}, key)
        ok(status == 409 and body["error"]["code"] == "idempotency_conflict", "same key with a different body gets 409")

        def all_done():
            return all(app.store.get_job(j)["status"] == "complete" for j in SEED_JOB_IDS)

        ok(wait_until(all_done, 10), "Station B printed all three jobs")
        jobs = [_call(base, "GET", f"/internal/badges/jobs/{j}")[1] for j in SEED_JOB_IDS]
        for job in jobs:
            ok(job["station_id"] == "station-b" and job["pdf_ref"] == f"pdf-{job['job_id']}"
               and app.artifacts.exists(job["pdf_ref"]), f"{job['job_id']} complete at station-b as {job['pdf_ref']}")

        ok(wait_until(lambda: len(ingress.of_kind("badge_job_complete")) == 3, 10),
           "incident API received exactly one completion signal per job")

        status, body = _call(base, "GET", "/internal/badges/jobs/badge-job-999")
        ok(status == 404, "unknown job gets 404")

        if check:
            for signal in ingress.signals.values():
                check["signal"].validate(signal)
            check["diagnose_response"].validate(diagnosis)
            check["reroute_request"].validate(reroute)
            check["reroute_response"].validate(first)
            for job in jobs:
                check["job_status"].validate(job)
            ok(True, f"{len(ingress.signals)} signals and all HTTP payloads match the shared contracts")
        say("badge_stall failover smoke passed")
        return 0
    except AssertionError as error:
        say(f"  FAIL {error}")
        say(json.dumps(app.state(), indent=2))
        return 1
    finally:
        server.shutdown()
        server.server_close()
        app.stop()
        ingress.server.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
