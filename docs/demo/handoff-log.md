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

## 2026-11-09 — Scoped Venue, AV and IT activity dots

- **Branch or PR** · `kunj/agent-activity`, stacked on `kunj/personal-inbox` / PR #13.
- **Changes and why** · Derives the latest agent-authored event per domain from incident timelines already fetched under the current token. Added labelled dots and relative-time legends to the inbox and optional presence field in both hero and compact variants; BoardView passes its scoped events. Pulses last four seconds and reduced motion disables them. Actor IDs and payload text never enter the legend.
- **Impact by lane** · No API, token, contract or public-projector changes. Public views do not fetch privileged event timelines. A quiet domain means no activity received in scope, not proof that it is idle.
- **Verified commands and results** · Frontend 94 tests pass; TypeScript/build pass. Tests cover scope filtering, human-event exclusion, newest-event selection and text labels without an extra live region. Browser against the real local API shows Venue assignment activity and no received AV/IT events in the organizer inbox.
- **Open issues and next owner or action** · Floor brief and optional voice are next; merge/retarget in order after PRs #12 and #13.
- **References and latest handoffs reviewed** · Inbox `80313dd`, PR #12 token fix, floor-agent-plan phase 2; earlier lane handoff review remains current.

## 2026-11-09 — Return briefing and optional read-only voice

- **Branch or PR** · `kunj/floor-briefing`; targets main directly because #13 and #15 merged into feature branches after their parent PRs closed. This PR also carries their inbox/activity changes that are absent from main.
- **Changes and why** · Added a deterministic scoped “While you were away” brief on open and after 60 seconds away, with timestamps only in storage. Loading/denied views do not mark history seen. Recovered the stopped agent’s local OpenAI server and its 19 tests. Added opt-in WebRTC hold-to-talk voice using ephemeral secrets and a fixed read-only executor; no mutation methods, model-supplied URLs, plan prose, actor identities or event payloads enter the voice tool boundary. Microphone tracks mute outside a hold, stop on hide/unmount/disconnect and handle late grants. Voice is disabled by default and the template brief remains usable without a key. Added setup/limitations in openai.md and made npm test include Node server tests.
- **Impact by lane** · No shared contract or backend edits. `npm run presence` now serves the combined presence/OpenAI process; existing presence URLs are unchanged. `/openai` must stay off the public gateway. Actual stage captions and report intake remain separate dependencies.
- **Verified commands and results** · Frontend 119 tests pass, including return timing, storage denial, read-only tool rejection, scoped event reads, microphone muting/stopping and batched tool outputs; TypeScript and production build pass. Node server tests 27/27. Browser with a deliberately missing server key returns a clear voice fallback without requesting microphone permission or contacting a vendor. Browser revealed an initial-token remount could incorrectly mark history seen; the active/history gate and regression cover it. Actual audio hardware and a paid Realtime call remain unverified.
- **Open issues and next owner or action** · Merge directly to main; do not target an already-merged feature branch. Installable shell and report UI remain later phases. Camera ownership and stage/report API support need their owners. Anurup’s ownership PR #16 is open; no changes made there.
- **References and latest handoffs reviewed** · `origin/main@e9078ed`, Ali connection `cf3fcbd`, Luke log through demo Elastic provisioning, Ali log through the cluster rehearsal, phone `4d2d5c6`, inbox `80313dd`, activity `eeefc9f`, PR #13 Gitar denied-read finding. Official OpenAI protocol references are linked in openai.md; no vendor credentials were read.

## 2026-11-09 — Reload timeline history after a temporary denial

- **Branch or PR** · `kunj/personal-inbox`, PR #13 review follow-up.
- **Changes and why** · Gitar found that clearing event data after a denied incident read left the successful-version markers behind. Clear those markers together and advance an event epoch, so history reloads at the same incident version and outstanding older reads cannot repopulate the cleared cache.
- **Impact by lane** · Web polling only; no contract or API change.
- **Verified commands and results** · Regression reproduces success → 403 → same-version success and confirms two timeline reads. Frontend 92/92, TypeScript and build pass on Node 22.
- **Open issues and next owner or action** · Dependent activity and briefing branches must merge this fix before review.
- **References and latest handoffs reviewed** · PR #13 Gitar inline review and inbox `80313dd`; previous reviewed lane handoffs remain current.

## 2026-11-09 — Consolidate directly against main

