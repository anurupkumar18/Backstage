"""FastAPI entry point for the local incident demo."""

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Annotated

from elasticsearch import Elasticsearch
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from pydantic import TypeAdapter

from .badges import BADGE_KINDS, BADGE_ROOM, BadgeControl, BadgeUnavailable, apply_result, next_command
from .contracts import BADGE_SCHEMA, validate_action, validate_signal
from .engine import ApiError, Identity
from .persistence import ElasticsearchCheckpoint, IncidentRuntime

LOGGER = logging.getLogger("backstage.incident_api")
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


def create_app(*, clock=utc_now, identities=None, tracer_provider=None, checkpoint=None, badge_control=None):
    if identities is None:
        identities = TypeAdapter(dict[str, Identity]).validate_json(os.getenv("AUTH_TOKENS_JSON", "{}"))
    if tracer_provider is None:
        tracer_provider = TracerProvider(shutdown_on_exit=False)
    tracer = tracer_provider.get_tracer("backstage.incident-api")
    runtime = IncidentRuntime(tracer, configured_checkpoint() if checkpoint is None else checkpoint)
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
            LOGGER.warning("Badge operation will retry incident=%s operation=%s", command.incident_id, command.operation)
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
        try:
            yield
        finally:
            stop.set()
            try:
                await watcher
            finally:
                await asyncio.to_thread(runtime.close)

    app = FastAPI(title="Backstage Incident API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins if origin.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def trace_request(request, call_next):
        with tracer.start_as_current_span("http.request", attributes={"http.request.method": request.method}) as span:
            response = await call_next(request)
            span.set_attribute("http.response.status_code", response.status_code)
            return response

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError):
        if error.status in {401, 403}:
            trace_id = trace.get_current_span().get_span_context().trace_id
            LOGGER.warning("Request denied method=%s trace_id=%032x", request.method, trace_id)
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
