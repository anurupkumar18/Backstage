"""FastAPI entry point for the local incident demo."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from pydantic import TypeAdapter

from .contracts import validate_action, validate_signal
from .engine import ApiError, Identity, IncidentStore

LOGGER = logging.getLogger("backstage.incident_api")
ROOMS = {"room-b": "Room B", "room-c": "Room C"}


def utc_now():
    return datetime.now(timezone.utc)


def create_app(*, clock=utc_now, identities=None, tracer_provider=None):
    if os.getenv("APP_MODE", "mock") != "mock":
        raise RuntimeError("The Room B API currently supports APP_MODE=mock.")
    if identities is None:
        identities = TypeAdapter(dict[str, Identity]).validate_json(os.getenv("AUTH_TOKENS_JSON", "{}"))
    if tracer_provider is None:
        tracer_provider = TracerProvider(shutdown_on_exit=False)
    tracer = tracer_provider.get_tracer("backstage.incident-api")
    store = IncidentStore(tracer)

    def advance_deadlines():
        with store.lock:
            store.tick(clock())

    async def watch_deadlines():
        while True:
            await asyncio.sleep(1)
            await asyncio.to_thread(advance_deadlines)

    @asynccontextmanager
    async def lifespan(_app):
        watcher = asyncio.create_task(watch_deadlines())
        try:
            yield
        finally:
            watcher.cancel()
            with suppress(asyncio.CancelledError):
                await watcher

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
    @app.get("/readyz")
    def health():
        return {"status": "ok"}

    @app.post("/api/v1/signals", status_code=202)
    def ingest_signal(body: dict, actor: Identity = Depends(caller)):
        validate_signal(body)
        if (
            actor.tier is not None
            or body["source_id"] not in actor.source_ids
            or body["room_id"] not in actor.room_ids
            or (actor.session_ids and body.get("session_id") not in actor.session_ids)
        ):
            raise ApiError(403, "forbidden", "This token cannot submit the requested source or location.")
        if body["kind"] != "zone_count" or body["data"]["zone"] not in {"seating", "door"}:
            raise ApiError(422, "invalid_payload", "This demo only accepts seating and door counts.")
        with store.lock:
            now = clock()
            store.tick(now)
            return store.ingest(body, now)

    @app.get("/api/v1/status")
    def public_status(actor: Identity = Depends(caller)):
        if actor.tier is None:
            raise ApiError(403, "forbidden", "This token is scoped to signal ingress.")
        with store.lock:
            store.tick(clock())
            rooms = []
            for room_id, label in ROOMS.items():
                incident = store.active.get(room_id)
                status = "normal"
                if incident is not None:
                    status = "recovering" if incident.state in {"accepted", "verifying"} else "affected"
                rooms.append({"room_id": room_id, "label": label, "status": status, "accessibility_status": None})
            return {"rooms": rooms, "sessions": []}

    @app.get("/api/v1/incidents")
    def list_incidents(actor: Identity = Depends(caller)):
        if actor.tier in {None, 0}:
            raise ApiError(403, "forbidden", "Incident access requires an authorized role.")
        with store.lock:
            store.tick(clock())
            scoped = (incident for incident in store.incidents.values() if actor.can_read(incident))
            newest = sorted(scoped, key=lambda incident: incident.updated_at, reverse=True)
            return {"items": [incident.view(actor) for incident in newest], "next_cursor": None}

    @app.get("/api/v1/incidents/{incident_id}")
    def incident_detail(incident_id: str, actor: Identity = Depends(caller)):
        with store.lock:
            store.tick(clock())
            return store.read(incident_id, actor).view(actor)

    @app.get("/api/v1/incidents/{incident_id}/events")
    def incident_events(incident_id: str, actor: Identity = Depends(caller)):
        with store.lock:
            store.tick(clock())
            return {"items": list(store.read(incident_id, actor).events), "next_cursor": None}

    @app.post("/api/v1/incidents/{incident_id}/actions")
    def incident_action(
        incident_id: str,
        body: dict,
        key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
        actor: Identity = Depends(caller),
    ):
        validate_action(body, key)
        with store.lock:
            return store.apply_action(incident_id, actor, key, body, clock())

    return app
