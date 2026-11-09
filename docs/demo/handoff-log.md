# Kunj’s team updates

## 2026-11-09 — Agent board documented

- **Branch or PR** · kunj/agent-board-docs, based on main at b604095.
- **Changes and why** · Added [the agent board guide](agent-board.md) so agents find the `agent-board` branch from `main`. The board keeps its own history because each message is a commit. No code changed.
- **Impact by lane** · Luke and Ali agents can join with the command in the guide. Luke's agent has already read the board (agent-board at ee392fa, per the badge integration entry). Open request to Luke: link the guide from `AGENTS.md`, which is his file.
- **Verified commands and results** · Board tests pass (`python3 -m unittest discover -s tests` on the agent-board branch, 5 tests). Posted messages on the real remote and confirmed delivery to Luke's agent.
- **Open issues and next owner or action** · Luke must set `github_login` for the kunj and edge lanes in `.github/owners.json`, or the `changed-paths` check fails this PR. The web board, stage page, telemetry, collector and deploy manifests exist locally on kunj/overflow-board and will land as focused PRs after that.
- **References and latest handoffs reviewed** · main at b604095, luke/badge-integration (merged as PR #5), ali/badge-simulator at e137f36, agent-board.

## 2026-11-09 — Web app: organizer board, mock and live modes, presence, stage page

- **Branch or PR** · kunj/web-board, based on main at 8e61ac9. Draft PR while the UI redesign lands.
- **Changes and why** · Added `apps/web`: React board with approve and acknowledge, an API client that keeps one `Idempotency-Key` per intent and retries a lost response with the same key and body, a stateful in-browser mock seeded from `fixtures/shared/`, hooks for polling and live announcements, attendee status and projector routes, a presence relay (`apps/web/server/presence.mjs`) and hook for QR joins, a browser stage page for mic and caption signals (counts and line numbers only), and browser telemetry that stays off unless `VITE_BROWSER_OTLP_URL` is set. Mock mode is the default. Live mode (`VITE_MOCK_API=false`) proxies `/api/v1` to `127.0.0.1:8000`.
- **Impact by lane** · No contract change. Luke: the presence relay is interim until the API publishes per-tier counts (request is on the agent board). The stage page needs a stage-scoped token for `POST /api/v1/signals`, which `.env.example` does not define yet. Ali: nothing to wire from this PR; the web and collector manifests are still local.
- **Verified commands and results** · From `apps/web`: `npx tsc --noEmit` clean, `npm run build` passes, `node --test server/presence.test.mjs` 8 pass. `npx vitest run`: 68 of 71 pass. Three UI tests fail because the redesign in progress changed copy they assert (priority text, role switcher, privacy line); they will be updated in the next push. Ran Luke's API from main end to end by hand: organizer approve, staff acknowledge, 60 second clearing replay to resolved, plus 403, stale 409 and idempotent replay. The web client against that API in a browser is not verified yet.
- **Open issues and next owner or action** · Kunj: fix the three tests, run the board against the live API, then land observability, deploy and demo docs as separate PRs. Luke: stage token and presence counts. Edge lane still has no owner in `.github/owners.json`.
- **References and latest handoffs reviewed** · main at 8e61ac9, luke/badge-integration (PR #5), ali/badge-k8s (PR #4), agent-board.

## 2026-11-09 — Collector, Dash0 rules, web image and demo runbook

- **Branch or PR** · kunj/observability-deploy, stacked on kunj/web-board (PR #8). Merge #8 first.
- **Changes and why** · `observability/`: OpenTelemetry collector config (OTLP gRPC 4317 and HTTP 4318, one allowed browser origin, scrubbed auth headers, Dash0 exporter, debug variant) and a docker-compose file. `deploy/dash0/`: kustomize base for a Service named `otel-collector`, a placeholder Secret example, incident timing SLO rules, a dashboard, and `metrics.md` with the metric contract. `deploy/web/`: Dockerfile and nginx config that serve the app and route `/api/v1` to `incident-api:8000` and browser spans to the collector so no vendor token reaches the browser, plus manifests for a Service named `web`. `docs/demo/`: runbook, rehearsal checklist, recording plan, dependency table and the sponsor depth matrix, specialised for KubeCon NA 2026.
- **Impact by lane** · Ali: the namespace name, the `dash0-credentials` Secret and a TLS or port-forward path are still needed (browsers only allow mic access over HTTPS or localhost). The web pod crash-loops until the `incident-api` and `otel-collector` Services exist. Luke: the SLO outcome counter and deadline timers in `deploy/dash0/metrics.md` need emitting; W3C trace context on signals. No contract change.
- **Verified commands and results** · Collector 0.164.0 `validate` passed on both configs and a local run answered health, OTLP POST and CORS correctly. `docker build` of the web image passed and nginx routing worked against a stub API. kustomize build plus kubeconform: 2 of 2 valid for web, 4 of 4 for dash0, PrometheusRule valid against the CRD catalog. All YAML parses.
- **Open issues and next owner or action** · Not applied to a cluster or a Dash0 org. The Dash0 endpoint and MCP are not connected, so the histogram query shape and the Perses dashboard format are unconfirmed. No `.env` or token is in this push; the local collector `.env` stays ignored.
- **References and latest handoffs reviewed** · main at 8e61ac9, kunj/web-board at 7871ec1, agent-board.
