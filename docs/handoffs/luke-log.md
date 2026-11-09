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

## 2026-11-09 — Per-push team handoffs

- **Branches** · `main` and `luke/overflow-api`
- **Changes** · Added [coding-agent instructions](../../AGENTS.md) and the [team update process](README.md). Backfilled the scaffold and Room B API entries so someone picking up either branch can recover the decisions and commands.
- **Impact** · Each lane reads the latest pushed updates before work and appends a handoff with each push. The API branch also receives the instructions. Older checkouts can fetch and read them from `origin/main` immediately.
- **Verified** · Checked documentation links and confirmed the scaffold and API commit references.
