"""FastAPI entry point for the local incident demo."""

import asyncio
import os
import re
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from time import monotonic
from typing import Annotated

from elasticsearch import Elasticsearch
from fastapi import Depends, FastAPI, Header, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.metrics import Observation
from pydantic import TypeAdapter

from .badges import BADGE_KINDS, BADGE_ROOM, BadgeControl, BadgeUnavailable, apply_result, next_command
from .contracts import BADGE_SCHEMA, validate_action, validate_signal
from .engine import ApiError, Identity
from .persistence import ElasticsearchCheckpoint, IncidentRuntime
from .evidence import EVENT_TYPES, EvidenceProjection, diagnostics, evidence_unavailable
from .telemetry import Telemetry

ROOMS = {"room-b": "Room B", "room-c": "Room C"}


def utc_now():
    return datetime.now(timezone.utc)


def configured_checkpoint():
    mode = os.getenv("APP_MODE", "mock")
    if mode == "mock":
        return None
    if mode != "live":
        raise RuntimeError("APP_MODE must be mock or live.")
    url = os.getenv("ELASTICSEARCH_URL")
    api_key = os.getenv("ELASTICSEARCH_API_KEY")
    prefix = os.getenv("ELASTICSEARCH_INDEX_PREFIX", "backstage")
    if not url or not api_key:
        raise RuntimeError("Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY for APP_MODE=live.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", prefix):
        raise RuntimeError("ELASTICSEARCH_INDEX_PREFIX must be a lowercase index prefix.")
    client = Elasticsearch(url, api_key=api_key, request_timeout=5, max_retries=0)
    return ElasticsearchCheckpoint(client, f"{prefix}-overflow-state")