- **Branch or PR** · `kunj/floor-briefing`, based on `origin/main@e9078ed` after merging latest main.
- **Changes and why** · Preserved every handoff from the inbox/activity branches and carried the denied-read fix `c00db14` into the same main-targeted PR. PR #13 merged into phone-join after #12 closed, and #15 merged into personal-inbox after #13 closed; neither was present in main. This PR deliberately includes both chunks plus the floor brief/voice work. No force push or teammate file edits.
- **Impact by lane** · Includes Ali's merged cluster connection and Luke's latest log through normal merge; no shared contract changes. The new API URL still requires securely supplied runtime role tokens and the hosting origin.
- **Verified commands and results** · Main integration frontend 120 tests, Node server 27 tests, TypeScript/build and diff checks pass. Earlier 390px real-API lifecycle and missing-key voice fallback apply. Browser confirms the first successful staff token entry shows its recent recovery summary.
- **Open issues and next owner or action** · Target main for this PR. Camera ownership, real microphone/Realtime test, stage captions, report intake and sponsor access remain explicit dependencies.
- **References and latest handoffs reviewed** · Main `e9078ed`, Ali connection `cf3fcbd`, phone-join `a19eac9`, personal-inbox `66888a3`, activity `eeefc9f`, local cache fix `c00db14`. Contracts remain `8b902d2f715d1c068a1f4a10bfb3c850a37abf7a`.

## 2026-11-09 — Recover camera/gateway test evidence and current next steps

- **Branch or PR** · `kunj/floor-briefing`, PR #17, directly targeting main.
- **Changes and why** · Added continuation-status.md to supersede the stale implementation inventory and identify what the stopped agents actually left on disk. Camera tests passed 73/73 and gateway tests 10/10; neither code chunk is represented as shipped or live-verified. Recorded the missing launcher, remaining stage/report work and Anurup's Dash0 ownership prerequisite.
- **Impact by lane** · Camera source remains untouched in the unassigned edge lane. Dash0/evidence is being handled by Anurup; the prerequisite is #16. Ali's published cluster success is attributed to his log, not this session's direct observation.
- **Verified commands and results** · Camera pytest in its existing .venv, with cache/bytecode output disabled: 73 passed. Gateway node:test: 10 passed. Existing #17 validation remains 120 frontend, 27 Node server, TypeScript/build, and real local API browser lifecycle.
- **Open issues and next owner or action** · Explicit in continuation-status.md. No real microphone, paid model, cloud telemetry or live crowd claim.
- **References and latest handoffs reviewed** · PR #17, PR #16 at 98aa8dd, main e9078ed and Ali cf3fcbd; all four stopped-agent inventories checked.

## 2026-11-09 — Verify voice authority server-side and serialize tool continuation

- **Branch or PR** · `kunj/voice-scope-fix`, follow-up directly to main. PR #17 was merged at its previous head while this review fix was in progress; this commit is a separate PR.
- **Changes and why** · Addressed both Gitar findings on #17. The token route now verifies the caller's bearer token through the incident API: scoped incident access enables read tools, authorized status-only access enables just get_status, and invalid/unverifiable scope fails closed. Client tier/role fields cannot alter that result. The returned allowed_tools also gates the browser executor. Hold-to-talk pauses while reads finish and cannot create a second response over the tool continuation.
- **Impact by lane** · No shared contract or incident API edits. Node server INCIDENT_API_BASE_URL must match the browser API; default remains loopback :8000/api/v1. Voice is still off by default. Existing API endpoints remain authoritative on every read.
- **Verified commands and results** · Frontend 122 tests, Node server 30 tests, TypeScript/build pass. New regressions cover a forged organizer role on an attendee token, absent/invalid tokens, failed scope checks, a server-granted status-only tool list despite organizer UI state, and holding during a delayed tool read.
- **Open issues and next owner or action** · Real microphone and vendor traffic remain unverified. No additional public exposure, source ownership change or credentials.
- **References and latest handoffs reviewed** · PR #17 at 0e05203, Gitar findings at openai.mjs:120 and briefing.ts:107, `.gitar/review/backstage.md:3`. Prior lane update review is recorded above.

## 2026-11-09 — Integrate merged briefing and contributor ownership

