"""Exercise restarts and retries through FastAPI and the Elasticsearch SDK."""

import json
import os
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
from unittest import TestCase, skipUnless
from urllib.parse import parse_qs, urlsplit

from elastic_transport import ApiResponseMeta, BaseNode, ConnectionTimeout, HttpHeaders
from elasticsearch import Elasticsearch
from fastapi.testclient import TestClient

from backstage_api.main import configured_checkpoint, create_app
from backstage_api.persistence import ElasticsearchCheckpoint
from test_overflow import API, FIXTURE, IDENTITIES

ALIAS = "backstage-overflow-state"
DOCUMENT = f"/{ALIAS}/_doc/overflow-demo"


class CheckpointTransport:
    """A test double for the Elasticsearch GET and conditional index APIs."""

    def __init__(self, *, exists=True):
        self.exists = exists
        self.document = None
        self.sequence = -1
        self.lose_ack = False
        self.fail_before_save = False

    def checkpoint(self):
        transport = self

        class Node(BaseNode):
            def perform_request(self, method, target, body=None, headers=None, request_timeout=None):
                status, result = transport.request(method, target, body)
                meta = ApiResponseMeta(
                    status, "1.1",
                    HttpHeaders({"x-elastic-product": "Elasticsearch", "content-type": "application/json"}),
                    0, self.config,
                )
                return SimpleNamespace(meta=meta, body=json.dumps(result).encode())

        client = Elasticsearch("http://localhost:9200", node_class=Node, max_retries=0)
        return ElasticsearchCheckpoint(client, ALIAS)

    def request(self, method, target, body):
        url = urlsplit(target)
        assert url.path == DOCUMENT, url.path
        params = parse_qs(url.query)
        if not self.exists:
            return 404, {"error": {"type": "index_not_found_exception"}, "status": 404}
        if method == "GET":
            if self.document is None:
                return 404, {"found": False}
            result = {"found": True, "_seq_no": self.sequence, "_primary_term": 1}
            if params.get("_source") != ["false"]:
                result["_source"] = deepcopy(self.document)
            return 200, result

        assert method == "PUT", method
        assert params.get("require_alias") == ["true"]
        if self.document is None:
            current = params.get("op_type") == ["create"]
        else:
            current = params.get("if_seq_no") == [str(self.sequence)] and params.get("if_primary_term") == ["1"]
        if not current:
            return 409, {"error": {"type": "version_conflict_engine_exception"}, "status": 409}
        if self.fail_before_save:
            self.fail_before_save = False
            raise ConnectionTimeout("Simulated unavailable store.")
        self.document = json.loads(body)
        self.sequence += 1
        if self.lose_ack:
            self.lose_ack = False
            raise ConnectionTimeout("Simulated lost write response.")
        return 201 if self.sequence == 0 else 200, {"_seq_no": self.sequence, "_primary_term": 1}