def create_app(*, clock=utc_now, identities=None, tracer_provider=None, checkpoint=None, badge_control=None,
               evidence_projection=None, meter_provider=None, logger_provider=None):
    if identities is None:
        identities = TypeAdapter(dict[str, Identity]).validate_json(os.getenv("AUTH_TOKENS_JSON", "{}"))
    telemetry = Telemetry(tracer_provider=tracer_provider, meter_provider=meter_provider,
                          logger_provider=logger_provider)
    tracer = telemetry.tracer
    runtime = IncidentRuntime(tracer, configured_checkpoint() if checkpoint is None else checkpoint, telemetry)
    if isinstance(runtime.checkpoint, ElasticsearchCheckpoint):
        runtime.checkpoint.telemetry = telemetry
        if evidence_projection is None and os.getenv("EVIDENCE_PROJECTION_ENABLED", "false").lower() == "true":
            prefix = os.getenv("ELASTICSEARCH_INDEX_PREFIX", "backstage")
            evidence_projection = EvidenceProjection(runtime.checkpoint.client, f"{prefix}-incident-evidence",
                                                       tracer, telemetry)
    if evidence_projection is not None:
        evidence_projection.telemetry = telemetry

    def projection_lag(_options):
        snapshot = runtime.committed
        indexed = evidence_projection.indexed_revision if evidence_projection else None
        if snapshot is None or snapshot.revision is None or indexed is None:
            return []
        return [Observation(max(0, snapshot.revision[0] - indexed[0]))]

    telemetry.meter.create_observable_gauge("backstage.evidence.projection.lag", callbacks=[projection_lag], unit="1")

    def project_evidence():
        if evidence_projection is not None:
            try:
                evidence_projection.project(runtime.snapshot())
            except ApiError:
                evidence_projection.last_error = "checkpoint_unavailable"

    async def watch_projection(stop):
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=5)
                return
            except TimeoutError:
                await asyncio.to_thread(project_evidence)

    if badge_control is None:
        badge_url = os.getenv("BADGE_SERVICE_URL")
        badge_token = os.getenv("BADGE_INTERNAL_TOKEN")
        if badge_url and badge_token:
            badge_control = BadgeControl(badge_url, badge_token, BADGE_SCHEMA)

    def in_state(operation):
        def execute(store):
            now = clock()
            store.tick(now)
            return operation(store, now)

        return runtime.run(execute)

    def advance_work():
        runtime.run(lambda store: store.tick(clock()))
        if badge_control is None or (command := runtime.run(next_command)) is None:
            return
        try:
            with tracer.start_as_current_span(
                "badge.tool", context=command.trace_context,
                attributes={"incident.id": command.incident_id, "badge.operation": command.operation},
            ):
                result = badge_control.execute(command)
        except BadgeUnavailable:
            telemetry.event("badge.retry", incident_id=command.incident_id, operation=command.operation)
            return
        runtime.run(lambda store: apply_result(store, command, result, clock()))

    async def watch_work(stop):
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=1)
                return
            except TimeoutError:
                pass
            with suppress(ApiError):
                await asyncio.to_thread(advance_work)

    @asynccontextmanager
    async def lifespan(_app):
        stop = asyncio.Event()
        watcher = asyncio.create_task(watch_work(stop))
        projector = asyncio.create_task(watch_projection(stop))
        try:
            yield
        finally:
            stop.set()
            try:
                await asyncio.gather(watcher, projector)
            finally:
                await asyncio.to_thread(runtime.close)
                await asyncio.to_thread(telemetry.close)

    app = FastAPI(title="Backstage Incident API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime = runtime
    app.state.project_evidence = project_evidence
    app.state.evidence_projection = evidence_projection
    app.state.telemetry = telemetry
    origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins if origin.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "traceparent", "tracestate"],
    )

    @app.middleware("http")
    async def trace_request(request, call_next):
        started = monotonic()
        context = TraceContextTextMapPropagator().extract(dict(request.headers))
        with tracer.start_as_current_span("http.request", context=context, kind=SpanKind.SERVER,
                                          record_exception=False, set_status_on_exception=False,
                                          attributes={"http.request.method": request.method}) as span:
            response = None
            try:
                response = await call_next(request)
                return response
            finally:
                route = request.scope.get("route")
                route_name = route.path if route else "unmatched"
                status = response.status_code if response is not None else 500
                span.set_attribute("http.route", route_name)
                span.set_attribute("http.response.status_code", status)
                if status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                attrs = {"method": request.method, "route": route_name, "status_code": status}
                telemetry.count("backstage.http.requests", attrs)
                telemetry.duration("backstage.http.request.duration", monotonic() - started, attrs)
                telemetry.event("http.request", **attrs)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError):
        if error.status in {401, 403}:
            telemetry.event("http.denied", method=request.method, status_code=error.status)
        return JSONResponse({"error": {"code": error.code, "message": str(error)}}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def malformed_request(_request: Request, _error: RequestValidationError):
        return JSONResponse(
            {"error": {"code": "invalid_payload", "message": "Expected a valid JSON request body."}},
            status_code=422,
        )

    def caller(authorization: Annotated[str | None, Header()] = None):
        scheme, _, token = (authorization or "").partition(" ")
        actor = identities.get(token) if scheme.lower() == "bearer" and token else None
        if actor is None:
            raise ApiError(401, "unauthorized", "A valid bearer token is required.")
        return actor

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/readyz")
    def ready():
        runtime.check()
        return {"status": "ok"}

    @app.post("/api/v1/signals", status_code=202)
    def ingest_signal(body: dict, actor: Identity = Depends(caller)):
        validate_signal(body)
        if (
            actor.tier is not None
            or body["source_id"] not in actor.source_ids
            or body["room_id"] not in actor.room_ids
            or body["kind"] not in actor.signal_kinds
            or (actor.session_ids and body.get("session_id") not in actor.session_ids)
        ):
            raise ApiError(403, "forbidden", "This token cannot submit the requested source or location.")
        kind = body["kind"]
        if kind in BADGE_KINDS and body["room_id"] == BADGE_ROOM:
            if badge_control is None:
                raise ApiError(503, "unavailable", "Badge control is not configured.")
        elif kind != "zone_count" or body["data"]["zone"] not in {"seating", "door"}:
            raise ApiError(422, "invalid_payload", "Unsupported signal for this demo.")
        return in_state(lambda store, now: store.ingest(body, now))

    @app.get("/api/v1/status")
    def public_status(actor: Identity = Depends(caller)):
        if actor.tier is None:
            raise ApiError(403, "forbidden", "This token is scoped to signal ingress.")

        def project(store, _now):
            rooms = []
            for room_id, label in ROOMS.items():
                incidents = [item for item in store.active.values() if item.room_id == room_id]
                status = "normal"
                if incidents:
                    recovering = all(item.state in {"accepted", "verifying"} for item in incidents)
                    status = "recovering" if recovering else "affected"
                rooms.append({"room_id": room_id, "label": label, "status": status, "accessibility_status": None})
            return {"rooms": rooms, "sessions": []}

        return in_state(project)

    @app.get("/api/v1/incidents")
    def list_incidents(actor: Identity = Depends(caller)):
        if actor.tier in {None, 0}:
            raise ApiError(403, "forbidden", "Incident access requires an authorized role.")

        def list_scoped(store, _now):
            scoped = (incident for incident in store.incidents.values() if actor.can_read(incident))
            newest = sorted(scoped, key=lambda incident: incident.updated_at, reverse=True)
            return {"items": [incident.view(actor) for incident in newest], "next_cursor": None}

        return in_state(list_scoped)

    @app.get("/api/v1/incidents/{incident_id}")
    def incident_detail(incident_id: str, actor: Identity = Depends(caller)):
        return in_state(lambda store, _now: store.read(incident_id, actor).view(actor))

    @app.get("/api/v1/incidents/{incident_id}/events")
    def incident_events(incident_id: str, actor: Identity = Depends(caller)):
        def timeline(store, _now):
            return {"items": list(store.read(incident_id, actor).events), "next_cursor": None}

        return in_state(timeline)

    @app.get("/api/v1/incidents/{incident_id}/diagnostics")
    def incident_diagnostics(incident_id: str, actor: Identity = Depends(caller)):
        in_state(lambda store, _now: store.read(incident_id, actor))
        return diagnostics(runtime.snapshot(), incident_id, actor, evidence_projection, clock(),
                           os.getenv("DASH0_TRACE_URL_TEMPLATE"), durable=runtime.checkpoint is not None)

    @app.get("/api/v1/evidence/search")
    def search_evidence(
        actor: Identity = Depends(caller),
        q: str = Query(default="", max_length=200),
        room_id: str | None = Query(default=None, min_length=1, max_length=128),
        event_type: str | None = Query(default=None, max_length=32),
        from_at: str | None = Query(default=None, alias="from", max_length=40),
        to_at: str | None = Query(default=None, alias="to", max_length=40),
        limit: int = Query(default=20, ge=1, le=50),
    ):
        if actor.tier in {None, 0}:
            raise ApiError(403, "forbidden", "Incident access requires an authorized role.")
        parsed = []
        for value in (from_at, to_at):
            if value is None:
                parsed.append(None)
                continue
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)", value):
                    raise ValueError()
                at = datetime.fromisoformat(value)
                if at.utcoffset() is None or at.utcoffset().total_seconds() != 0:
                    raise ValueError()
                parsed.append(at)
            except ValueError:
                raise ApiError(422, "invalid_payload", "Search times must be UTC RFC 3339 timestamps.")
        if parsed[0] is not None and parsed[1] is not None and parsed[0] > parsed[1]:
            raise ApiError(422, "invalid_payload", "Search start must not be after its end.")
        if event_type is not None and event_type not in EVENT_TYPES:
            raise ApiError(422, "invalid_payload", "Unknown evidence event type.")
        authorized = in_state(lambda store, _now: sorted(item.id for item in store.incidents.values()
                                                        if actor.can_read(item)))
        if evidence_projection is None:
            raise evidence_unavailable()
        hits = evidence_projection.search(authorized, q=q, room_id=room_id, event_type=event_type,
                                           from_at=from_at, to_at=to_at, limit=limit)

        def recheck(store):
            items = []
            fields = ("document_id", "kind", "incident_id", "room_id", "event_type", "occurred_at",
                      "received_at", "summary", "signal_id", "event_id", "sequence", "trace_id")
            for hit in hits:
                doc = hit.get("_source", {})
                item = store.incidents.get(doc.get("incident_id"))
                if item is None or not actor.can_read(item):
                    continue
                if doc.get("event_id") not in {event["event_id"] for event in item.events}:
                    raise evidence_unavailable()
                try:
                    items.append({field: doc[field] for field in fields})
                except KeyError:
                    raise evidence_unavailable()
            return items

        items = runtime.run(recheck)
        # Exact size of the bounded authorized result page, never an unscoped Elasticsearch count.
        return {"items": items, "total": len(items), "limit": limit,
                "projection": evidence_projection.freshness(runtime.snapshot())}

    @app.post("/api/v1/incidents/{incident_id}/actions")
    def incident_action(
        incident_id: str,
        body: dict,
        key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
        actor: Identity = Depends(caller),
    ):
        validate_action(body, key)
        return in_state(lambda store, now: store.apply_action(incident_id, actor, key, body, now))

    return app