- **Branch or PR** · `kunj/voice-scope-fix`, directly against `origin/main@f3c5e4d`.
- **Changes and why** · Merged the latest main after #17 and Anurup's #16 ownership prerequisite landed. Includes the voice review corrections only relative to main. Refreshed continuation-status.md to show merged implementation, current follow-up and 122 frontend/30 Node server test evidence.
- **Impact by lane** · Preserves Anurup's contributor grants and handoff; no changes to its integration paths beyond this lane's existing voice/UI entry point. Edge remains unassigned.
- **Verified commands and results** · TypeScript/build pass; full frontend 122 tests, focused voice 21 tests and Node server 30 tests pass. Diff checks pass. Memory CLI failed silently; project context and daily log were saved and verified directly in the specified Obsidian vault.
- **Open issues and next owner or action** · Review this follow-up; real microphone and Realtime traffic remain unverified and voice defaults off.
- **References and latest handoffs reviewed** · Main f3c5e4d, merged #17 3e1e63a, #16 2f560be and docs/handoffs/anurup-log.md; CONTRIBUTING/owners diffs reviewed.

## 2026-11-09 — Kubernetes web runtime and server-only OpenAI Secret

- **Branch or PR** · `kunj/voice-kubernetes`, based on `main@5465ebc` after #18 merged.
- **Changes and why** · Added the dependency-free, non-root Node runtime Docker target and a loopback sidecar in Deployment web. Only that container receives optional `web-openai.OPENAI_API_KEY` through secretKeyRef; missing credentials preserve board/check-in availability. The production web image enables voice. nginx forwards only the bearer-verified briefing mint plus presence reads/join, and blocks other OpenAI paths and presence reset.
- **Impact by lane** · Ali must publish/retag both images (`backstage-web` and `backstage-web-runtime`), provision the OpenAI Secret securely, and add web after Dash0/collector prerequisites in his aggregate overlay. No platform-owned files changed. Keep one replica while presence/rate limits are in memory. Public microphone use needs HTTPS. Existing incident Secret identities must be preserved.
- **Verified commands and results** · Both Docker targets built; TypeScript and Vite production build passed. `node --test apps/web/server/*.test.mjs`: 30/30. Containerized kustomize and strict kubeconform: 2 valid resources, zero errors. Local shared-network container smoke: page/health/presence/join 200, invalid briefing bearer 401, transcription/triage/OpenAI health/reset 404; nginx config valid. Stub incident API and fake key only, no vendor mint.
- **Open issues and next owner or action** · No cluster apply, registry push, Secret creation or microphone call performed. Ali's platform overlay currently includes badge and incident only; web/Dash0 integration remains the deployment dependency.
- **References and latest handoffs reviewed** · main 5465ebc, Ali connect-incident-api cf3fcbd (successful cluster rehearsal), Ali badge-k8s 408d198, Luke connect-badge-cluster 478a3f4, Kunj voice-scope-fix 350b414, and Anurup ownership entries from merged #16. No shared contracts changed.

## 2026-11-09 — Apply approved Unslop venue operations direction

- **Branch or PR** · `kunj/unslop-ui`, based on main 99e10ac after #19 merged.
- **Changes and why** · Applied the user-approved light workspace/dark projector direction using Unslop by Damir Sokolovsky (CC BY 4.0, attribution in ui-design.md). Normalized spacing and interface weights, quieted nav/role controls, removed gradients and decorative face/bounce/drift/pulse effects, removed the board ticker and made the projector summary static. Search stays in page flow with visible phone submission; incident attention has a semantic left marker. Anonymous check-in becomes a light sheet with a confirmation check. Inbox, projector, role controls, QR and actions retain their existing data and permission boundaries.
- **Impact by lane** · Web presentation only; no shared schema, backend, credentials or deployment changes. Existing presence animation/reduced-motion behavior remains. No paid image generation.
- **Verified commands and results** · TypeScript, production Vite build, 122 frontend tests and 30 server tests pass. Browser checks: 1440px desktop and 390px phone, dark projector, no horizontal overflow in phone inbox/check-in, keyboard approval to Dispatched and staff acceptance to Accepted in the labelled mock, anonymous check-in success. Screenshots saved in the chat outputs; design decisions and attribution in docs/demo/ui-design.md.
- **Open issues and next owner or action** · Real deployment, microphone and venue projector lighting remain separate verification. This patch makes no new live integration claim.
- **References and latest handoffs reviewed** · main 99e10ac, Kunj 9cc5883, Ali cf3fcbd / 408d198, Luke 478a3f4 and Anurup #16; latest main was fetched again before publication. User asked for periodic pulls; local changes were preserved.

