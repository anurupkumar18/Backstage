# Ali lane handoff log

Badge simulator, Radar, and Kubernetes. Newest entries at the bottom. See the [team update process](../handoffs/README.md).

## 2026-11-09 — Badge simulator, badge-control, and Radar adapter (backfill)

- **Branch or PR** · `ali/badge-simulator`, [PR #2](https://github.com/lukeeskinner/Backstage/pull/2), commit [06e8f7b](https://github.com/lukeeskinner/Backstage/commit/06e8f7bfc2302fcb8a94d37eddbdeede57534ba2). Pushed before the per-push log rule reached this branch; recorded here now.
- **Changes and why** · First Ali deliverable from the handoff: a local A-to-B badge failover.
  - `services/badge-simulator/` adds Stations A and B and the `badge-control` service on :8090, which implements the v1 internal contract: diagnose, idempotent reroute, and job status.
  - A surviving station reports a stalled peer as `badge_health`. Each job's PDF (`pdf-<job_id>`) exists before its `badge_job_complete` signal, and signals retry with stable IDs.
  - The Radar adapter defaults to `RADAR_MODE=mock`. `radar` mode calls only allowlisted read-only Radar MCP tools and falls back to labeled mock on failure.
- **Impact by lane** · No contract changes; the contract is at `8b902d2`.
  - **Luke:** the incident API needs to accept `badge_health` and `badge_job_complete` from a token scoped to `station-a`/`station-b` and `room-c`. The badge-control token goes in `BADGE_INTERNAL_TOKEN` on both sides.
- **Verified** · `cd services/badge-simulator && python -m badge_sim smoke` passed 17 checks, every payload validated against `contracts/`. Unit tests passed (14), and so did `make check`.
- **Open** · Elastic store, separate station pods, Kubernetes manifests, and a Radar service token.
- **Reviewed** · main at fb822f1.

## 2026-11-09 — Gitar review fixes on PR #2 (backfill)

- **Branch or PR** · `ali/badge-simulator`, [PR #2](https://github.com/lukeeskinner/Backstage/pull/2), commit [6595659](https://github.com/lukeeskinner/Backstage/commit/6595659).
- **Changes and why** · Fixes the three Gitar findings:
  - **Signal IDs after a reset or restart.** Reset now clears the signal outbox. Health IDs are `<source>-badge_health-<station>-<run_id>-<seq>`, with a new `run_id` on each station start. Completion IDs are `badge_job_complete-<job_id>-<run_id>`: stable across retries and failover, new when a job is seeded again. Before this, a second rehearsal silently dropped its signals.
  - **Radar evidence refs** get a random suffix, so two diagnoses in the same second no longer overwrite each other.
  - **Bad `Content-Length`** (negative, non-numeric or oversized) now returns 422 instead of hanging the handler or returning 500.
- **Impact by lane** · **Luke:** signal ID formats changed as described above. They are opaque in the contract, so nothing breaks.
- **Verified** · 21 tests passed, each fix with a regression test, and the smoke passed.
- **Open** · CI's `changed-paths` job fails with "Branch 'ali/badge-simulator' has no active ownership lane". `.github/owners.json` on `main` still has `"github_login": null` for the Ali lane. **Luke:** set it to `AhmedShAli24`, the GitHub account that opens the Ali PRs.
- **Reviewed** · Gitar review on PR #2 and CI run for 06e8f7b.

## 2026-11-09 — Refresh from main and start this log

- **Branch or PR** · `ali/badge-simulator`, [PR #2](https://github.com/lukeeskinner/Backstage/pull/2). Merged `origin/main` at 2555f30.
- **Changes and why** · Adds this lane log as required by [AGENTS.md](../../AGENTS.md), with backfilled entries for the earlier pushes. Code is unchanged.
- **Impact by lane** · None.
- **Verified** · Badge tests and `make check` passed after the merge.
- **Open** · The owners.json login for the Ali lane, as above.
- **Reviewed** · main at 2555f30 (Luke: per-push handoffs, Elasticsearch storage for Room B, Elastic Cloud restart smoke) and luke/overflow-api at 1911b12. Nothing there changes the badge contract or the paths this lane writes to.
