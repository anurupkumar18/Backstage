"""Configured release identity, export behavior and privacy of all three OTLP signals."""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from backstage_api.main import create_app
from backstage_api.telemetry import Telemetry
from test_overflow import IDENTITIES


class TelemetryTests(TestCase):
    def test_configured_resource_release_survives(self):
        with patch.dict(os.environ, {'OTEL_RESOURCE_ATTRIBUTES': 'service.version=release-abc,deployment.environment.name=qa',
                                     'OTEL_ENABLED': 'false'}):
            telemetry = Telemetry()
        self.addCleanup(telemetry.close)
        self.assertEqual(telemetry.tracer_provider.resource.attributes['service.version'], 'release-abc')
        self.assertEqual(telemetry.tracer_provider.resource.attributes['deployment.environment.name'], 'qa')

    def test_disabled_and_uninitialized_projection_emit_no_lag_observation(self):
        reader = InMemoryMetricReader()
        meter = MeterProvider(metric_readers=[reader], shutdown_on_exit=False)
        self.addCleanup(meter.shutdown)
        client = self.enterContext(TestClient(create_app(identities=IDENTITIES, meter_provider=meter)))
        client.get('/healthz')
        data = reader.get_metrics_data()
        metrics = [metric for resource in data.resource_metrics for scope in resource.scope_metrics
                   for metric in scope.metrics if metric.name == 'backstage.evidence.projection.lag']
        self.assertEqual(metrics, [])

    def test_otlp_traces_logs_metrics_export_no_queries_credentials_or_bodies(self):
        received = {}
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.setdefault(self.path, []).append(self.rfile.read(int(self.headers['Content-Length'])))
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-protobuf')
                self.end_headers()
            def log_message(self, *_args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.dict(os.environ, {'OTEL_ENABLED': 'true',
                                         'OTEL_EXPORTER_OTLP_ENDPOINT': f'http://127.0.0.1:{server.server_port}',
                                         'OTEL_EXPORTER_OTLP_HEADERS': '',
                                         'OTEL_RESOURCE_ATTRIBUTES': 'service.version=qa-commit'}):
                with TestClient(create_app(identities=IDENTITIES)) as client:
                    response = client.get('/api/v1/evidence/search?q=QUERY_SECRET',
                                          headers={'Authorization': 'Bearer CREDENTIAL_SECRET'})
                    self.assertEqual(response.status_code, 401)
                    response = client.post('/api/v1/signals', json={'body': 'BODY_SECRET'},
                                           headers={'Authorization': 'Bearer camera'})
                    self.assertEqual(response.status_code, 422)
            self.assertEqual(set(received), {'/v1/traces', '/v1/logs', '/v1/metrics'})
            payloads = b''.join(body for batches in received.values() for body in batches)
            for secret in (b'QUERY_SECRET', b'CREDENTIAL_SECRET', b'BODY_SECRET'):
                self.assertNotIn(secret, payloads)
            self.assertIn(b'qa-commit', payloads)
            self.assertIn(b'backstage.http.requests', payloads)
            self.assertIn(b'http.denied', payloads)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(2)

    def test_pending_projection_has_no_lag_until_real_watermark_then_measures_revision_gap(self):
        import json
        from datetime import datetime, timedelta
        from backstage_api.evidence import EvidenceProjection
        from test_evidence import EvidenceClient
        from test_overflow import FIXTURE
        from test_persistence import CheckpointTransport
        reader = InMemoryMetricReader()
        meter = MeterProvider(metric_readers=[reader], shutdown_on_exit=False)
        self.addCleanup(meter.shutdown)
        sample = json.loads(FIXTURE.read_text().splitlines()[0])
        now = datetime.fromisoformat(sample['occurred_at'])
        app = create_app(identities=IDENTITIES, clock=lambda: now, meter_provider=meter,
                         checkpoint=CheckpointTransport().checkpoint(),
                         evidence_projection=EvidenceProjection(EvidenceClient(), 'test', None))
        client = self.enterContext(TestClient(app))
        response = client.post('/api/v1/signals', json=sample, headers={'Authorization': 'Bearer camera'})
        self.assertEqual(response.status_code, 202)
        def observations():
            data = reader.get_metrics_data()
            return [point.value for resource in data.resource_metrics for scope in resource.scope_metrics
                    for metric in scope.metrics if metric.name == 'backstage.evidence.projection.lag'
                    for point in metric.data.data_points]
        self.assertEqual(observations(), [])
        app.state.project_evidence()
        self.assertEqual(observations(), [0])
        now += timedelta(seconds=15)
        response = client.post('/api/v1/signals', json={**sample, 'signal_id': 'next', 'occurred_at': now.isoformat()},
                               headers={'Authorization': 'Bearer camera'})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(observations(), [1])

    def test_blocked_telemetry_flush_has_bounded_shutdown(self):
        from threading import Event
        from time import monotonic
        telemetry = Telemetry()
        blocked, release = Event(), Event()
        def stuck_flush(**kwargs):
            blocked.set()
            release.wait(8)
        with patch.object(telemetry.tracer_provider, 'force_flush', stuck_flush):
            started = monotonic()
            try:
                telemetry.close()
                self.assertTrue(blocked.is_set())
                self.assertLess(monotonic() - started, 3.5)
            finally:
                release.set()

    def test_es_error_span_has_sanitized_error_status_without_exception_contents(self):
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
        from opentelemetry.trace import StatusCode
        exporter = InMemorySpanExporter()
        provider = TracerProvider(shutdown_on_exit=False)
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        self.addCleanup(provider.shutdown)
        telemetry = Telemetry(tracer_provider=provider)
        self.addCleanup(telemetry.close)
        with self.assertRaises(RuntimeError):
            with telemetry.es_operation('search'):
                raise RuntimeError('PROVIDER_SECRET')
        span = exporter.get_finished_spans()[-1]
        self.assertEqual(span.status.status_code, StatusCode.ERROR)
        self.assertIsNone(span.status.description)
        self.assertEqual(span.events, ())
        self.assertNotIn('PROVIDER_SECRET', str(span.attributes))

    def test_unhandled_http_error_still_counts_500_without_exception_contents(self):
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
        exporter = InMemorySpanExporter()
        provider = TracerProvider(shutdown_on_exit=False)
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        self.addCleanup(provider.shutdown)
        app = create_app(identities=IDENTITIES, tracer_provider=provider)
        @app.get('/failure')
        def failure():
            raise RuntimeError('INTERNAL_SECRET')
        client = self.enterContext(TestClient(app, raise_server_exceptions=False))
        self.assertEqual(client.get('/failure?credential=QUERY_SECRET').status_code, 500)
        span = exporter.get_finished_spans()[-1]
        self.assertEqual(span.attributes['http.response.status_code'], 500)
        self.assertEqual(span.events, ())
        self.assertNotIn('QUERY_SECRET', str(span.attributes))
