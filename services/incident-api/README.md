# Incident API

This service runs the Room B overflow rehearsal. A count replay opens an incident, the organizer approves the Venue plan, and the assigned staff member accepts it. The public view returns to normal after 60 seconds of below-threshold evidence.

## Start locally

From the repository root:

    python3 -m venv .venv
    .venv/bin/python -m pip install -r services/incident-api/requirements-test.txt
    cd services/incident-api
    cp .env.example .env
    set -a
    . ./.env
    set +a
    ../../.venv/bin/python -m uvicorn backstage_api.main:create_app --factory --no-access-log --host 127.0.0.1 --port "$API_PORT"

Set the web app's API base URL to http://127.0.0.1:8000/api/v1 and disable its mock API when it is ready. The example allows the browser origin http://localhost:5173. Set CORS_ALLOWED_ORIGINS to the actual web origin if it differs.

Use Bearer tokens from the example only for local rehearsal. Enter demo-organizer for approval, demo-staff for the first assignment, demo-backup for the replacement, and demo-attendee for the public status view. The server derives each role from its token.

## Rehearse with the board

1. In another terminal, from the repository root, run:

       CAM_SIGNAL_TOKEN=demo-camera .venv/bin/python services/incident-api/replay_overflow.py trigger

2. Approve the Venue plan as the organizer. Poll the incident for the dispatched assignment, then accept it as the assignee. Action responses describe the completed human step. The incident read includes any subsequent automated dispatch.
3. Start the 60-second clearing replay after the staff member accepts:

       CAM_SIGNAL_TOKEN=demo-camera .venv/bin/python services/incident-api/replay_overflow.py clear

4. Check that the public view stays in recovery until the last sample. The final timeline event lists the signal IDs that proved recovery.

Use GET /api/v1/status for the public room view and GET /api/v1/incidents for the organizer board. See the [v1 contract](../../contracts/openapi.yaml) for request and response shapes. Room B counts in the shared replay have no session ID, so a session-scoped identity sees an empty list. Report intake and other incident types remain follow-up work; optional telemetry export is described below.

Run make check-api from the repository root for the accelerated lifecycle and permissions checks.

## Keep incidents across restarts

The default mock mode keeps data in memory. For live mode, provision the [overflow state index](../../data/elasticsearch/README.md), then set APP_MODE=live, ELASTICSEARCH_URL, and ELASTICSEARCH_API_KEY in your local environment before using the start command above. ELASTICSEARCH_INDEX_PREFIX defaults to backstage. Run one API worker per alias. GET /readyz returns 503 when the store is unavailable.

An approval returns success only after Elasticsearch saves the checkpoint. If an action returns 503, retry with the same body and Idempotency-Key. If a signal returns 503, retry the same signal ID and payload. A retry can return the original result after the API restarts.

To run the real Elasticsearch restart smoke test, first provision the empty backstage-smoke-overflow-state alias described above. With the same local environment loaded, run this from the repository root:

    APP_MODE=live ELASTICSEARCH_INDEX_PREFIX=backstage-smoke BACKSTAGE_LIVE_SMOKE=1 make check-api

This runs one synthetic Room B incident through closure and leaves the resulting record in the smoke index. Use an empty smoke index for each clean run.

## Rehearse a badge outage

Use the badge identities in the service's .env.example. If you already have a local .env, add demo-badge-source, demo-it-staff, and demo-it-backup to AUTH_TOKENS_JSON. Keep your existing values for Elasticsearch. Set BADGE_SERVICE_URL to the badge-control origin, normally http://127.0.0.1:8090 for a local rehearsal, and set BADGE_INTERNAL_TOKEN to the same value in both services. Give the simulator INCIDENT_API_BASE_URL=http://127.0.0.1:8000/api/v1 and BADGE_SIGNAL_TOKEN=demo-badge-source.