class PersistenceTests(TestCase):
    def setUp(self):
        self.clock = datetime.fromisoformat("2026-11-09T19:00:00Z")
        self.signals = [json.loads(line) for line in FIXTURE.read_text().splitlines()]

    def app(self, factory):
        return TestClient(create_app(identities=IDENTITIES, clock=lambda: self.clock, checkpoint=factory()))

    def request(self, client, method, path, *, token="organizer", body=None, key=None, status=200):
        headers = {"Authorization": f"Bearer {token}"}
        if key:
            headers["Idempotency-Key"] = key
        response = client.request(method, API + path, json=body, headers=headers)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def signal(self, client, sample):
        self.clock = datetime.fromisoformat(sample["occurred_at"])
        return self.request(client, "POST", "/signals", token="camera", body=sample, status=202)

    def propose(self, client):
        for sample in self.signals[:3]:
            self.assertIsNone(self.signal(client, sample)["incident_id"])
        receipt = self.signal(client, self.signals[3])
        path = f"/incidents/{receipt['incident_id']}"
        return path, self.request(client, "GET", path)

    def approve(self, client, path, proposed, *, key="approve-once", status=200):
        body = {"action": "approve", "expected_version": proposed["version"], "payload": {
            "plan_id": proposed["plan"]["id"],
        }}
        return self.request(client, "POST", path + "/actions", body=body, key=key, status=status)

    def verify_restart(self, factory):
        with self.app(factory) as client:
            self.assertEqual(client.get("/readyz").status_code, 200)
            self.assertEqual(self.request(client, "GET", "/incidents")["items"], [])
            for sample in self.signals[:3]:
                self.assertIsNone(self.signal(client, sample)["incident_id"])

        # Preserve the pre-incident evidence as well as the opened incident.
        with self.app(factory) as client:
            receipt = self.signal(client, self.signals[3])
            self.assertIsNotNone(receipt["incident_id"])
            path = f"/incidents/{receipt['incident_id']}"
            proposed = self.request(client, "GET", path)
            approval = self.approve(client, path, proposed)

        with self.app(factory) as client:
            dispatched = self.request(client, "GET", path)
            self.assertEqual(dispatched["state"], "dispatched")
            self.assertEqual(self.approve(client, path, proposed), approval)
            duplicate = self.signal(client, self.signals[3])
            self.assertEqual(duplicate, {**receipt, "deduplicated": True})
            self.assertEqual(len(self.request(client, "GET", "/incidents")["items"]), 1)
            events = self.request(client, "GET", path + "/events")["items"]
            self.assertEqual([event["type"] for event in events], [
                "raise", "claim", "propose", "approve", "dispatch",
            ])
            accepted = self.request(
                client, "POST", path + "/actions", token="staff", key="accept-once",
                body={"action": "ack", "expected_version": dispatched["version"], "payload": {
                    "assignment_id": dispatched["assignment"]["id"], "decision": "accepted",
                }},
            )
            self.assertEqual(accepted["state"], "accepted")
            for sample in self.signals[4:7]:
                self.signal(client, sample)

        with self.app(factory) as client:
            self.assertEqual(self.request(client, "GET", path)["state"], "verifying")
            for sample in self.signals[7:]:
                self.signal(client, sample)
            resolved = self.request(client, "GET", path)
            self.assertEqual(resolved["state"], "resolved")
            self.assertEqual(resolved["trace_id"], proposed["trace_id"])
            events = self.request(client, "GET", path + "/events")["items"]
            self.assertEqual(events[-1]["type"], "close")
            self.assertEqual(events[-1]["payload"]["evidence_signal_ids"], [
                sample["signal_id"] for sample in self.signals[5:]
            ])

    def test_restart_keeps_counts_approval_and_recovery_progress(self):
        self.verify_restart(CheckpointTransport().checkpoint)

    def test_ambiguous_write_reloads_before_retry(self):
        backend = CheckpointTransport()
        with self.app(backend.checkpoint) as client:
            path, proposed = self.propose(client)
            backend.lose_ack = True
            error = self.approve(client, path, proposed, status=503)
            self.assertEqual(error["error"]["code"], "unavailable")
            approved = self.approve(client, path, proposed)
            self.assertEqual(approved["state"], "approved")
            events = self.request(client, "GET", path + "/events")["items"]
            self.assertEqual([event["type"] for event in events].count("approve"), 1)

    def test_failed_write_does_not_expose_uncommitted_changes(self):
        backend = CheckpointTransport()
        with self.app(backend.checkpoint) as client:
            path, proposed = self.propose(client)
            backend.fail_before_save = True
            self.approve(client, path, proposed, status=503)
            self.assertEqual(self.request(client, "GET", path), proposed)
            self.assertEqual(self.approve(client, path, proposed)["state"], "approved")

    def test_conflict_reloads_before_evaluating_the_expected_version(self):
        backend = CheckpointTransport()
        with self.app(backend.checkpoint) as first:
            path, proposed = self.propose(first)
            with self.app(backend.checkpoint) as second:
                self.assertEqual(self.request(second, "GET", path), proposed)
                self.approve(first, path, proposed)
                result = self.approve(second, path, proposed, key="different", status=409)
                self.assertEqual(result["error"]["code"], "stale_version")
                self.assertEqual(self.request(second, "GET", path)["state"], "dispatched")

    def test_missing_index_fails_readiness_and_does_not_auto_create(self):
        backend = CheckpointTransport(exists=False)
        with self.app(backend.checkpoint) as client:
            self.assertEqual(client.get("/healthz").status_code, 200)
            response = client.get("/readyz")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["error"]["code"], "unavailable")
            self.request(client, "POST", "/signals", token="camera", body=self.signals[0], status=503)
            self.assertIsNone(backend.document)

    @skipUnless(os.getenv("BACKSTAGE_LIVE_SMOKE") == "1", "requires an explicitly enabled empty Elasticsearch index")
    def test_live_elasticsearch_restart(self):
        self.assertEqual(os.getenv("APP_MODE"), "live")
        self.assertTrue(os.getenv("ELASTICSEARCH_INDEX_PREFIX") == "backstage-smoke")
        self.verify_restart(configured_checkpoint)


class CheckpointTelemetryTests(TestCase):
    def test_empty_checkpoint_load_is_healthy_but_missing_index_remains_error(self):
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import InMemoryMetricReader
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
        from opentelemetry.trace import StatusCode
        from backstage_api.engine import ApiError
        from backstage_api.telemetry import Telemetry

        reader = InMemoryMetricReader()
        meter = MeterProvider(metric_readers=[reader], shutdown_on_exit=False)
        provider = TracerProvider(shutdown_on_exit=False)
        exporter = InMemorySpanExporter()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        self.addCleanup(meter.shutdown)
        self.addCleanup(provider.shutdown)
        telemetry = Telemetry(tracer_provider=provider, meter_provider=meter)
        self.addCleanup(telemetry.close)
        tracer = provider.get_tracer('test.checkpoint')

        def outcomes():
            data = reader.get_metrics_data()
            return {point.attributes['outcome']: point.value
                    for resource in data.resource_metrics for scope in resource.scope_metrics
                    for metric in scope.metrics if metric.name == 'backstage.persistence.operations'
                    for point in metric.data.data_points if point.attributes['operation'] == 'load'}

        empty = CheckpointTransport().checkpoint()
        self.addCleanup(empty.close)
        empty.telemetry = telemetry
        store, revision = empty.load(tracer)
        self.assertEqual(store.incidents, {})
        self.assertIsNone(revision)
        self.assertEqual(outcomes(), {'success': 1})
        empty_span = exporter.get_finished_spans()[-1]
        self.assertEqual(empty_span.attributes['operation.outcome'], 'success')
        self.assertNotEqual(empty_span.status.status_code, StatusCode.ERROR)

        missing = CheckpointTransport(exists=False).checkpoint()
        self.addCleanup(missing.close)
        missing.telemetry = telemetry
        with self.assertRaises(ApiError) as raised:
            missing.load(tracer)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(outcomes(), {'success': 1, 'error': 1})
        missing_span = exporter.get_finished_spans()[-1]
        self.assertEqual(missing_span.attributes['operation.outcome'], 'error')
        self.assertEqual(missing_span.status.status_code, StatusCode.ERROR)
