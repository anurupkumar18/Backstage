# Backstage incident evidence implementation

Approved by Anurup on 2026-11-09. Base: ab2798ab599bb498f24d04e8288931874a4d3dd2.

## Outcome and constraints

Deliver real Dash0 traces, logs, metrics and browser monitoring; searchable committed Elasticsearch incident evidence; and an accessible interactive inspector explaining what happened and why recovery waits. Preserve single-writer checkpoint, lifecycle gates, scoped authorization, retries and current running demo. Reuse Kunj's UI tokens and mount an isolated diagnostics component; do not redesign his board. Target 2–3 hours after access readiness with final 45 minutes for independent QA, without weakening acceptance.

No full SLO, semantic search, checkpoint provenance migration, runtime Dash0 query service, or public status schema change. Existing unknown signal origin stays unknown. Synthetic QA is labeled. No telemetry provider credentials in browser, logs or Git. Query/fragment scrubbing and log allowlisting required; no session replay. Cloud claims require actual provider observation.

## Work packages

1. Backend: configured OTLP telemetry; incoming context and ES spans; separate attempted/committed events; fail-open bounded export; committed immutable snapshot projection every 5 seconds outside runtime lock; create-only event docs with content-conflict detection; watermark only after all writes searchable; scoped bounded search; authorized diagnostics; unit/integration tests and additive contracts.
2. Frontend: single Dash0 web SDK provider; privacy filtering; isolated accessible incident inspector and evidence search; truthful modes/freshness; event-fetch recovery at same version; credential-generation cache invalidation; tests, typecheck and build.
3. Operations: existing collector and proxy integration (traces and logs); measured API/ES/search dashboard; deployment config; isolated evidence mapping/bootstrap support; integration notes.
4. Integration: maintainers' ownership prerequisite; fresh final-main reconciliation; real isolated ES and Dash0 proof; Playwright lifecycle/denial/recovery/search, responsive and keyboard manual QA; independent reviewer and fixes; review-ready PRs and handoff.

## Shared API interface (v1 additive)

Freeze backend/frontend response shapes in a short message before either consumes them. GET /api/v1/evidence/search accepts q <=200 chars, room_id, event_type, from, to, limit 1..50; server-only DSL and authorization before hits/counts and at drilldown. GET /api/v1/incidents/{id}/diagnostics uses incident read authorization. Include actual committed event/signal references, receipt/observation timestamps, checkpoint persistence mode, projection freshness and trace ID/link, never an unverified ingestion assertion. Search failure is explicit error, never fabricated empty success. Timeline remains authoritative checkpoint-backed.

## Required acceptance

- API tests: failed/ambiguous persistence, stale versions, idempotency, RBAC, restart/replay, projection partial failures and outage; never index speculative transitions.
- Web tests: same-version event retry, credential swap and stale responses, empty/error states, semantic diagram and navigation; full tests/typecheck/build.
- Real ES isolated prefix: persist/project/search/restart without duplicates, correct filters and failures. Real Dash0: matching browser event/request, backend trace, log, metric; Agent0/MCP investigation with actual finding/fix or honest limitation.
- Playwright: approval → acceptance → 60 seconds fresh evidence before resolution; denied role; timeline retry; search/inspector navigation. Manual screenshots at phone/tablet/desktop/projector, keyboard, reduced motion, zoom/focus.
- Independent review of final SHA/diff/evidence. Resolve blocking findings, rerun affected checks. Deliver focused PRs, lane handoff and demo/evidence notes.
