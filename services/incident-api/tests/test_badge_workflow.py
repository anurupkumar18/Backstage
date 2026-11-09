import json
import os
from datetime import datetime, timedelta
from time import monotonic, sleep
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from backstage_api.badges import BadgeUnavailable
from backstage_api.contracts import CONTRACTS
from backstage_api.engine import Identity
from backstage_api.main import create_app
from test_overflow import IDENTITIES
from test_persistence import CheckpointTransport

BADGE_IDENTITIES = {
    **IDENTITIES,
    "badge": Identity(
        "badge-simulator", source_ids=("station-a", "station-b"), room_ids=("room-c",),
        signal_kinds=("badge_health", "badge_job_complete"),
    ),
    "it": Identity("it-staff-01", tier=2, domain="it"),
    "it-backup": Identity("it-staff-02", tier=2, domain="it"),
}
FIXTURE = CONTRACTS.parent / "fixtures" / "shared" / "badge_stall.signals.jsonl"


def until(operation, timeout=7):
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        if result := operation():
            return result
        sleep(0.03)
    raise AssertionError("Timed out waiting for badge recovery.")


class StubBadgeControl:
    def __init__(self):
        self.operations = []
        self.retry_reroute = True
        self.confirm_pdfs = False

    def execute(self, command):
        self.operations.append(command)
        if command.operation == "diagnose":
            return {"station_id": "station-a", "mode": "mock", "diagnosis": "Station A is offline.", "evidence_refs": []}
        if command.operation == "reroute":
            if self.retry_reroute:
                self.retry_reroute = False
                raise BadgeUnavailable()
            return True
        return self.confirm_pdfs


