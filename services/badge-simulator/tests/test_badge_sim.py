import io
import json
import tempfile
import unittest
from pathlib import Path

from badge_sim import SEED_JOB_IDS
from badge_sim.config import Settings
from badge_sim.server import ApiError, BadgeApp
from badge_sim.signals import SignalOutbox, completion_signal, health_signal
from badge_sim.smoke import run as run_smoke
from badge_sim.station import Station
from badge_sim.store import ArtifactStore, JobConflict, MemoryStore
from radar.adapter import RadarDiagnoser
from radar.mcp_client import McpClient, McpError


class Clock:
    def __init__(self, now=1_762_714_800.0):  # 2025-11-09T19:00:00Z
        self.now = now

    def __call__(self):
        return self.now


def settings(**overrides):
    base = dict(internal_token="t", print_seconds=0, heartbeat_timeout=5, health_report_seconds=10)
    base.update(overrides)
    return Settings(**base)


class StoreTests(unittest.TestCase):
    def test_reassign_is_idempotent_and_rejects_foreign_jobs(self):
        store = MemoryStore(Clock())
        for job_id in SEED_JOB_IDS:
            store.put_job(job_id, "station-a")
        self.assertEqual(store.reassign(SEED_JOB_IDS, "station-a", "station-b"), list(SEED_JOB_IDS))
        self.assertEqual(store.reassign(SEED_JOB_IDS, "station-a", "station-b"), list(SEED_JOB_IDS))
        self.assertTrue(all(j["station_id"] == "station-b" for j in store.list_jobs()))
        with self.assertRaises(JobConflict):
            store.reassign(["missing"], "station-a", "station-b")

    def test_only_owning_station_completes_a_job(self):
        store = MemoryStore(Clock())
        store.put_job("badge-job-001", "station-b")
        self.assertFalse(store.complete_job("badge-job-001", "station-a", "pdf-badge-job-001"))
        self.assertTrue(store.complete_job("badge-job-001", "station-b", "pdf-badge-job-001"))
        self.assertFalse(store.complete_job("badge-job-001", "station-b", "pdf-badge-job-001"))

    def test_pdf_is_written_once_with_a_stable_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifacts = ArtifactStore(tmp)
            ref = artifacts.write("badge-job-001", "station-a")
            first = artifacts.path(ref).read_bytes()
            self.assertEqual(artifacts.write("badge-job-001", "station-b"), ref)
            self.assertEqual(artifacts.path(ref).read_bytes(), first)
            self.assertTrue(first.startswith(b"%PDF-1.4") and first.rstrip().endswith(b"%%EOF"))


class StationTests(unittest.TestCase):
    def test_survivor_reports_outage_then_recovery(self):
        clock = Clock()
        s = settings()
        store = MemoryStore(clock)
        outbox = SignalOutbox()
        with tempfile.TemporaryDirectory() as tmp:
            b = Station("station-b", s, store, ArtifactStore(tmp), outbox, clock)
            store.heartbeat("station-a")
            for job_id in SEED_JOB_IDS:
                store.put_job(job_id, "station-a")
            b.tick()
            self.assertEqual(outbox.recorded, [])  # A is still fresh
            clock.now += 90
            b.tick()
            clock.now += 1
            b.tick()  # no repeat before health_report_seconds
            offline = [x for x in outbox.recorded if x["kind"] == "badge_health"]
            self.assertEqual(len(offline), 1)
            self.assertEqual(offline[0]["data"]["oldest_pending_age_s"], 90)
            clock.now += 10
            b.tick()
            self.assertEqual(len([x for x in outbox.recorded if x["kind"] == "badge_health"]), 2)
            store.heartbeat("station-a")
            b.tick()
            last = outbox.recorded[-1]
            self.assertEqual((last["data"]["station_id"], last["data"]["status"]), ("station-a", "healthy"))
            self.assertEqual(len({x["signal_id"] for x in outbox.recorded}), len(outbox.recorded))

    def test_completion_signal_id_is_stable_per_job(self):
        a = completion_signal("station-a", "room-c", "badge-job-001", "pdf-badge-job-001", 1)
        b = completion_signal("station-b", "room-c", "badge-job-001", "pdf-badge-job-001", 2)
        self.assertEqual(a["signal_id"], b["signal_id"])


class AppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.app = BadgeApp(settings(artifact_dir=self.tmp.name), clock=self.clock)
        self.app.seed("station-a")
        self.app.store.heartbeat("station-b")
        self.body = {"incident_id": "inc-1", "from_station_id": "station-a", "to_station_id": "station-b",
                     "job_ids": list(SEED_JOB_IDS)}

    def tearDown(self):
        self.tmp.cleanup()

    def assertApiError(self, status, code, fn, *args):
        with self.assertRaises(ApiError) as caught:
            fn(*args)
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))

    def test_reroute_validation(self):
        self.assertApiError(422, "invalid_payload", self.app.reroute, self.body, None)
        self.assertApiError(422, "invalid_payload", self.app.reroute, {**self.body, "extra": 1}, "k")
        self.assertApiError(422, "invalid_payload", self.app.reroute, {**self.body, "job_ids": []}, "k")
        self.assertApiError(422, "invalid_payload", self.app.reroute, {**self.body, "job_ids": ["x", "x"]}, "k")
        self.assertApiError(422, "invalid_payload", self.app.reroute, {**self.body, "to_station_id": "station-a"}, "k")
        self.assertApiError(403, "forbidden", self.app.reroute, {**self.body, "to_station_id": "station-z"}, "k")
        self.assertApiError(422, "invalid_payload", self.app.reroute, {**self.body, "job_ids": ["nope"]}, "k")

    def test_reroute_requires_an_online_target(self):
        self.clock.now += 60
        self.assertApiError(409, "invalid_transition", self.app.reroute, self.body, "k")

    def test_idempotency_is_scoped_to_incident(self):
        first = self.app.reroute(self.body, "k")
        self.assertEqual(self.app.reroute(self.body, "k"), first)
        self.assertApiError(409, "idempotency_conflict", self.app.reroute, {**self.body, "job_ids": ["badge-job-001"]}, "k")
        other = {**self.body, "incident_id": "inc-2"}
        self.assertEqual(self.app.reroute(other, "k"), first)

    def test_unknown_job_is_404(self):
        self.assertApiError(404, "not_found", self.app.job, "badge-job-999")
        self.assertEqual(self.app.job("badge-job-001")["status"], "pending")


class FakeResponse(io.BytesIO):
    def __init__(self, body, content_type="application/json", session=None):
        super().__init__(body.encode())
        self.headers = {"Content-Type": content_type}
        if session:
            self.headers["Mcp-Session-Id"] = session

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeRadar:
    """Streams JSON-RPC answers like Radar's MCP endpoint, using SSE for tool calls."""

    def __init__(self, ready=0, desired=0, fail=False):
        self.calls = []
        self.ready, self.desired, self.fail = ready, desired, fail

    def __call__(self, request, timeout):
        if self.fail:
            raise OSError("connection refused")
        payload = json.loads(request.data)
        self.calls.append((payload.get("method"), payload.get("params", {}).get("name"), dict(request.header_items())))
        if payload["method"] == "initialize":
            return FakeResponse(json.dumps({"jsonrpc": "2.0", "id": payload["id"], "result": {}}), session="s-1")
        if "id" not in payload:
            return FakeResponse("")
        name = payload["params"]["name"]
        if name == "get_resource":
            data = {"spec": {"replicas": self.desired}, "status": {"readyReplicas": self.ready}}
        else:
            data = {"events": [{"reason": "ScalingReplicaSet"}], "headline": "No running pods for badge-station-a"}
        result = {"content": [{"type": "text", "text": json.dumps(data)}]}
        message = json.dumps({"jsonrpc": "2.0", "id": payload["id"], "result": result})
        return FakeResponse(f"event: message\ndata: {message}\n\n", "text/event-stream")


class RadarTests(unittest.TestCase):
    def make(self, fake, **overrides):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        s = settings(radar_mode="radar", radar_cluster_id="Wa7aYihloY4", radar_token="rt", **overrides)
        store = MemoryStore(Clock())
        return RadarDiagnoser(s, store, Clock(), self.tmp.name,
                              client_factory=lambda: McpClient("https://radar.test/mcp", "rt", opener=fake))

    def test_radar_mode_summarizes_and_saves_evidence(self):
        fake = FakeRadar(ready=0, desired=0)
        result = self.make(fake).diagnose("inc-1", "station-a")
        self.assertEqual(result["mode"], "radar")
        self.assertIn("team-backstage/badge-station-a", result["diagnosis"])
        self.assertIn("scaled to zero", result["diagnosis"])
        self.assertIn("ScalingReplicaSet", result["diagnosis"])
        self.assertEqual(len(result["evidence_refs"]), 2)
        for ref in result["evidence_refs"]:
            self.assertTrue((Path(self.tmp.name) / f"{ref}.json").is_file())
        tools = [name for method, name, _ in fake.calls if method == "tools/call"]
        self.assertEqual(tools, ["get_resource", "diagnose"])
        headers = fake.calls[-1][2]
        self.assertEqual(headers.get("Mcp-session-id"), "s-1")
        self.assertEqual(headers.get("Authorization"), "Bearer rt")

    def test_radar_failure_falls_back_to_labeled_mock(self):
        result = self.make(FakeRadar(fail=True)).diagnose("inc-1", "station-a")
        self.assertEqual(result["mode"], "mock")
        self.assertTrue(result["diagnosis"].startswith("Radar unavailable"))
        self.assertIn("mock-radar-unavailable", result["evidence_refs"])

    def test_write_tools_are_refused(self):
        client = McpClient("https://radar.test/mcp", "rt", opener=FakeRadar())
        for tool in ("manage_workload", "apply_resource", "delete_resource", "patch_resource"):
            with self.assertRaises(McpError):
                client.call_tool(tool, {})


class SmokeTest(unittest.TestCase):
    def test_local_failover(self):
        self.assertEqual(run_smoke(verbose=False), 0)


class ContractTests(unittest.TestCase):
    def test_signals_match_shared_contract(self):
        from badge_sim.contract import validators

        check = validators()
        if check is None:
            self.skipTest("jsonschema not installed")
        check["signal"].validate(health_signal("station-b", "room-c", "station-a", "offline", 90, SEED_JOB_IDS, 1, 0))
        check["signal"].validate(completion_signal("station-b", "room-c", "badge-job-001", "pdf-badge-job-001", 0))


if __name__ == "__main__":
    unittest.main()
