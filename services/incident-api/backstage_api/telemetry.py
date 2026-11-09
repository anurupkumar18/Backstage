"""Explicit, fail-open OTLP providers and allowlisted structured application events."""

import json
import logging
import os
from contextlib import contextmanager, suppress
from threading import Thread
from time import monotonic

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry._logs import SeverityNumber
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

LOGGER = logging.getLogger('backstage.incident_api.events')
DURATION_BOUNDS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
LOG_FIELDS = frozenset({'event', 'operation', 'outcome', 'incident_id', 'event_id', 'event_type',
                        'state', 'storage_mode', 'method', 'route', 'status_code', 'trace_id', 'count'})


class Telemetry:
    def __init__(self, *, tracer_provider=None, meter_provider=None, logger_provider=None):
        configured_resource = Resource.create()
        attributes = dict(configured_resource.attributes)
        if not attributes.get('service.name') or str(attributes['service.name']).startswith('unknown_service'):
            attributes['service.name'] = os.getenv('OTEL_SERVICE_NAME', 'incident-api')
        attributes.setdefault('service.version', os.getenv('CODE_SHA', 'unknown'))
        resource = Resource(attributes)
        duration_view = View(instrument_name='backstage.*.duration',
                             aggregation=ExplicitBucketHistogramAggregation(DURATION_BOUNDS))
        self.owns_trace = tracer_provider is None
        self.owns_meter = meter_provider is None
        self.owns_logs = logger_provider is None
        self.tracer_provider = tracer_provider or TracerProvider(resource=resource, shutdown_on_exit=False)
        self.meter_provider = meter_provider or MeterProvider(resource=resource, views=[duration_view], shutdown_on_exit=False)
        self.logger_provider = logger_provider or LoggerProvider(resource=resource, shutdown_on_exit=False)
        self.tracer = self.tracer_provider.get_tracer('backstage.incident-api')
        self.logger = self.logger_provider.get_logger('backstage.incident-api')
        meter = self.meter_provider.get_meter('backstage.incident-api')
        self.counters = {name: meter.create_counter(name) for name in (
            'backstage.http.requests', 'backstage.persistence.operations',
            'backstage.evidence.documents', 'backstage.incident.transitions')}
        self.durations = {name: meter.create_histogram(name, unit='s') for name in (
            'backstage.http.request.duration', 'backstage.elasticsearch.request.duration',
            'backstage.evidence.projection.duration', 'backstage.evidence.search.duration')}
        self.meter = meter
        if os.getenv('OTEL_ENABLED', '').lower() == 'true':
            # Exporters use standard OTEL_EXPORTER_OTLP_* variables. No global providers,
            # automatic HTTP instrumentation, request payloads, or exporter credentials in logs.
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
                from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
                from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
                from opentelemetry.sdk.trace.export import BatchSpanProcessor
                from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
                from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
                if self.owns_trace:
                    self.tracer_provider.add_span_processor(BatchSpanProcessor(
                        OTLPSpanExporter(timeout=2), max_queue_size=512, max_export_batch_size=64,
                        schedule_delay_millis=1000, export_timeout_millis=2000))
                if self.owns_logs:
                    self.logger_provider.add_log_record_processor(BatchLogRecordProcessor(
                        OTLPLogExporter(timeout=2), max_queue_size=512, max_export_batch_size=64,
                        schedule_delay_millis=1000, export_timeout_millis=2000))
                if self.owns_meter:
                    self.meter_provider.shutdown()
                    reader = PeriodicExportingMetricReader(OTLPMetricExporter(timeout=2),
                                                           export_interval_millis=5000,
                                                           export_timeout_millis=2000)
                    self.meter_provider = MeterProvider(resource=resource, metric_readers=[reader], views=[duration_view],
                                                        shutdown_on_exit=False)
                    self.meter = self.meter_provider.get_meter('backstage.incident-api')
                    self.counters = {name: self.meter.create_counter(name) for name in self.counters}
                    self.durations = {name: self.meter.create_histogram(name, unit='s') for name in self.durations}
            except Exception:
                self.event('telemetry.configuration', outcome='disabled')

    def count(self, name, attributes, amount=1):
        with suppress(Exception):
            self.counters[name].add(amount, attributes)

    def duration(self, name, elapsed, attributes):
        with suppress(Exception):
            self.durations[name].record(elapsed, attributes)

    def event(self, event, **fields):
        fields['event'] = event
        span = trace.get_current_span().get_span_context()
        if span.is_valid:
            fields['trace_id'] = f'{span.trace_id:032x}'
        safe = {key: value for key, value in fields.items() if key in LOG_FIELDS and value is not None}
        # JSON is constructed only from allowlisted scalar fields; never log exception text.
        with suppress(Exception):
            LOGGER.info(json.dumps(safe, sort_keys=True))
            self.logger.emit(body=json.dumps(safe, sort_keys=True), attributes=safe,
                             severity_number=SeverityNumber.INFO, severity_text='INFO')

    @contextmanager
    def es_operation(self, operation):
        started, outcome = monotonic(), 'success'
        try:
            with self.tracer.start_as_current_span('elasticsearch.' + operation,
                                                   attributes={'db.system.name': 'elasticsearch',
                                                               'db.operation.name': operation},
                                                   record_exception=False, set_status_on_exception=False) as span:
                try:
                    yield
                except Exception:
                    outcome = 'error'
                    span.set_status(Status(StatusCode.ERROR))
                    raise
                finally:
                    span.set_attribute('operation.outcome', outcome)
        finally:
            attrs = {'operation': operation, 'outcome': outcome}
            self.count('backstage.persistence.operations', attrs)
            self.duration('backstage.elasticsearch.request.duration', monotonic() - started, attrs)

    def close(self):
        def shutdown():
            for owned, provider in ((self.owns_trace, self.tracer_provider),
                                    (self.owns_meter, self.meter_provider),
                                    (self.owns_logs, self.logger_provider)):
                if owned:
                    with suppress(Exception):
                        provider.force_flush(timeout_millis=1000)
                    with suppress(Exception):
                        provider.shutdown()
        # A blocked collector must never prevent service shutdown indefinitely.
        worker = Thread(target=shutdown, daemon=True, name='telemetry-shutdown')
        worker.start()
        worker.join(timeout=3)