class BadgeWorkflowTests(TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"APP_MODE": "mock"}))
        self.samples = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
        self.clock = datetime.fromisoformat(self.samples[0]["occurred_at"])
        self.control = StubBadgeControl()
        self.checkpoints = CheckpointTransport()

    def app(self):
        return TestClient(create_app(
            clock=lambda: self.clock, identities=BADGE_IDENTITIES, badge_control=self.control,
            checkpoint=self.checkpoints.checkpoint(),
        ))

    def request(self, client, method, path, token="organizer", *, body=None, key=None, status=200):
        headers = {"Authorization": f"Bearer {token}"}
        if key:
            headers["Idempotency-Key"] = key
        response = client.request(method, "/api/v1" + path, headers=headers, json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def signal(self, client, body, *, token="badge", status=202):
        return self.request(client, "POST", "/signals", token, body=body, status=status)

    def wait_for_state(self, client, path, state):
        def match():
            result = self.request(client, "GET", path)
            return result if result["state"] == state else None
        return until(match)

    def test_reroute_resumes_after_restart_and_closes_only_with_confirmed_pdfs(self):
        with self.app() as client:
            report = self.signal(client, self.samples[0])
            path = f"/incidents/{report['incident_id']}"
            proposed = self.wait_for_state(client, path, "plan_proposed")
            self.assertEqual(proposed["type"], "badge_stall")
            self.assertIn("Diagnosis (mock)", proposed["plan"]["summary"])
            self.assertEqual([item.operation for item in self.control.operations], ["diagnose"])
            self.request(client, "GET", path, "staff", status=404)

            self.request(client, "POST", path + "/actions", key="approve-badge", body={
                "action": "approve", "expected_version": proposed["version"],
                "payload": {"plan_id": proposed["plan"]["id"]},
            })
            dispatched = self.request(client, "GET", path)
            self.assertEqual(dispatched["assignment"]["domain"], "it")
            self.assertEqual([item.operation for item in self.control.operations], ["diagnose"])
            ack = {
                "action": "ack", "expected_version": dispatched["version"],
                "payload": {"assignment_id": dispatched["assignment"]["id"], "decision": "accepted"},
            }
            self.request(client, "POST", path + "/actions", "it-backup", body=ack, key="ack", status=403)
            self.request(client, "POST", path + "/actions", "it", body=ack, key="ack")

        with self.app() as client:
            self.assertEqual(self.request(client, "GET", path)["state"], "verifying")
            until(lambda: len([item for item in self.control.operations if item.operation == "reroute"]) >= 2)
            reroutes = [item for item in self.control.operations if item.operation == "reroute"]
            self.assertEqual(reroutes[0], reroutes[1])
            self.assertEqual(list(reroutes[0].job_ids), self.samples[0]["data"]["pending_job_ids"])

            for sample in self.samples[1:]:
                self.clock = datetime.fromisoformat(sample["occurred_at"])
                self.signal(client, sample)
            until(lambda: any(item.operation == "verify" for item in self.control.operations))
            self.assertEqual(self.request(client, "GET", path)["state"], "verifying")
            self.control.confirm_pdfs = True
            self.wait_for_state(client, path, "resolved")
            timeline = self.request(client, "GET", path + "/events")["items"]
            validator = Draft202012Validator(json.loads((CONTRACTS / "protocol.v1.schema.json").read_text()))
            for event in timeline:
                validator.validate(event)
            self.assertEqual(timeline[-1]["payload"]["evidence_signal_ids"], [
                sample["signal_id"] for sample in self.samples[1:]
            ])
            retry = self.signal(client, self.samples[0])
            self.assertTrue(retry["deduplicated"])
            late_report = {**self.samples[0], "signal_id": "late-offline-report"}
            self.assertIsNone(self.signal(client, late_report)["incident_id"])
            self.assertEqual(len(self.request(client, "GET", "/incidents")["items"]), 1)

    def test_source_scope_and_outage_evidence(self):
        with self.app() as client:
            report = self.samples[0]
            self.signal(client, report, token="camera", status=403)
            stale = {**report, "signal_id": "stale", "occurred_at": (self.clock - timedelta(seconds=61)).isoformat()}
            self.assertIsNone(self.signal(client, stale)["incident_id"])
            no_pending = {**report, "signal_id": "empty", "data": {**report["data"], "pending_job_ids": []}}
            self.assertIsNone(self.signal(client, no_pending)["incident_id"])
            unaged = {**report, "signal_id": "unaged", "data": {**report["data"], "oldest_pending_age_s": 0}}
            self.assertIsNone(self.signal(client, unaged)["incident_id"])
            self.assertEqual(self.request(client, "GET", "/incidents")["items"], [])

    def test_badge_diagnostics_explain_approval_then_acceptance_before_completion_evidence(self):
        with self.app() as client:
            report = self.signal(client, self.samples[0])
            path = f"/incidents/{report['incident_id']}"
            proposed = self.wait_for_state(client, path, 'plan_proposed')
            before_approval = self.request(client, 'GET', path + '/diagnostics')['verification']['reason']
            self.assertIn('approval', before_approval)
            self.assertNotIn('PDF', before_approval)
            self.request(client, 'POST', path + '/actions', key='approve-diagnostics', body={
                'action': 'approve', 'expected_version': proposed['version'],
                'payload': {'plan_id': proposed['plan']['id']},
            })
            dispatched = self.request(client, 'GET', path)
            before_acceptance = self.request(client, 'GET', path + '/diagnostics')['verification']['reason']
            self.assertIn('accept', before_acceptance)
            self.assertNotIn('PDF', before_acceptance)
            self.request(client, 'POST', path + '/actions', 'it', key='accept-diagnostics', body={
                'action': 'ack', 'expected_version': dispatched['version'],
                'payload': {'assignment_id': dispatched['assignment']['id'], 'decision': 'accepted'},
            })
            after_acceptance = self.request(client, 'GET', path + '/diagnostics')['verification']['reason']
            self.assertIn('PDF', after_acceptance)
            self.assertNotIn('approval', after_acceptance)
