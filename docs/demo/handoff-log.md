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

## 2026-11-09 — Codex handoff and floor-agent plan

- **Branch or PR** · kunj/codex-handoff, based on main at 6355f4a. Docs only.
- **Changes and why** · Added `docs/demo/codex-handoff.md` (repo and branch state, unpushed inventory, sub-agent ledger, environment, rules, prioritised next steps) so Kunj's Codex can continue every thread, and `docs/demo/floor-agent-plan.md` (phone inbox, agent dots, floor brief, installable web app, report triage) for a proactive per-role agent experience specialised for the conference floor.
- **Impact by lane** · None. No contract, API or manifest change. Luke and Ali: the open asks are listed in the handoff and on the agent board.
- **Verified commands and results** · Reviewed all merged PRs (#1 to #10) and the lane logs on main; checked local state with tsc (clean) and vitest (68 of 71, three known UI copy failures). No secrets in the diff.
- **Open issues and next owner or action** · Four local agents (UI, cam-edge, OpenAI, launcher) were still writing files; their output is not in Git yet and ships as separate PRs. Edge lane still has no owner in `.github/owners.json`.
- **References and latest handoffs reviewed** · main at 6355f4a, luke-log.md through the cluster entry, agent-board.

## 2026-11-09 — Recover the UI and connect phone check-in

- **Branch or PR** · `kunj/phone-join`, based on `main@cfc4451`.
- **Changes and why** · Recovered the stopped UI agent’s JoinPage, projector QR layout, simulator placement, preview harness and styles from the original checkout. Connected `#/join`, anonymous presence polling and projector QR in App; check-in never changes API identity. Live mode now offers the existing live identity roster and clears route state when the token changes. Mock joins move a single dot instead of double-counting.
- **Impact by lane** · No contract change (`contracts@8b902d2f715d1c068a1f4a10bfb3c850a37abf7a`). Hosting must proxy `/presence` to the relay and serve the same HTTPS origin for phones. No tunnel was opened. Original `~/Backstage` work remains untouched.
- **Verified commands and results** · Node 22: original 71 Vitest tests pass after fixing three obsolete assertions; 3 new keyboard/join tests pass; TypeScript passes; presence server 8/8; production Vite build passes. Browser keyboard check-in reaches the confirmation and projector shows the incremented count and a same-origin QR. Homebrew Node 25 fails before startup with missing `libsimdjson.29.dylib`; use `/usr/local/bin/node` (22.18.0) until repaired.
- **Open issues and next owner or action** · Phone inbox is next. Live API browser rehearsal, OpenAI server/client recovery and launcher remain pending. Edge lane is unassigned; camera files preserved in the original checkout.
- **References and latest handoffs reviewed** · `origin/main@cfc4451`, web `7871ec1`, Luke cluster `478a3f4` and Luke log through deployment startup correction, Ali Kubernetes `408d198` and its log, `agent-board` inbox, Codex handoff and floor-agent plan. No open feature PRs at review time.

## 2026-11-09 — Commit live tokens once after entry

- **Branch or PR** · `kunj/phone-join`, PR #12 follow-up.
- **Changes and why** · Gitar caught the live field remounting the board and fetching with each partial token. The field now keeps a draft and submits once with Enter or “Use token”; changing identity clears the draft. Scope state still resets when the committed token changes.
- **Impact by lane** · No contract change. Live-demo instructions now require submitting the token.
- **Verified commands and results** · Token-entry regression passes, frontend tests 75/75, TypeScript and production build pass on Node 22. Earlier presence tests 8/8 and keyboard join/projector checks remain valid.
- **Open issues and next owner or action** · Personal inbox is in progress on `kunj/personal-inbox` and will pick up this commit.
- **References and latest handoffs reviewed** · PR #12 Gitar inline review; base `main@cfc4451`, original recovery commit `090bb60`, lane handoffs already reviewed in the preceding entry.

## 2026-11-09 — Personal inbox, verified against the real API

- **Branch or PR** · `kunj/personal-inbox`, stacked on `kunj/phone-join` / PR #12; retarget to main once #12 merges.
- **Changes and why** · Added `#/me`, pure deterministic inbox derivation/copy, phone cards with one API-permitted approve/accept action, priority/recency ordering, verification text and “Why you”. Reuses useBoard and useIncidentActions. Attendees bypass incident reads; speakers receive a session-scope explanation. Marks updates read with a timestamp only and tolerates disabled storage. Role/token switches also clear the prior announcement. Added web agent_docs for these patterns.
- **Impact by lane** · Contract unchanged at `8b902d2f715d1c068a1f4a10bfb3c850a37abf7a`. Timeline cancellations are handled, failed reads retry without a version bump, denied incident reads clear prior cards. No new backend or external vendor calls.
- **Verified commands and results** · Node 22: TypeScript and production build pass; 91 Vitest tests pass, including keyboard approve, stale 409 requiring another human action, attendee read isolation, token submit and timeline retry; presence server 8/8 remains valid. `make check check-api` passes: 3 contract tests and 16 API tests (2 opt-in integration tests skipped). Used a fresh isolated Python environment because the original .venv lacked service dependencies. Real FastAPI on loopback: canonical 30-second trigger → organizer keyboard approval → staff keyboard acceptance → canonical 60-second clearing replay → inbox Verified and attendee public Normal. Speaker `demo-session` sees no overflow. Phone layout checked at 390 × 844. Local evidence incident `inc-overflow-52de33af3bd041b295cdbae6b9936303`; synthetic, in-memory storage only.
- **Open issues and next owner or action** · Agent activity, floor brief, voice, installable shell and report intake are later phases. Report intake and live stage support still need Luke. Camera lane ownership is still unassigned.
- **References and latest handoffs reviewed** · `main@cfc4451`; PR #12 recovery `090bb60` and Gitar token-entry fix `4d2d5c6`; Luke cluster `478a3f4`, Ali badge Kubernetes `408d198`, and lane logs referenced in the preceding entries. Local API README and replay script reviewed for the live rehearsal.

## 2026-11-09 — Align the inbox branch with PR #12

- **Branch or PR** · `kunj/personal-inbox`, merging `kunj/phone-join@4d2d5c6` as its base.
- **Changes and why** · Preserved both appended handoffs while resolving the log-only merge conflict; aligned ancestry with the token-entry fix so the stacked PR diff contains the inbox only. Removed an extra fixture-helper EOF blank line.
- **Impact by lane** · No runtime or contract change.
- **Verified commands and results** · `git diff --check` passes; same code as the 91-test, TypeScript/build and live-browser verified inbox entry above.
- **Open issues and next owner or action** · Merge PR #12 before the inbox and retarget the inbox to main.
- **References and latest handoffs reviewed** · PR #12 `4d2d5c6`, inbox `5578951`; no new remote dependencies.

## 2026-11-09 — Reload timeline history after a temporary denial

- **Branch or PR** · `kunj/personal-inbox`, PR #13 review follow-up.
- **Changes and why** · Gitar found that clearing event data after a denied incident read left the successful-version markers behind. Clear those markers together and advance an event epoch, so history reloads at the same incident version and outstanding older reads cannot repopulate the cleared cache.
- **Impact by lane** · Web polling only; no contract or API change.
- **Verified commands and results** · Regression reproduces success → 403 → same-version success and confirms two timeline reads. Frontend 92/92, TypeScript and build pass on Node 22.
- **Open issues and next owner or action** · Dependent activity and briefing branches must merge this fix before review.
- **References and latest handoffs reviewed** · PR #13 Gitar inline review and inbox `80313dd`; previous reviewed lane handoffs remain current.