1. Start the API and badge simulator. Follow [the simulator's rehearsal steps](../badge-simulator/README.md) to stop Station A and seed the jobs there.
2. Wait for a Room C badge incident and its diagnosis. Approve the plan with demo-organizer, then accept with the assigned IT identity, usually demo-it-staff.
3. The API calls badge-control to reroute the captured job IDs. Wait for the timeline to close the incident after all three completion signals match Station B's job and PDF records.

Use the board or the documented v1 incident action endpoints for approval and acceptance. The API owns the reroute during this rehearsal. The badge-control token stays with the services. Badge evidence and the pending reroute are included in the Elasticsearch checkpoint in live mode.

To run the integration test with a separate simulator checkout, install the API test requirements and run from this repository root:

    BADGE_SMOKE_SOURCE=/path/to/ali-checkout/services/badge-simulator make check-api

The test starts both APIs on temporary loopback ports and runs in mock storage mode.

## Inspect and search committed evidence

`GET /api/v1/incidents/{id}/diagnostics` uses the incident's read permission. It reports checkpoint persistence mode, the actual stored signal observation and receipt times, count facts, event/signal references, recovery requirements, projection freshness, and the incident trace ID. Existing signal provenance is `unknown`; neither a source ID nor a replay-shaped signal establishes a live origin. A completed recovery retains its verified duration after samples age. The checkpoint-backed `/events` timeline remains authoritative.

`GET /api/v1/evidence/search` accepts `q` (up to 200 characters), `room_id`, `event_type`, UTC RFC 3339 `from` and `to`, and `limit` (1–50, default 20). The server builds a bounded text query with authorized incident IDs before accessing hits, then rechecks each incident's authorization. The response's `total` counts the returned authorized page, not all possible matches. No user-provided Elasticsearch DSL is accepted. Disabled or unavailable evidence returns an explicit 503, while a genuine empty search returns an empty page and its projection freshness.

Provision the [separate event index](../../data/elasticsearch/README.md#committed-incident-evidence) before setting `EVIDENCE_PROJECTION_ENABLED=true` in live mode. The projector runs every five seconds using an immutable copy of the acknowledged checkpoint, with Elasticsearch work outside the runtime lock. It creates deterministic event IDs, checks existing documents' actual content hashes on conflicts, checks every bulk item, then refreshes before advancing `indexed_revision`. A failure preserves the previous watermark and retries. Restart rebuilds projection coverage from the checkpoint without rewriting or duplicating event documents. The current single-writer requirement remains in force.

## Export application telemetry

Install the pinned requirements, set `OTEL_ENABLED=true`, and use `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` with `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`. Standard `OTEL_EXPORTER_OTLP_HEADERS` supports a server-side exporter credential when needed. Prefer the collector's internal unauthenticated receiver so the vendor credential remains there. `OTEL_SERVICE_NAME` defaults to `incident-api`; `OTEL_RESOURCE_ATTRIBUTES` can set `service.version` and `deployment.environment.name`. `CODE_SHA` is a fallback release value. Export queues are bounded, each exporter request times out after two seconds, and final telemetry shutdown waits at most three seconds. Export failure does not change API outcomes.

Incoming W3C `traceparent` context is extracted. Elasticsearch operations have spans and low-cardinality duration/outcome metrics. `incident.transition.attempt` and `incident.raise.attempt` describe speculative work. Only acknowledged transitions emit `incident.transition` spans, `incident.transition.committed` logs, and `backstage.incident.transitions` counts; later human request spans are linked to those incident spans. Memory-mode commits explicitly carry `storage.mode=memory` and do not claim durable storage.

Application logs are JSON from an allowlist of event/operation/outcome, generated incident/event references, state/storage mode, HTTP method/route/status, count and trace ID. They never include HTTP bodies, queries, authorization headers, idempotency keys, Elasticsearch document bodies or exception contents. Start Uvicorn with `--no-access-log` so its default access log does not independently print query strings. The deployment uses that flag.

Optional `DASH0_TRACE_URL_TEMPLATE` creates a trace link without querying Dash0. It must have one `{trace_id}` placeholder, an HTTPS `dash0.com` host or subdomain, and no userinfo, query or fragment. Invalid templates yield a null link. A trace ID/link alone is not evidence that Dash0 ingested it.

Metric contract (duration units are seconds):

| Instrument | Attributes |
| --- | --- |
| `backstage.http.requests`, `backstage.http.request.duration` | `method`, `route`, `status_code` |
| `backstage.persistence.operations`, `backstage.elasticsearch.request.duration` | `operation` = load/save/project/search; `outcome` = success/error |
| `backstage.incident.transitions` | `event.type`, `state`, `storage.mode` |
| `backstage.evidence.documents` | `kind=event`, `outcome=success/error` (create/conflict-check attempts) |
| `backstage.evidence.projection.duration`, `backstage.evidence.search.duration` | `outcome=success/error` |
| `backstage.evidence.projection.lag` | Checkpoint sequence-number gap, unit `1`; no observation until a real indexed revision exists |

No full deadline/SLO timers are emitted by this implementation. A projection watermark is local to the running projector and is re-established on restart only after all creates/conflicts and refresh succeed.
