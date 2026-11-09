# badge-simulator

Badge Stations A and B and the `badge-control` service on port 8090. See the [Ali handoff](../../docs/handoffs/ali.md) and the [badge contract](../../contracts/badge.v1.schema.json). Owner: Ali.

Python 3.12+ and only the standard library at runtime. The tests use the repo's `requirements-check.txt` (jsonschema) to validate payloads against the shared contracts.

## Run it

From the repo root, after `make check`'s venv setup (on Windows the interpreter is `.venv/Scripts/python`):

```sh
cd services/badge-simulator
../../.venv/bin/python -m badge_sim smoke                       # local A-to-B failover, exits 0 on success
../../.venv/bin/python -m badge_sim smoke --split               # same, with control and each station as separate apps over HTTP
../../.venv/bin/python -m unittest discover -s tests -t .       # unit tests (includes both smokes and the deploy checks)
```

## Roles

`BADGE_ROLE` picks what a process runs:

| Role | Runs | Used for |
| --- | --- | --- |
| `all` (default) | badge-control and both stations in one process | local development, `smoke` |
| `control` | badge-control only. It owns the queue, heartbeats and PDFs, and exposes `/internal/stations/...` and `PUT /internal/pdfs/...` to station pods. | `Deployment/badge-control` |
| `station` | one station (`BADGE_STATION_ID`) that heartbeats to `BADGE_CONTROL_URL`, prints its queue and uploads PDFs. badge-control reports ages instead of timestamps, so pod clocks never need to agree. | `Deployment/badge-station-a`, `-b` |

Manifests and the staged Kubernetes outage are in [deploy/badge](../../deploy/badge/README.md).

The smoke starts badge-control, both stations and a recording incident-API stub. Its first signal post returns 503 so retries are exercised. Then it stops Station A, seeds `badge-job-001..003` on A, waits for Station B to report A offline, runs the mock diagnosis, reroutes (and replays the same `Idempotency-Key`, and checks a changed body gets `409 idempotency_conflict`), waits for B to print all three PDFs, and checks one `badge_job_complete` signal per job. Every signal and HTTP payload is validated against `contracts/`.

To run the service and drive it by hand. The `/admin/*` routes need the service token and exist only with `BADGE_ADMIN_ENABLED=true`. They drive the seeded badge scenario, so label them as rehearsal controls in the demo.

```sh
export BADGE_INTERNAL_TOKEN=dev-token BADGE_ADMIN_ENABLED=true
export INCIDENT_API_BASE_URL=http://127.0.0.1:8000/api/v1 BADGE_SIGNAL_TOKEN=...   # omit to record signals only
python -m badge_sim serve &
python -m badge_sim fault --station station-a
python -m badge_sim seed  --station station-a
python -m badge_sim state
curl -s -X POST localhost:8090/internal/radar/diagnose -H "Authorization: Bearer dev-token" \
  -H 'Content-Type: application/json' -d '{"incident_id":"inc-badge_stall-room-c","station_id":"station-a"}'
curl -s -X POST localhost:8090/internal/badges/reroute -H "Authorization: Bearer dev-token" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: reroute-1' \
  -d '{"incident_id":"inc-badge_stall-room-c","from_station_id":"station-a","to_station_id":"station-b","job_ids":["badge-job-001","badge-job-002","badge-job-003"]}'
curl -s localhost:8090/internal/badges/jobs/badge-job-001 -H "Authorization: Bearer dev-token"
python -m badge_sim reset
```

## Behavior

| Piece | What it does |
| --- | --- |
| Stations | Each heartbeats every `BADGE_HEARTBEAT_SECONDS`, prints its pending jobs, and watches its peer. Stopping a station (`fault`) stops its heartbeat and queue. |
| Outage evidence | When a peer's heartbeat is older than `BADGE_HEARTBEAT_TIMEOUT` and it has pending jobs, the survivor emits `badge_health` `offline` with `pending_job_ids` and `oldest_pending_age_s`, then repeats every `BADGE_HEALTH_REPORT_SECONDS` with the age updated, and emits `healthy` once the peer is back. |
| Reroute | Bearer `BADGE_INTERNAL_TOKEN`, `Idempotency-Key` required. Stations outside the namespace get 403. Target must be online (else `409 invalid_transition`). Jobs move atomically, and jobs already moved or complete are accepted again. The same key and body return the original response, and a changed body gets `409 idempotency_conflict`. Keys are scoped to the incident. |
| PDFs | `pdf-<job_id>`, written before the job reads `complete` and before its signal. A retry or failover reuses the same file and reference. PDFs hold only the job ID and station, no attendee data. |
| Signals | Queued in an outbox and retried with the same `signal_id` until accepted. Completion IDs are `badge_job_complete-<job_id>-<run_id>`: stable across retries and failover, new when a job is re-seeded after a reset. Health IDs are `<source>-badge_health-<station>-<run_id>-<seq>`, with a new `run_id` whenever a station starts. `reset` also clears the outbox. 4xx rejections are logged and not retried. |
| Diagnose | `RADAR_MODE=mock` reads local heartbeats. `RADAR_MODE=radar` calls Radar MCP; see [radar/](radar/README.md). |
| Tracing | Spans for HTTP routes, print, reroute and diagnose when the OpenTelemetry SDK is installed; `traceparent` is forwarded on signal posts. No-op otherwise. |

## Not done yet

- `BADGE_STORE=elastic`. badge-control keeps the queue in memory (`MemoryStore`, the labeled fake), so restarting the badge-control pod loses queued jobs. Stations survive their own restarts.
- Applying the manifests to the cluster and capturing the Radar evidence for a real Station A stop. That needs `kubectl` and cluster credentials.
- Replay against Luke's real incident API (`INCIDENT_API_BASE_URL`) once it accepts `badge_health` and `badge_job_complete`.
