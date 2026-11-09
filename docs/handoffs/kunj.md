# Kunj · Web, accessibility, and Dash0

Read the [team updates](README.md) before work and append a note in your lane's log with every push.

Read the [full team handoff](../../BACKSTAGE-team-agent-handoff.md), then branch from `main` with `git switch -c kunj/overflow-board`. Own `apps/web/`, `observability/`, `deploy/web/`, `deploy/dash0/`, and `docs/demo/`.

1. Run `make smoke SCENARIO=overflow` and `make dev SCENARIO=overflow` from the repo root. Browse the [HTTP contract](../../contracts/openapi.yaml) and [examples](../../fixtures/shared/http.examples.json). Keep a stateful browser mock in your lane for approve, ack, and polling. See [Luke’s Room B API update](luke-log.md#2026-11-09--room-b-overflow-api-available-for-web-integration) for the branch and commands to try the real flow.
2. Ship the organizer board, staff actions, and sanitized projector/status views. Send a fresh `Idempotency-Key` for each new intent and retry the same intent with the same key and body. Refresh on a stale 409, surface 403, and keep the board in verification until the API reports resolution.
3. Verify keyboard-only approval and acknowledgement, visible focus through refresh, a polite live region, and text for priority and state. Add the stage mic/caption metadata producers after the overflow flow. Use a stage-scoped token and omit caption text from signals.
4. Publish the collector endpoint, propagate trace context, and show the incident trace and timing views in Dash0 once access is available. Keep ingest credentials server-side.

First PR acceptance is a keyboard-operable overflow flow using the shared fixtures. Include the contract revision, exact run commands, and any Dash0 or API dependencies. Coordinate shared schema changes with Luke.
