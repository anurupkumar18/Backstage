import json
from datetime import datetime, timedelta
from unittest import TestCase

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from backstage_api.contracts import CONTRACTS, OPENAPI
from backstage_api.engine import Identity
from backstage_api.main import create_app

API = "/api/v1"
FIXTURE = CONTRACTS.parent / "fixtures" / "shared" / "overflow.signals.jsonl"
IDENTITIES = {
    "attendee": Identity("attendee", tier=0),
    "speaker": Identity("speaker", tier=1, session_ids=("session-room-b",)),
    "other-speaker": Identity("other-speaker", tier=1, session_ids=("session-other",)),
    "staff": Identity("venue-staff-01", tier=2, domain="venue"),
    "backup": Identity("venue-staff-02", tier=2, domain="venue"),
    "av": Identity("av-staff-01", tier=2, domain="av"),
    "organizer": Identity("organizer", tier=3),
    "camera": Identity("camera", source_ids=("cam-b",), room_ids=("room-b",)),
}


class OverflowTests(TestCase):
    def setUp(self):
        self.signals = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
        self.start = datetime.fromisoformat(self.signals[0]["occurred_at"])
        self.now = self.start
        self.exporter = InMemorySpanExporter()
        provider = TracerProvider(shutdown_on_exit=False)
        self.addCleanup(provider.shutdown)
        provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.client = self.enterContext(TestClient(create_app(
            clock=lambda: self.now,
            identities=IDENTITIES,
            tracer_provider=provider,
        )))

    def request(self, method, path, *, token="organizer", body=None, key=None, expect=200):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        if key:
            headers["Idempotency-Key"] = key
        response = self.client.request(method, API + path, json=body, headers=headers)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def submit(self, signal, *, time=None, token="camera", expect=202):
        self.now = time or datetime.fromisoformat(signal["occurred_at"])
        return self.request("POST", "/signals", token=token, body=signal, expect=expect)

    def trigger(self, *, session_id=None):
        for signal in self.signals[:3]:
            receipt = self.submit(signal)
            self.assertIsNone(receipt["incident_id"])
        signal = self.signals[3]
        if session_id:
            signal = {**signal, "session_id": session_id}
        incident_id = self.submit(signal)["incident_id"]
        self.assertTrue(incident_id)
        self.path = f"/incidents/{incident_id}"
        return self.request("GET", self.path)

    def action(self, incident, action, payload, *, key, token="organizer", expect=200):
        body = {"action": action, "expected_version": incident["version"], "payload": payload}
        return self.request("POST", self.path + "/actions", body=body, key=key, token=token, expect=expect)

    def approve(self, proposed):
        return self.action(proposed, "approve", {"plan_id": proposed["plan"]["id"]}, key="approve")

    def accept(self, dispatched, token="staff", **kwargs):
        return self.action(
            dispatched, "ack", {"assignment_id": dispatched["assignment"]["id"], "decision": "accepted"},
            key="accept", token=token, **kwargs,
        )

    def public_room(self, expected):
        result = self.request("GET", "/status", token="attendee")
        self.assertEqual(result["rooms"][0], {
            "room_id": "room-b", "label": "Room B", "status": expected, "accessibility_status": None,
        })
        self.assertEqual(result["sessions"], [])

    def test_full_replay_requires_sixty_seconds_and_keeps_one_timeline(self):
        self.public_room("normal")
        proposed = self.trigger()
        self.assertEqual(proposed["state"], "plan_proposed")
        self.assertEqual(proposed["allowed_actions"], ["approve"])
        self.public_room("affected")

        approved = self.approve(proposed)
        self.assertEqual(approved["state"], "approved")
        dispatched = self.request("GET", self.path, token="staff")
        self.assertEqual(dispatched["state"], "dispatched")
        self.assertEqual(dispatched["allowed_actions"], ["ack", "handoff"])
        accepted = self.accept(dispatched)
        self.assertEqual(accepted["state"], "accepted")
        self.public_room("recovering")
        error = self.action(accepted, "close", {}, key="premature-close", expect=422)
        self.assertEqual(error["error"]["code"], "invalid_payload")

        for signal in self.signals[4:-1]:
            self.assertEqual(self.submit(signal)["incident_id"], proposed["id"])
            self.public_room("recovering")
        self.assertEqual(self.request("GET", self.path)["state"], "verifying")
        self.assertEqual(self.submit(self.signals[-1])["incident_id"], proposed["id"])

        resolved = self.request("GET", self.path)
        self.assertEqual(resolved["state"], "resolved")
        self.assertEqual(resolved["verification"]["status"], "passed")
        self.public_room("normal")
        timeline = self.request("GET", self.path + "/events")["items"]
        self.assertEqual([event["type"] for event in timeline], [
            "raise", "claim", "propose", "approve", "dispatch", "ack", "verify", "close",
        ])
        self.assertEqual([event["sequence"] for event in timeline], list(range(1, 9)))
        self.assertEqual(timeline[-1]["payload"]["evidence_signal_ids"], [
            signal["signal_id"] for signal in self.signals[5:]
        ])

        incident_schema = OPENAPI["components"]["schemas"]["Incident"]
        protocol_schema = json.loads((CONTRACTS / "protocol.v1.schema.json").read_text())
        Draft202012Validator(incident_schema).validate(resolved)
        for event in timeline:
            Draft202012Validator(protocol_schema).validate(event)
            self.assertEqual(event["trace_id"], resolved["trace_id"])
        spans = [span for span in self.exporter.get_finished_spans() if span.name == "incident.transition"]
        self.assertEqual([span.attributes["incident.event.id"] for span in spans], [
            event["event_id"] for event in timeline
        ])
        self.assertTrue(all(f"{span.context.trace_id:032x}" == resolved["trace_id"] for span in spans))

    def test_views_and_writes_follow_role_and_scope(self):
        proposed = self.trigger(session_id="session-room-b")
        self.request("GET", "/status", token=None, expect=401)
        self.request("GET", "/status", token="camera", expect=403)
        self.request("GET", "/incidents", token="attendee", expect=403)
        self.request("GET", self.path, token="other-speaker", expect=404)
        self.request("GET", self.path + "/events", token="av", expect=404)
        self.assertEqual(self.request("GET", "/incidents", token="other-speaker")["items"], [])
        self.assertEqual(self.request("GET", self.path, token="speaker")["allowed_actions"], [])

        payload = {"plan_id": proposed["plan"]["id"]}
        for token in ("attendee", "speaker", "staff"):
            denied = self.action(proposed, "approve", payload, key="approve", token=token, expect=403)
            self.assertEqual(denied["error"]["code"], "forbidden")
        self.approve(proposed)
        dispatched = self.request("GET", self.path, token="backup")
        self.assertEqual(dispatched["allowed_actions"], [])
        self.accept(dispatched, token="backup", expect=403)
        self.assertEqual(self.request("GET", self.path)["state"], "dispatched")

    def test_retries_preserve_original_receipts_and_reject_conflicting_keys(self):
        proposed = self.trigger()
        repeated = self.submit(self.signals[3], time=self.start + timedelta(seconds=90))
        self.assertTrue(repeated["deduplicated"])
        self.assertEqual(repeated["incident_id"], proposed["id"])
        earlier = self.submit(self.signals[1], time=self.now)
        self.assertIsNone(earlier["incident_id"])
        changed = {**self.signals[3], "data": {**self.signals[3]["data"], "count": 9}}
        error = self.submit(changed, time=self.now, expect=409)
        self.assertEqual(error["error"]["code"], "idempotency_conflict")

        approved = self.approve(proposed)
        self.assertEqual(self.approve(proposed), approved)
        error = self.action(proposed, "approve", {"plan_id": "different"}, key="approve", expect=409)
        self.assertEqual(error["error"]["code"], "idempotency_conflict")
        error = self.action(proposed, "approve", {"plan_id": proposed["plan"]["id"]}, key="fresh", expect=409)
        self.assertEqual(error["error"]["code"], "stale_version")

        dispatched = self.request("GET", self.path)
        self.assertEqual(self.accept(dispatched), self.accept(dispatched))
        self.assertEqual(self.request("GET", self.path)["state"], "accepted")
        self.assertEqual(len(self.request("GET", self.path + "/events")["items"]), 6)

    def test_missing_sample_and_threshold_equality_reset_recovery(self):
        self.approve(self.trigger())
        self.accept(self.request("GET", self.path))
        self.submit(self.signals[5])
        self.submit(self.signals[7])
        at_threshold = {**self.signals[8], "data": {**self.signals[8]["data"], "count": 5}}
        self.submit(at_threshold)
        self.submit(self.signals[9])
        self.public_room("recovering")
        for offset in (15, 30, 45, 60):
            at = self.start + timedelta(seconds=120 + offset)
            signal = {**self.signals[9], "signal_id": f"clear-{offset}", "occurred_at": at.isoformat()}
            self.submit(signal)
            self.public_room("normal" if offset == 60 else "recovering")

    def test_timed_out_assignment_hands_off_then_escalates(self):
        self.approve(self.trigger())
        first = self.request("GET", self.path)
        self.now += timedelta(seconds=60)
        backup = self.request("GET", self.path, token="backup")
        self.assertEqual(backup["assignment"]["assignee_id"], "venue-staff-02")
        self.assertNotEqual(backup["assignment"]["id"], first["assignment"]["id"])
        self.accept(first, expect=403)
        declined = self.action(
            backup, "ack", {"assignment_id": backup["assignment"]["id"], "decision": "declined"},
            key="decline", token="backup",
        )
        self.assertEqual(declined["state"], "approved")
        self.assertEqual(self.request("GET", self.path)["state"], "escalated")
        self.public_room("affected")

    def test_signal_scope_and_time_are_validated(self):
        self.submit(self.signals[0], token="attendee", expect=403)
        self.submit({**self.signals[0], "source_id": "other"}, expect=403)
        self.submit({**self.signals[0], "room_id": "room-c"}, expect=403)
        self.submit(self.signals[0], time=self.start + timedelta(seconds=21), expect=422)
        self.submit(self.signals[0], time=self.start - timedelta(seconds=1), expect=422)
        self.submit({**self.signals[0], "occurred_at": "2026-02-30T19:00:00Z"}, time=self.start, expect=422)
        self.assertEqual(self.request("GET", "/incidents")["items"], [])
