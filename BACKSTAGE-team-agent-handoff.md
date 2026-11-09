# BACKSTAGE team agent handoff

**Source** · BACKSTAGE PRD, November 9, 2026, attached to [Scaffold Team Document](chatgpt-conversation://6af20e04-0144-83e8-98f0-df3fbae5bd4a).

**Use this file** · Give every coding agent the full handoff and point it to its prompt at the end. Luke initializes the repo and lands the shared scaffold. The three contributors own the paths listed below. The API design, file paths, and mock interfaces are proposed implementation decisions to freeze in the first PR. The PRD remains the source for product scope and demo requirements.

## What we are building

BACKSTAGE is the incident commander for the conference floor. A signal opens an incident. A role-scoped agent proposes a plan. A human approves it, an eligible human accepts the assignment, and independent recovery evidence enables closure. The board, projector, and Dash0 trace should let judges follow the same incident from signal to verification. Elasticsearch holds the incident and its audit trail.

**First working slice** · Replay a Room B overflow through the real FastAPI lifecycle and React board. Show the Venue proposal, organizer approval, staff acknowledgement, verification wait, and green only after 60 seconds of below-threshold evidence. Use a seeded roster, deterministic plan text, and timestamped count fixtures. Swap fixtures for two live zone feeds and the local datastore for Elastic Cloud as soon as each adapter is ready.

**Fourth lane** · The PRD gives YOLO and laptop edge work to a fourth teammate. Assign that person at kickoff and add their ownership to the bootstrap PR. Luke publishes the counts contract and replay fixture. Kunj owns the browser stage page, including mic and caption producers. Until the edge owner is named, treat live vision as an open dependency and use count replays for development. If the lane stays vacant, explicitly reassign it before claiming live vision in the demo.

## Repository and edit boundaries

| Paths | Sole write owner | Boundary |
| --- | --- | --- |
| Root files and dotfiles, `.github/**`, `scripts/**`, `contracts/**`, `fixtures/shared/**`, `tests/integration/**` | Luke | Bootstrap, CI/Gitar rules, shared schemas and canonical fixtures, cross-service smoke tests. |
| `services/incident-api/**`, `services/agent-workers/**`, `data/elasticsearch/**`, `deploy/incident/**` | Luke | FastAPI, state machine, RBAC, routing, agent tools, storage, backend images and service manifests. |
| `services/badge-simulator/**`, `deploy/platform/**`, `deploy/badge/**`, `docs/radar/**` | Ali | Namespace and aggregate deployment, Stations A/B, fault and recovery controls, Radar MCP adapter and evidence. Put the adapter inside `services/badge-simulator/radar/`. |
| `apps/web/**`, `observability/**`, `deploy/web/**`, `deploy/dash0/**`, `docs/demo/**` | Kunj | React routes, accessible UI, frontend mock, Dash0 collector and dashboards, browser telemetry, demo runbook and recording coordination. |
| `services/cam-edge/**` | Edge teammate once named | Laptop-only YOLO count producer, zone config and count-only privacy checks. Reserved until assigned. |

- Keep each service's build file, dependencies, lockfile, environment example, local tests, and run instructions inside its owned folder. Use a root integration entry point maintained by Luke. Ali's aggregate overlay references the independently owned manifest directories. Service owners update their own deployments and tell Ali if a reference or cluster prerequisite changes.
- Everyone reads `contracts/` and `fixtures/shared/`. Consumers generate types in their own folders or import read-only. For a contract change, open a coordination issue with the JSON diff, compatibility impact, and affected mocks. Luke lands the contract PR after the affected owners agree, then consumers update their own branches. Keep v1 additive after freeze. Route renames, required fields, enum changes, and permission changes need coordinated acceptance before they land.
- If a change spans owners, split it into ordered PRs and link them. The integrator fixes conflicts in shared files. Each service owner fixes conflicts within their lane. Agents report any needed foreign-path edit in their PR instead of including it.

## Bootstrap, branches, and PRs

1. Luke creates the repo, confirms the event's scaffolding rules, and opens the hour-one Gitar PR with directory stubs, `.gitignore`, `CODEOWNERS`, CI, the path check, OpenAPI and JSON Schemas, and one happy-path fixture per boundary. Agree on service names, ports and fixture IDs. Suggested root targets are `make dev`, `make check`, and `make smoke SCENARIO=overflow`. Add `stage_av` and `badge_stall` scenario values as those slices land. Each owner documents the local command the root target invokes. Freeze the commit SHA in the kickoff note. Keep `main` deployable.
2. Contributors branch from the merged scaffold on `ali/<feature>`, `luke/<feature>`, `kunj/<feature>`, and `edge/<feature>` once the edge owner is named. Use one feature per PR and refresh from `main` before requesting merge. Squash via PR after green checks and owner review. Luke coordinates merge order for dependent PRs.
3. Protect `main` with required CI and review where the repo supports it. `CODEOWNERS` routes reviewers. A required changed-path check compares the PR diff against the owner map. Luke binds lanes to contributor handles at kickoff and reviews scaffold or owner-map changes. Cross-owner work uses linked owner-specific PRs.
4. Include changed paths, contract SHA, exact run/check commands, evidence, and remaining dependencies in each PR. CI checks schema fixtures, state transitions and tier denials, concurrent reservations against Elasticsearch, manifest validation, and lane-specific checks. Use Gitar review on every feature and verify the PR's check status before merge. Encode the PRD's three Gitar rules early: tools require tier allowlists, transitions require validation and spans, and reservation writes require deterministic IDs. Rehearse a small fixable CI failure on a disposable PR.

## Shared contract v1

Luke publishes `contracts/openapi.yaml`, `contracts/signal.v1.schema.json`, `contracts/protocol.v1.schema.json`, and `contracts/badge.v1.schema.json`. Times are UTC RFC 3339, IDs are opaque stable strings, JSON keys are snake_case, and incident versions are positive integers. Seed shared IDs `room-b`, `room-c`, `stage-b`, `station-a`, and `station-b`. All routes below are relative to `/api/v1` unless specified. Publish the full field constraints and golden examples in the bootstrap PR.

### HTTP boundary

| Route | Caller and behavior |
| --- | --- |
| `GET /healthz`, `GET /readyz` at service root | Liveness and readiness. API readiness checks its configured store. |
| `POST /signals` | Scoped source or reporter. Returns `202 {signal_id, incident_id, deduplicated}`, with nullable `incident_id` when a sample has yet to produce an incident. Retry with the same signal ID and payload. |
| `GET /status` | Tier 0+ sanitized projection for attendee and projector. Returns `{rooms:[{room_id,label,status,accessibility_status}],sessions:[{session_id,room_id,label,status,accessibility_status}]}`. Status is `normal`, `affected`, or `recovering`. Accessibility status is a short public text update or null. |
| `GET /incidents`, `GET /incidents/{id}` | Tier 1+ scoped by token. List returns `{items:[Incident],next_cursor}`. Cursor is nullable and opaque. Detail returns `Incident`. |
| `GET /incidents/{id}/events` | Same scope and redaction as detail. Returns `{items:[ProtocolEvent],next_cursor}`, ordered by incident sequence. |
| `POST /incidents/{id}/actions` | Body `{action,expected_version,payload}`, header `Idempotency-Key`, response is the updated `Incident`. Human actions use the payloads below. Internal worker operations use the same validated state-machine command path. |

`Incident` includes `id, type, room_id, session_id, priority, state, version, updated_at, summary, plan, assignment, verification, allowed_actions, trace_id`. Nullable fields are `session_id, plan, assignment, trace_id`. A plan has `id, summary`. An assignment has `id, assignee_id, domain`. Verification has `status` (`pending`, `passed`, `failed`) and nullable `summary`. Priority is `normal` or `high`. Types for the demo are `overflow`, `stage_av`, `badge_stall`, and `reported_problem`. Sort the board by priority then latest update. Poll about every two seconds for the first slice.

Browser actions are `approve {plan_id}`, `ack {assignment_id,decision}` with `accepted` or `declined`, and `handoff {assignment_id,reason}`. `allowed_actions` is actor-specific and advisory. The backend checks the current assignment, plan version, actor scope, and transition every time. Scope idempotency to actor and incident. A retry of the same authorized action with the same key and body returns the original result, even after the incident version advances. Key reuse with a different request returns conflict. Errors use `{error:{code,message}}` with `401 unauthorized`, `403 forbidden`, `404 not_found` for out-of-scope incident reads, `409 stale_version|invalid_transition|reservation_conflict|idempotency_conflict`, and `422 invalid_payload`. On conflict the UI refreshes before offering another action.

### Signal and protocol envelopes

```json
{
  "schema_version": 1,
  "signal_id": "cam-b-20261109T190000Z-01",
  "kind": "zone_count",
  "source_id": "cam-b",
  "room_id": "room-b",
  "occurred_at": "2026-11-09T19:00:00Z",
  "data": {"zone": "door", "count": 8, "threshold": 5}
}
```

| Signal kind | Required `data` | Producer |
| --- | --- | --- |
| `zone_count` | `zone` = `seating`, `door`, or `queue`. Nonnegative integer `count` and positive integer `threshold` (seating capacity or configured zone threshold). | Edge teammate. Luke provides count replay. |
| `audio_input_lost`, `audio_input_restored` | `stage_id`, `trigger` = `device` or `manual`. Optional envelope `session_id`. | Kunj's stage page. |
| `caption_stale`, `caption_line` | `stage_id`, `line_seq` for `caption_line`. Optional envelope `session_id`. | Kunj's stage page. Emit line metadata only. |
| `badge_health` | `station_id`, `status` = `healthy` or `offline`, `oldest_pending_age_s`, `pending_job_ids`. | Ali's simulator and surviving station monitor. |
| `badge_job_complete` | `station_id`, `job_id`, `pdf_ref` pointing to a simulator artifact by opaque ID. | Ali's worker, after a PDF is available. |
| `human_report` | `category`, `summary`. Optional envelope `session_id`. | Kunj's UI with scoped reporter token. |

Signal timestamps are evidence time. The API also stamps receipt time and validates freshness for live signals. Local replay runs with an injected clock and canonical signal spacing. Repeat IDs are idempotent and payload changes with a reused ID are rejected. Correlate by incident family and room or logical feed with a rolling 60-second dedup window. Map mic and captions on the same stage to one AV family and both badge stations in the same incident to one check-in family. Track verification observations against the existing active incident even after the dedup window. Count signals carry counts and zone metadata only. Keep frames, faces, caption text, and badge PII out of telemetry and fixtures.

`ProtocolEvent` fields are `schema_version,event_id,incident_id,sequence,type,occurred_at,actor,state_from,state_to,payload,trace_id`. The server stamps IDs, sequence and actor. `actor` carries `id,kind,tier` for audit, with tier nullable for system actors. `state_from` is null for the initial raise. Use event-specific payload schemas. Each event carries the associated references as applicable: `signal_id` on raise, `plan_id` on propose/approve, `assignment_id` on dispatch/ack/handoff, and `evidence_signal_ids` on verify/close. A claim names the staff domain. Store correlated signals as evidence with the same incident ID. Emit typed `escalate` as a v1 extension for the escalation path.

### Lifecycle, permission gates, and evidence

| Protocol message | State and gate |
| --- | --- |
| `raise` | Opens `detected` from an eligible signal. |
| `claim` | `detected → triaged` by an eligible domain worker. |
| `propose` | `triaged → plan_proposed` with a versioned plan and any resource requirements. |
| `approve` | `plan_proposed → approved` by a tier-3 human for that plan. |
| `dispatch` | `approved → dispatched` after any required reservation succeeds. The same action may dispatch a replacement after handoff. |
| `ack` | `dispatched → accepted` on the current assignee's human acceptance. A decline routes through handoff. |
| `handoff` | `dispatched\|accepted → approved`, releasing the assignment and preserving the reservation. The dispatcher picks the next eligible person. |
| `verify` | `accepted → verifying` when the verifier starts. Subsequent evidence can update verification while in `verifying`. |
| `close` | `verifying → resolved` only after the configured verifier passes with current evidence. |
| `escalate` | Active incident → `escalated` when the next candidate or approved recovery path runs out. Escalated stays visibly unresolved in v1. |

- Tier 0 reads sanitized status and reports problems. Tier 1 can report and read incidents within its own session. Tier 2 reads and acts within its domain, with assignment actions restricted to its own active assignment. Tier 3 sees the board and approves or initiates audited rerouting within the same lifecycle gates. Agents inherit their human's scope plus a tool allowlist. Send tokens as `Authorization: Bearer <token>`. Scope producer tokens to source IDs, signal kinds and rooms or sessions. Give the stage token stage-signal scope only. The API logs denied calls with trace correlation. The role switcher selects a configured demo identity and the server derives role and scope from its token.
- Filter by required skill and availability. Rank eligible staff deterministically by distance, load, and stable staff ID. Use a 60-second acknowledgement deadline from dispatch. On timeout, decline or stuck report, hand off to the next candidate. Escalate when the roster runs out. The LLM can draft a structured plan or explain the routing result. Deterministic templates keep the flow running without credentials.
- **Overflow** opens after door count exceeds threshold for 30 seconds while seating is at capacity. Resolve after continuous fresh door samples below threshold for 60 seconds. Stale samples reset the evidence window.
- **Stage AV** opens on mic loss. Merge stale caption heartbeat evidence within 60 seconds. Verify with a restored mic signal and a new caption line after acceptance and mic restoration. For the P0 mic rehearsal, a clearly labeled caption fixture can supply that line. Live caption heartbeat is a PRD P1 that the full mic demo needs.
- **Badge stall** opens from offline Station A with aged pending work in the seeded badge scenario. Capture affected logical job IDs in the incident. Verify all captured jobs complete with available PDFs, including after failover. The combined check-in queue scenario adds the PRD's queue trigger and queue-below-six verifier before it can be claimed.
- **Manual report** opens for triage. Associate a configured verifier before closure is possible. Priority is high for captions down and step-free access incidents. Display priority and state in text as well as color.

### Storage and retry behavior

- Use Elasticsearch indexes for incidents, events, reservations, staff, equipment, runbooks and history. Use the incident document as the authoritative aggregate. Persist transitions and their event outbox atomically in that document. Project events into the events index with stable event IDs and retry safely. The detail timeline should see committed events during projection lag. Seed the roster, compatible spare mic, and one AV and badge runbook before adding hybrid or similar-incident retrieval.
- Run one incident API writer process in the demo and serialize open-or-correlate by key there. Persist correlation state and signal IDs so a restart can recover before processing a retry. Apply Elasticsearch `if_seq_no` and `if_primary_term` to all aggregate updates. On conflict reload and validate again before applying eligible internal work. Reject stale human actions and show the newer state. Scale beyond one writer only after distributed correlation is implemented. [Elastic optimistic concurrency control](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control)
- Normalize reservations to agreed, nonoverlapping bookable slots. Use `equipment_id + slot_start_utc` as the deterministic document key and `op_type=create`. The first create wins. On 409, read the existing reservation and resume only when it belongs to the same incident and dispatch intent. Retry an interrupted dispatch from its persisted intent. Cancel or release with owner and version checks so a delayed retry cannot release someone else's booking. Handoff retains the reservation. Test simultaneous claims by two incidents against real Elasticsearch and verify a single winner. [Elastic Index API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-index)

### Badge and Radar boundary

Ali publishes an internal service on port 8090 that stays up during a Station A outage. Luke's allowlisted IT tool calls it using a service credential. Ali validates the credential and station against the target namespace. Luke permits read-only diagnosis during triage, then checks the approved plan and active human acceptance before invoking reroute. Record the requested job IDs in a durable action intent so the same request can be retried after a timeout.

| Internal route | Shape |
| --- | --- |
| `POST /internal/radar/diagnose` | Request `{incident_id,station_id}`. Response `{station_id,mode,diagnosis,evidence_refs}` with `mode` = `radar` or `mock`. Real mode uses a scoped Radar MCP tool and records evidence references. Tool access stays read-only. |
| `POST /internal/badges/reroute` | Request `{incident_id,from_station_id,to_station_id,job_ids}` and `Idempotency-Key`. Response `202 {accepted_job_ids}`. Enqueue the same logical IDs idempotently on Station B after the approved failover action is accepted. |
| `GET /internal/badges/jobs/{job_id}` | Response `{job_id,station_id,status,pdf_ref}`. Status is `pending` or `complete`. The stable PDF reference becomes available before the completion signal. |

Ali owns seed, fault, and reset commands. Use a queue backed by a simulator-owned Elasticsearch index in cluster and a labeled fake locally. Use B or a surviving monitor to emit A's outage evidence. Retry completion signals by logical job ID. Reuse the same PDF reference after recovery. Exercise an actual Station A workload stop on Kubernetes. Collect separate artifacts for the staged failure and a real build issue investigated with Radar MCP.

## Local mocks and configuration

Use `fixtures/shared/overflow.signals.jsonl`, `stage_av.signals.jsonl`, and `badge_stall.signals.jsonl` as canonical signal replays. Add HTTP snapshots for each user-facing boundary and badge diagnostic, reroute, and job status examples. A shared fixture test validates these examples against the frozen contract. Each mock stays in its owner's lane.

| Component | Start independently with | Switch to integrated mode |
| --- | --- | --- |
| React | Kunj's in-browser HTTP mock loads canonical incident, status, actions, and timeline fixtures, including 403 and stale 409. The UI follows the same contract and checks. | Point at Luke's API. Run the same approve, ack, and verify smoke flow. |
| API and agents | Luke's in-memory store, seeded roster/inventory, deterministic planner, injected clock, and recorded badge/Radar responses. Replay signals through the public ingress. | Use Elasticsearch, Ali's service URL and Kunj's collector. Run real-store concurrency tests. |
| Badge and Radar | Ali's local simulator emits three seeded job IDs, one failure sequence and completion events. A recording stub accepts API ingress and can return a retryable error. | Use the real API, Elastic-backed queue, K8s workloads, and real Radar access. |
| Edge | Replay the canonical Room B door and seating sample sequence without camera hardware. | Run laptop edge against the ingress with authorized feed credentials. |

Set these names in owner-local `.env.example` files and wire them through Secrets or ConfigMaps for deployment.

| Owner | Settings |
| --- | --- |
| Luke | `APP_MODE=mock\|live`, `API_PORT=8000`, `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX_PREFIX=backstage`, `AUTH_TOKENS_JSON` (demo token-to-identity/scope map), `CORS_ALLOWED_ORIGINS`, `BADGE_SERVICE_URL`, `BADGE_INTERNAL_TOKEN`, `PLANNER_MODE=template\|openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`. |
| Ali | `KUBE_CONTEXT`, `KUBE_NAMESPACE`, `BADGE_PORT=8090`, `BADGE_STATION_ID`, `INCIDENT_API_BASE_URL` (includes `/api/v1`), `BADGE_SIGNAL_TOKEN`, `BADGE_INTERNAL_TOKEN`, `BADGE_STORE=mock\|elastic`, simulator-scoped `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX_PREFIX`, `RADAR_MODE=mock\|radar`. Confirm the provided MCP connection at kickoff and configure its credentials in the platform or coding agent. |
| Kunj | `VITE_API_BASE_URL=/api/v1`, `VITE_MOCK_API=true\|false`, `VITE_BROWSER_OTLP_URL` (restricted browser ingest or same-origin proxy), collector-only `DASH0_OTLP_ENDPOINT` and `DASH0_AUTH_TOKEN`. Use runtime-entered demo and stage tokens with the appropriate scopes. |
| Edge teammate | `INCIDENT_API_BASE_URL`, `CAM_SIGNAL_TOKEN`, `CAM_ZONE_CONFIG` (local zone-to-room/feed mapping). |
| All instrumented services | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`. Kunj publishes the collector service address and transport. Ali wires the namespace network path. |

Use service names `incident-api`, `agent-workers`, `badge-station-a`, `badge-station-b`, `web`, and `otel-collector` in Kubernetes. Use `badge-control` as the internal badge/Radar service DNS name. Prefer same-origin web-to-API routing in the deployed demo. Keep secrets in local ignored files or platform secret storage. Browser-visible configuration contains endpoints and flags. Keep vendor, server, and internal bearer tokens out of frontend bundles, URLs, committed fixtures, and logs. Gate fixture controls behind mock or explicitly labeled rehearsal mode. Rotate the demo credentials before sharing an environment.

## Observability and accessibility

- Kunj owns the collector, browser monitoring and Dash0 views. Each service owner emits its own OpenTelemetry spans. Propagate W3C trace context on HTTP and preserve the incident trace context for deferred work. Link incoming signal traces when multiple signals correlate. Carry incident ID on spans, with span names for ingress, state transition, agent invocation, tool call, dispatch, acknowledgement, and verifier outcome. Emit each committed protocol hop and each transition with the incident ID and event ID. Use OpenTelemetry GenAI conventions for agent, LLM and tool spans. [OpenTelemetry GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/)
- Publish histograms in seconds by incident type and priority. Measure first qualifying evidence to detection, detection to first dispatch, first dispatch to first human acceptance, and detection to verified resolution. For the high-priority SLO, measure from detection and count success when human acknowledgement is within 60 seconds and verified resolution is within five minutes. Track both thresholds and joint success against the 90% target. Count overdue incomplete incidents as misses for the relevant deadline. Keep incident IDs on traces and out of metric labels. Kunj saves one trace link and one real bug investigation via Dash0 MCP or Agent0 when access is available.
- Put keyboard-operable approval and acknowledgement, visible focus, descriptive controls, readable contrast, and text status in the first UI slice. Announce meaningful status changes through a polite live region. Preserve focus on poll refresh and show role errors. Keep the projector and attendee view sanitized, include the counts-only camera privacy note, and surface captions-down as high priority. Step-free incident workflows and richer attendee surfaces follow the core slice.

## Integration checkpoints and demo cuts

| PRD window, Salt Lake City local time | Acceptance checkpoint |
| --- | --- |
| 11:00–12:00 | Luke lands the scaffold and first Gitar-reviewed PR. Owners confirm contracts, secrets, Elastic, cluster namespace, Radar, Dash0/Agent0 access, camera permissions and fourth owner. Ali and Kunj can run their lanes against mocks. |
| 12:00–1:00 | Fixture overflow reaches verified resolution through real API and React. Check tier-0 approval denial, stale version, dedup and close-before-verification rejection. Post real two-feed counts when the edge lane is ready. |
| 1:00–2:30 | Repair and rehearse. Exercise real Elasticsearch reservations and outbox retries. Bring up collector and confirm trace correlation. At 2:30 decide whether to add a Merge Forward accessibility hook. |
| 2:30–4:00 | Exercise AV reservation and stuck-to-reassignment. Run three badge jobs, stop A on Kubernetes, diagnose through Radar, approve reroute, and confirm B creates all three PDFs. Save separate Radar and Dash0 evidence from real build investigations and check SLO views. |
| 4:00–5:00 | Test the real USB mic event on the demo browser, merge captions evidence, rehearse twice, and test the labeled manual fallback. |
| 5:00–5:30 | Record backup, capture trace and Gitar evidence, and submit. |

**Five-minute run** · Start on a green board. Drive a Room B overflow with two count feeds and show human approval and verified recovery. Use the 60-second clearing window to show the trace and approval history. Unplug the mic, show the merged AV incident, stuck-to-reassignment and fresh captions. Then stop Station A, show Radar diagnosis and three completed badges, and open the Dash0 SLO view. Show Gitar review history. If stage time is tight, cut the infrastructure segment first and keep its recorded evidence. Use live feeds where validated and label any fixtures or manual triggers used.

**After the core slice** · Add live caption heartbeat for the full mic demo. Defer hybrid equipment and runbook search until the seeded lookup works, then tackle P1 incident memory, Speaker preflight, Wi-Fi and step-free workflows as time allows. Attendee Assistant and speaker no-show are P2. Keep free-form chat, real CCTV, face recognition, mobile apps and extended auth outside the build.

## Copy-ready coding-agent prompts

### Ali · Radar, Kubernetes, badge simulator

> Read this full handoff and the frozen `contracts/` commit. Start on `ali/<feature>`. Write only to `services/badge-simulator/`, `deploy/platform/`, `deploy/badge/`, and `docs/radar/`. Start with the local two-station simulator and three stable job IDs. Implement fault/reset, surviving health reports, recoverable queue, idempotent reroute, PDF output and completion signals. Publish the badge-control service contract and a local smoke command Luke can run. Deploy Stations A and B and compose the namespace overlay from owner manifests. Wire the scoped Radar MCP diagnostic through the internal adapter and capture one real build investigation separately from the staged outage. Add trace context and spans to your services. Verify A can go offline while B completes the same three IDs and the backend receives the proof. Open focused Gitar-reviewed PRs with logs or screenshots and any access dependencies. Route cross-path changes to the owner.

### Luke · Elasticsearch, incident API, agents, contracts

> Read this full handoff and initialize the repo. Write only to the Luke-owned paths. Open the scaffold PR first with owner checks, schemas, golden fixtures, root integration entry points and Gitar rules. Freeze the shared contract before feature work. Implement FastAPI, tier and domain enforcement, event correlation, explicit transition commands and verified closure. Ship the fixture-driven overflow against the real API first. Seed roster, equipment and runbooks. Add Elasticsearch optimistic concurrency, recoverable event projection, idempotent slot reservations and a concurrent double-booking check. Implement deterministic Incident Commander, Venue, AV and IT tool paths for the demo with optional plan drafting, human approval, timed fallback, and one allowlisted Radar call through Ali's adapter. Give Kunj stable requests and responses, then run the end-to-end smoke against the deployed stack. Open focused Gitar-reviewed PRs with commands and evidence for all state, RBAC and concurrency checks.

### Kunj · React, Dash0, accessibility

> Read this full handoff and the frozen `contracts/` commit. Start on `kunj/<feature>`. Write only to `apps/web/`, `observability/`, `deploy/web/`, `deploy/dash0/`, and `docs/demo/`. Build the organizer board, approval and staff actions, sanitized attendee/projector routes, and the stage mic/caption producer. Start from the shared fixtures behind an HTTP mock. Keep the same request and response shapes in live mode. Build keyboard and focus behavior, text statuses, live announcements and accessible error states into the first slice. Handle stale conflicts and scoped tokens through the API. Own collector and browser telemetry, publish the collector endpoint to the team, and show the correlated traces and timing SLO in Dash0. Save one real Dash0 investigation when access is available. Verify keyboard-only approve and ack, a denied tier-0 request, visible verification, and the USB mic/manual fallback on the demo browser. Coordinate the rehearsals and recording. Open focused Gitar-reviewed PRs with runnable checks and evidence.

### Edge teammate · YOLO and camera feeds, once assigned

> Read this full handoff and frozen `contracts/` commit. Confirm ownership in the scaffold before editing `services/cam-edge/`. Start with timestamped counts that reproduce the overflow fixture, then run YOLO people counts on two configured feeds. Produce seating and door samples that can jointly trigger and clear Room B. Keep camera data on the laptop and send counts only. Exercise reconnect, stable signal IDs on retry, and stale sample handling. Share the laptop run command, zone setup, and one live signal trace. Open a Gitar-reviewed PR in the edge lane.
