"""Optional local end-to-end test against Ali's badge simulator checkout."""

import os
import socket
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest import TestCase, skipUnless
from unittest.mock import patch

import httpx
import uvicorn

from backstage_api.badges import BadgeControl
from backstage_api.contracts import BADGE_SCHEMA
from backstage_api.main import create_app
from test_badge_workflow import BADGE_IDENTITIES, until

SOURCE = os.getenv("BADGE_SMOKE_SOURCE")


@skipUnless(SOURCE, "set BADGE_SMOKE_SOURCE to Ali's services/badge-simulator directory")
class BadgeSimulatorTests(TestCase):
    def test_real_simulator_fails_over_after_human_acceptance(self):
        self.assertTrue((Path(SOURCE) / "badge_sim").is_dir())
        self.enterContext(patch.object(sys, "path", [SOURCE, *sys.path]))
        self.enterContext(patch.dict(os.environ, {"APP_MODE": "mock"}))
        from badge_sim import SEED_JOB_IDS
        from badge_sim.config import Settings
        from badge_sim.server import BadgeApp, serve

        artifacts = self.enterContext(TemporaryDirectory(prefix="backstage-badge-"))
        listener = self.enterContext(socket.socket())
        listener.bind(("127.0.0.1", 0))
        api_url = f"http://127.0.0.1:{listener.getsockname()[1]}/api/v1"
        badge_app = BadgeApp(Settings(
            port=0, internal_token="smoke-internal-token", signal_token="badge",
            incident_api_base_url=api_url, artifact_dir=artifacts,
            heartbeat_seconds=0.1, heartbeat_timeout=1.1, health_report_seconds=0.2, print_seconds=0.1,
        ))
        server = serve(badge_app, "127.0.0.1", 0)
        self.addCleanup(server.server_close)
        Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        badge_url = f"http://127.0.0.1:{server.server_port}"
        app = create_app(
            identities=BADGE_IDENTITIES,
            badge_control=BadgeControl(badge_url, "smoke-internal-token", BADGE_SCHEMA),
        )
        uvicorn_server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
        thread = Thread(target=uvicorn_server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()

        def stop_api():
            uvicorn_server.should_exit = True
            thread.join(timeout=8)
            self.assertFalse(thread.is_alive())

        self.addCleanup(stop_api)
        until(lambda: uvicorn_server.started)
        badge_app.start()
        self.addCleanup(badge_app.stop)
        badge_app.fault("station-a")
        badge_app.seed("station-a")

        client = self.enterContext(httpx.Client(base_url=api_url, timeout=3))

        def request(method, path, *, token="organizer", body=None, key=None):
            headers = {"Authorization": f"Bearer {token}"}
            if key:
                headers["Idempotency-Key"] = key
            result = client.request(method, path, headers=headers, json=body)
            self.assertEqual(result.status_code, 200, result.text)
            return result.json()

        def proposed():
            incidents = request("GET", "/incidents")["items"]
            return next((item for item in incidents if item["state"] == "plan_proposed"), None)

        plan = until(proposed, timeout=12)
        path = f"/incidents/{plan['id']}"
        request("POST", path + "/actions", key="smoke-approve", body={
            "action": "approve", "expected_version": plan["version"],
            "payload": {"plan_id": plan["plan"]["id"]},
        })
        dispatched = request("GET", path)
        for job_id in SEED_JOB_IDS:
            self.assertEqual(badge_app.store.get_job(job_id)["station_id"], "station-a")
        request("POST", path + "/actions", token="it", key="smoke-ack", body={
            "action": "ack", "expected_version": dispatched["version"],
            "payload": {"assignment_id": dispatched["assignment"]["id"], "decision": "accepted"},
        })
        until(lambda: request("GET", path)["state"] == "resolved", timeout=12)
        for job_id in SEED_JOB_IDS:
            job = badge_app.store.get_job(job_id)
            self.assertEqual((job["status"], job["station_id"]), ("complete", "station-b"))
            self.assertTrue(badge_app.artifacts.exists(job["pdf_ref"]))
        timeline = request("GET", path + "/events")["items"]
        self.assertEqual([event["type"] for event in timeline], [
            "raise", "claim", "propose", "approve", "dispatch", "ack", "verify", "close",
        ])
        self.assertEqual(len(timeline[-1]["payload"]["evidence_signal_ids"]), len(SEED_JOB_IDS))
