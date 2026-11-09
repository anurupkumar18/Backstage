# Luke’s team updates

## 2026-11-09 — Backstage scaffold published

- **Branch and commit** · [main at 8b902d2](https://github.com/lukeeskinner/Backstage/commit/8b902d2f715d1c068a1f4a10bfb3c850a37abf7a)
- **Changes** · Published the v1 API and schemas, scenario fixtures, a local read-only fixture server, CI, and the original team handoff. Use [Kunj’s guide](kunj.md) or [Ali’s guide](ali.md) for lane-specific kickoff steps.
- **Verified** · Contract validation and fixture smoke tests for overflow, stage AV, and badge stall passed locally.
- **Open** · Luke must confirm Kunj’s and Ali’s GitHub handles and write access to enable their ownership rules. The edge lane awaits an owner.

## 2026-11-09 — Room B overflow API available for web integration

- **Branch and commit** · [luke/overflow-api at 553a2ef](https://github.com/lukeeskinner/Backstage/commit/553a2efd380c48ceb279c4ce656b5a51241a8328)
- **Changes** · Added the FastAPI flow from count ingress through Venue proposal, organizer approval, staff acceptance, and verified closure. The public room stays in recovery until 60 seconds of below-threshold counts have arrived. The published v1 contract remains the integration interface.
- **Kunj** · Follow the [API startup and replay guide](https://github.com/lukeeskinner/Backstage/blob/553a2efd380c48ceb279c4ce656b5a51241a8328/services/incident-api/README.md). Use the demo identities and poll incident reads after actions. The action response describes the human step. The read includes any follow-on dispatch.
- **Ali** · Use the scaffold’s badge replay and internal badge examples for simulator development. Badge ingestion and failover integration are still open.
- **Verified** · `make check` and `make check-api` passed locally. A running Uvicorn instance accepted demo tokens, the browser origin, and a sample signal.
- **Open** · Incident data lives in memory and resets on restart. Luke owns the Elasticsearch follow-up. Kunj owns board integration.

## 2026-11-09 — Radar Cloud MCP config published

- **Branch and commit** · [main at fb822f1](https://github.com/lukeeskinner/Backstage/commit/fb822f1db5a733a2de594c15b65e562a8e974205)
- **Changes** · Added repository-level Radar Cloud MCP configuration.
- **Ali** · Check Radar access from your coding environment before wiring the scoped diagnostic. The local badge simulator can continue in mock mode while access is being confirmed.
- **Verified** · Confirmed the config file in the published commit. Connection validation remains open.

## 2026-11-09 — Per-push team handoffs

- **Branches** · `main` and `luke/overflow-api`
- **Changes** · Added [coding-agent instructions](../../AGENTS.md) and the [team update process](README.md). Backfilled the scaffold and Room B API entries so someone picking up either branch can recover the decisions and commands.
- **Impact** · Each lane reads the latest pushed updates before work and appends a handoff with each push. The API branch also receives the instructions. Older checkouts can fetch and read them from `origin/main` immediately.
- **Verified** · Checked documentation links and confirmed the scaffold and API commit references.

## 2026-11-09 — Elasticsearch storage for the Room B demo

- **Branch** · luke/elastic-overflow, based on main at fa1fbe9.
- **Changes** · Live mode saves Room B incidents, event history, assignment deadlines, count evidence, and retry receipts together in Elasticsearch. The demo uses one versioned checkpoint and one writer per alias. Elasticsearch checks the last write version before accepting an update.
- **Kunj** · Follow the [API setup and live mode guide](../../services/incident-api/README.md). If storage returns a 503 on an action, retry with the original body and idempotency key. The board still uses the v1 request and response shapes.
- **Ali** · The checkpoint covers the Room B demo. Badge integration can continue against the existing shared contract and simulator.
- **Verified** · make check and make check-api passed. The API tests exercised fresh app instances, an already-committed write with a lost response, an uncommitted write, and a version conflict through the Elasticsearch SDK with a simulated transport.
- **Open** · Luke owns the real Cloud smoke test in an isolated index. The [index setup](../../data/elasticsearch/README.md) documents its alias. Searchable incident and timeline indices are follow-up work.
- **Reviewed** · main at fa1fbe9, luke/overflow-api at 5dfc7a6, and ali/badge-simulator at 06e8f7b.

## 2026-11-09 — Room B restart verified on Elastic Cloud

- **Branch** · main after PR #3.
- **Changes** · Created the isolated backstage-smoke-overflow-state-v1 index and its backstage-smoke-overflow-state write alias. The smoke index contains one resolved synthetic Room B incident and its evidence and retry receipts.
- **Verified** · The opt-in test_live_elasticsearch_restart passed against Elastic Cloud Serverless. Fresh FastAPI instances recovered the pre-incident counts, the approval and assignment, the original retry receipts, and progress toward the full minute of recovery. Repeating a headcount kept the incident count at one.
- **Impact** · Kunj can use the live-mode instructions for a board rehearsal. The shared demo needs its own index and alias to keep rehearsal data separate from the smoke evidence.
- **References and handoffs reviewed** · [Live mode and smoke instructions](../../services/incident-api/README.md), main at 85c786a, luke/elastic-overflow at de2884e, and ali/badge-simulator at 6595659.

## 2026-11-09 — Badge simulator connected to the incident API

- **Branch** · luke/badge-integration, based on main at 2555f30.
- **Changes** · A fresh Station B report of Station A offline with aged pending work opens a Room C incident. The IT worker calls badge-control for diagnosis. Organizer approval and the assigned IT staff member's acceptance gate the reroute. The pending operation survives an API restart and retries with the same key. Closure requires a Station B completion signal and a matching badge-control job and PDF reference for every captured job.
- **Kunj** · The existing v1 board can show the badge incident and organizer approval. Use demo-it-staff for the first IT assignment and demo-it-backup for a replacement. See the [badge rehearsal instructions](../../services/incident-api/README.md#rehearse-a-badge-outage) for settings.
- **Ali** · The API accepts the badge simulator's two signal kinds with the scoped badge producer identity. Configure the simulator's incident API URL and signal token, and share the internal badge-control token with the API through service configuration. The [Radar notes](https://github.com/lukeeskinner/Backstage/blob/61f7062/docs/radar/README.md) record Ali's separate Kubernetes drill.
- **Verified** · make check and make check-api passed. The opt-in test_real_simulator_fails_over_after_human_acceptance passed against Ali's simulator at 61f7062 over local HTTP and confirmed all three PDF files existed. Local checkpoint tests covered restart, a retried reroute, and withheld closure until PDF proof matched.
- **Open** · Point the deployed badge simulator and incident API at each other for the combined Kubernetes rehearsal. Ali's service diagnosis uses mock mode pending a Radar service token.
- **Reviewed** · main at 2555f30, ali/badge-simulator at 6595659, ali/badge-k8s at 61f7062, and agent-board at ee392fa.

## 2026-11-09 — Shared GitHub review ownership

- **Branch** · main after PR #5.
- **Changes** · Added Luke, Ali, and Kunj as code owners for the whole repo. Bound Ali and Kunj to their verified GitHub accounts in the changed-path check.
- **Impact** · GitHub can route code-owner reviews to the whole team. Ali's and Kunj's feature PRs can pass the existing check for their assigned paths.
- **Verified** · Confirmed write access for both collaborators through GitHub, checked the CODEOWNERS rule against the collaborator list, and ran the changed-path check against Ali's badge Kubernetes branch.
- **Reviewed** · main at b604095, ali/badge-k8s at 408d198, ali/badge-simulator at e137f36, and agent-board at d3899a9.

## 2026-11-09 — Prepare the combined cluster connection

- **Branch** · luke/connect-badge-cluster, based on main at 8e61ac9.
- **Changes** · Added the single-writer incident API Kubernetes deployment, pinned runtime bootstrap, and connection command. The API uses the existing badge internal Secret. Connection waits for API readiness before installing the scoped producer token and service URL, preserving Radar credentials.
- **Impact** · Ali must persist the badge URL and add the incident directory to the aggregate overlay in his lane. Kunj can use the forwarded API with private role tokens. See deploy/incident/README.md for setup and rehearsal gates. Restarting badge-control clears its in-memory queue, so connect between rehearsals.
- **Open** · This workspace has no cluster access. Ali can deploy through Radar using docs/handoffs/ali-connect-cluster.md. The shared demo Elastic alias and incident Secret must exist before deployment. The combined Kubernetes rehearsal has not run. Radar service-token setup and badge queue persistence remain Ali dependencies.
- **Reviewed** · main at 8e61ac9, ali/badge-k8s at 408d198, ali/badge-simulator at e137f36, kunj/agent-board-docs at efc6c1f, and the prior Luke badge integration at f72fec2.

- **Verified** · make check passed (3 tests). make check-api with BADGE_SMOKE_SOURCE pointing at the merged simulator passed (14 tests, 1 opt-in live Elastic test skipped). The local HTTP test required localhost binding permission and passed on rerun. Pinned archive extraction, runtime contract presence, standalone YAML rendering, Python syntax, and git diff --check passed. Cluster apply and readiness remain unverified.