## 2026-11-09 — History tab from saved API incidents

- **Branch** · Published on main at Luke's explicit request; integrated upstream main 7fe7c40 before pushing.
- **Changes** · Added #/history navigation, newest-first saved incident list, search and status filters, and expandable read-only event history with failed-read retry. Uses existing authenticated incident/events endpoints, with no schema or database changes. The earlier header redesign remains reverted.
- **Verified** · Production build and 34 focused UI tests pass. Browser against the real local API/Elasticsearch displayed the resolved Room B incident and all eight events, with zero unresolved matches and one resolved match. Narrow-screen layout inspected. Tests cover filters, event loading/retry, and removing prior data on permission denial.
- **Impact** · History is scoped to the API connected to the web app. This local run uses backstage-local-overflow-state, not the separate cluster rehearsal index. No credentials are added to the frontend or Git. Refresh history fetches current data; automatic polling is not enabled for this view.
- **Reviewed** · main 7fe7c40 (including Anurup's narrow responsive ownership grant), Kunj's latest visual/voice handoffs, and the existing incident/events API contracts. Existing endpoints return all authorized records with next_cursor=null; pagination would need a client extension if the backend later introduces cursors.

## 2026-11-09 — Thirty-second site video and real YOLO preview

- **Branch or PR** · `kunj/video-demo`, based on main babe5d2; merging incoming incident-evidence delivery d94aa9c before publication.
- **Changes and why** · User explicitly requested the Silicon Valley edit extended to 30 seconds on the site with YOLO/live-video features. Added #/demo with the credited, prerecorded 720p30 clip, 120 real YOLO samples synchronized to playback, zone counts/divider and local-file/webcam controls. A standalone web-lane loopback Python preview uses real local YOLO weights for fresh JPEG inference. Stop/switch/unmount and late permission cancellation are handled; frames are memory-only. The hub links board, History, inbox/voice, projector QR and existing stage audio/caption monitor.
- **Impact by lane** · Public media/annotations are copied into the web Docker build. Same-origin camera permission is enabled; access still needs a user click. Production /camera returns503 until an authenticated inference service is separately deployed. No edge-owned files, incident writes, model weights, private keys or shared contracts changed. Counts are a visual preview, not calibrated overflow/recovery evidence. Ali’s deploy-web 7aaa1f6 pins babe5d2 and must be repinned after this PR if the site demo should appear in cluster.
- **Verified commands and results** · Pre-integration: TypeScript, Vite and Docker web build pass; 132 frontend,30 Node,4 Python preview tests pass. Real YOLO generated120 samples with1–12 detections; direct HTTP and browser local-file/bundled-live modes return fresh boxes and latency. 390px phone page has no overflow. Docker serves video Range206,120-sample JSON, source provenance200, private camera503, and nginx config passes. Physical webcam and cloud live inference remain unverified.
- **Open issues and next owner or action** · Final merged-main checks follow in an integration entry. Ali owns source-pin update/cluster rollout; OpenAI/Dash0 Secrets and public HTTPS are separate dependencies. Source and reproducible detector setup: apps/web/camera/README.md and public/demo/source.json.
- **References and latest handoffs reviewed** · Luke and Kunj main babe5d2; Anurup d94aa9c/PR22 inspector/privacy delivery and deployment diffs; Ali deploy-web7aaa1f6 (cluster web1/1, collector0, voice key absent, no external ingress). Periodic fetch preserved local changes.

## 2026-11-09 — Integrate video demo with merged evidence/telemetry

- **Branch or PR** · `kunj/video-demo`; integrates origin/main d94aa9c (Anurup PR22) into video commit ce4df1c.
- **Changes and why** · Resolved App, Vite, nginx and deployment README conflicts by retaining the inspector, opaque credential-generation keys, /otel proxy and privacy/rate limits alongside the video route, private camera proxy and public demo assets. Installed the merged lockfile into an isolated local node_modules directory instead of modifying the original checkout's linked dependencies.
- **Verified commands and results** · Final merged TypeScript and Docker production build pass;146 frontend tests,30 Node server tests and4 Python preview tests pass. Merged Docker smoke: video Range206,120 sample annotations and provenance available, nginx valid, private OpenAI/reset404 and undeployed camera503. Site browser fresh-load and live inference work after restarting the private preview;30-second clip metadata verified exactly720p30/30.000 seconds. No paid calls or cluster mutations.
- **Impact and remaining dependencies** · Preview stays at 127.0.0.1:5207/#/demo with the loopback detector on8766. Node voice/presence service is local8787 with OpenAI key missing, so voice is visible but unavailable until a server key is supplied. Physical webcam was not exercised. Ali deploy-web7aaa1f6 still needs the final merged source pin; a hosted live detector remains separate from the static recorded mode.
- **References reviewed** · main d94aa9c, contract revision aec8576ba4aae08a9344b5d867d2db79d9f06863, Anurup final delivery log and Ali deploy-web7aaa1f6. No source changes in foreign lanes beyond the upstream merge.

## 2026-11-09 — Blob presence and pixel-font UI pass

- **Branch or PR** · `kunj/blobs-fun-ui` off origin/main 395ed2b.
- **Changes and why** · Presence people are drawn as wobbling jelly blobs with blinking eyes instead of circles (apps/web/src/ui/PresenceField.tsx); caption and join copy say blob. Departure Mono (OFL, apps/web/public/fonts) is used for tier, state and card-meta labels, and incident cards lift on hover with a reduced-motion guard.
- **Verified commands and results** · 133 frontend tests pass; typecheck clean apart from missing @dash0/sdk-web in a borrowed node_modules, which also fails 4 test files and the Vite build on untouched origin/main. Not verified in a browser. Live OpenAI calls not run: no key in this shell, and the server tests mock fetch.
- **Open issues and next owner or action** · Eyeball the blobs at projector size; board filter tabs and a resolve celebration were not built.


## 2026-11-09 — Hosted vision and existing-cluster rollout

- **Branch or PR** · `kunj/hosted-vision`, integrating main5e90f3b including PR24 blobs without reverting upstream UI work.
- **Changes and why** · User asked to run the whole demo on the existing Kubernetes cluster. Added a web-owned stock-image cluster overlay with private loopback YOLO, CPU dependency lock and verified model SHA; optional nginx include verifies role bearers against incident status before inference. Browser sends the selected role bearer, resets video state on credential changes, discloses remote sampled-frame processing and retries429 without turning detection off. Static image retains recorded mode and503 camera routes.
- **Verified** ·147 frontend tests and TypeScript/build passed before the upstream blob integration. Linux Docker actual YOLO frame returned10 detections;4 Python boundary tests passed. nginx auth_request smoke denied missing/invalid401 and producer403, allowed a test human200 with10 real boxes, and kept internal auth404, private OpenAI/reset404. Overlay strict kubeconform:2 valid resources. Final integrated checks and deployment evidence follow.
- **Cluster actions** · Through authenticated Radar UI, repinned existing Deployment/web from babe5d2 to merged395ed2b; observed web1/1 healthy. Created web-openai Secret from the user-supplied key using the Secret editor; no value in Git or logs. Existing Elastic/role Secrets and badge workloads preserved. No hosted vision or public route claim yet.
- **Dependencies** · Existing HTTPRoute/app points backstage.cnh.radarhq.io to the placeholder Service/app through Gateway gateway/cnh HTTPS. It can route to web after explicit public-exposure confirmation; Argo tracking may reconcile. Collector is still0 pending Dash0 credentials. Badge diagnosis remainsmock. No physical camera, microphone or real paid call established yet.
- **Reviewed** · main395ed2b then5e90f3b/PR24; Ali deploy-web7aaa1f6 then07f1169 (LoadBalancer quota rejection/reversion), Luke478a3f4, Anurupf536b757/PR22 and current main handoffs. New files stay in Kunj’s owned paths; no shared contract or edge changes.

- Final integrated checks:147 UI,30 Node,4 Linux Python tests pass; TypeScript and production Docker build pass. The in-cluster source pin is3de777b3792e96e80050c55bd10cf1a5de25db69; the smoke Job uses the existing incident Secret in-cluster and suppresses all credential/response values. Its exact tool-name assertion was corrected before publication.


## 2026-11-09 — Isolate hosted detector rate budgets

- **Branch or PR** · `kunj/hosted-vision`, PR25 Gitar follow-up.
- **Change** · Gitar identified that all gateway clients share a remote IP and the detector used the telemetry bucket. Added a separate vision_detect zone keyed by Authorization at4r/s with burst4, preserving the independent telemetry limit. Unauthenticated callers still fail the auth_request gate; bearer values never enter access logs. No untrusted X-Forwarded-For trust was added.
- **Verified** · nginx configuration/auth tests run against real Linux YOLO, and CI scaffold/changed-paths were green on the previous head. Final pin/rollout evidence follows. Public HTTPS backend change was explicitly approved by the user; original route and Deployment saved for rollback. No credential fields were altered by this patch.

- Release pin: c43885a9a3d72fecc67fc0a80413bae1226cc532. Actual nginx smoke returned200 with10 real person boxes immediately after25 telemetry POSTs, verifying separate budgets. Source remains published before cluster download.


## 2026-11-09 — Fit the event CPU quota

- **Branch or PR** · `kunj/hosted-vision`, deployment-only follow-up after PR25 merged at e6bbc8e.
- **Finding** · The vcluster accepted the web Deployment, but host Pod sync rejected3 CPUs with7.4 already used against a10-core team quota. Admission supplies500m limits to each web container when omitted; both init and regular limits count toward the effective Pod budget.
- **Change** · Cap vision at1 CPU, each Node/nginx container at250m and install-vision at1 CPU, giving an effective1.5-core Pod ceiling. The private smoke Job uses250m. Disable unused ServiceAccount token mounting. Runtime source staysc43885a9a3d72fecc67fc0a80413bae1226cc532; this change affects resource allocation only.
- **State** · No user workloads scaled down and no Secret replaced. HTTPRoute cutover is approved but held until the deployment is healthy. API is upgrading8e61ac9 tof536b757, with single writer and projection off. Hosted smoke follows Pod readiness; no success claim before that.


## 2026-11-09 — Verify hosted release and finish telemetry configuration

- **Branch or PR** · `kunj/hosted-vision`, PR26 follow-up, building on merged PR25/e6bbc8e.
- **Scope correction** · Supersedes the "resource allocation only" sentence in the preceding quota entry: that push changes resource limits **and disables unused ServiceAccount token mounting**. No credential or role access is granted.
- **Verified commands and results** · `docker run --rm -v "$PWD:/repo" registry.k8s.io/kustomize/kustomize:v5.6.0 build --load-restrictor LoadRestrictionsNone /repo/deploy/web/cluster > ../hosted-release.yaml`, then `docker run --rm -i ghcr.io/yannh/kubeconform:v0.7.0 -strict -summary < ../hosted-release.yaml`:2 valid resources. Actual Linux Docker one-core inference:53–61ms across5 frames. Cluster Pod web-bdcdb979-zltgq:all3 containers Ready, both init containers Completed. The private web-vision-smoke Job passed at22:22UTC:root/stage200, incidents401 without bearer/200 with organizer, video Range206,120 recorded samples, detector401/403/200, real model returned1 person on the first clip frame (2586ms cold), private routes404. Real OpenAI briefing mint200 with exactly3 permitted read tools; ephemeral value discarded, never printed.
- **Cluster and access** · API upgraded from8e61ac9 to publishedf536b757; observed1/1 ready with existing Elastic/role Secrets and one writer. Created web-openai securely. Existing public HTTPS already works because Service/app selects app.kubernetes.io/name=web; the reviewed HTTPRoute force takeover was cancelled and not applied. The user approved public cutover, and no LoadBalancer/NodePort was created. Browser playback at the HTTPS hostname works.
- **Changes and why** · User supplied Dash0’s us-west-2 gRPC endpoint; populated collector-only dash0-credentials from the saved project token, without copying whole env files. Enable /otel browser monitoring and published source/version metadata in the stock build; set collector CORS to the HTTPS host and cap its CPU at250m. API telemetry and provider ingest verification follow this configuration rollout.
- **Open issues and next action** · Apply collector and rebuilt web, enable API export, verify actual Dash0 ingestion, and capture final browser proof. Evidence projection remains off until its separate alias/privileges are provisioned. Physical webcam, microphone audio and live caption transcription are not established by the token-mint proof. Badge Radar diagnosis remains mock.
- **References reviewed** · maine6bbc8e; PR25 Gitar rate-limit fix7680d56; Ali deploy-web07f1169; current API/collector operations and Anurupf536b757 handoffs. Contract remainsaec8576ba4aae08a9344b5d867d2db79d9f06863. No foreign-lane source edits or badge resets.
