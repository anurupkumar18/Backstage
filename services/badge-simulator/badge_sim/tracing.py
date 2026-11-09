"""OpenTelemetry spans when the SDK is installed, a no-op otherwise.

Spans carry `backstage.incident_id` when known. W3C `traceparent` from an
incoming request is passed to outgoing signal posts.
"""

import contextlib

try:  # pragma: no cover - exercised only when opentelemetry is installed
    from opentelemetry import propagate, trace

    _tracer = trace.get_tracer("badge-control")
except ImportError:  # pragma: no cover
    propagate = trace = _tracer = None


def extract(headers):
    if propagate is None:
        return None
    return propagate.extract(dict(headers))


def inject(headers):
    if propagate is not None:
        propagate.inject(headers)
    return headers


@contextlib.contextmanager
def span(name, parent=None, **attributes):
    if _tracer is None:
        yield None
        return
    attrs = {f"backstage.{key}": value for key, value in attributes.items() if value is not None}
    with _tracer.start_as_current_span(name, context=parent, attributes=attrs) as current:
        yield current
