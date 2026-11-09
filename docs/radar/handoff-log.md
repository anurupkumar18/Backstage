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

## 2026-11-09 — Separate station pods and Kubernetes manifests (backfill)

- **Branch or PR** · `ali/badge-k8s`, [PR #4](https://github.com/lukeeskinner/Backstage/pull/4), commit [bed1fd3](https://github.com/lukeeskinner/Backstage/commit/bed1fd37f38877ff82c7e2df6433ef3a15a19872). Builds on PR #2. PR #4 targets `main`, so it also shows PR #2's commits until #2 merges.
- **Changes and why** · `BADGE_ROLE` splits the simulator so Station A can be stopped as a real workload:
  - `control`: badge-control owns the queue, heartbeats and PDFs, and serves `/internal/stations/...` and `PUT /internal/pdfs/...`.
  - `station`: one station in its own process, heartbeating to `BADGE_CONTROL_URL`.
  - badge-control reports ages instead of timestamps, so pod clocks never need to agree.
  - `deploy/badge/` gets the badge-control Deployment and Service, Deployments `badge-station-a` and `-b`, and `badge-config`. `deploy/platform/` overlays them into `team-backstage`.
- **Impact by lane** ·
  - **Luke, Kunj:** add a `kustomization.yaml` under `deploy/incident`, `deploy/web` and `deploy/dash0`, and tell Ali so `deploy/platform` can include them.
  - In the cluster, badge-control is reachable at `http://badge-control:8090`.
- **Verified** · `python -m badge_sim smoke --split` passed, and so did 33 tests.

## 2026-11-09 — Deployed to the backstage cluster and drilled a real Station A outage (backfill)

- **Branch or PR** · `ali/badge-k8s`, [PR #4](https://github.com/lukeeskinner/Backstage/pull/4), commit [61f7062](https://github.com/lukeeskinner/Backstage/commit/61f7062).
- **Changes and why** · Deployed with Radar MCP alone: dry run, apply, `wait_for`.
  - The 30 KB code ConfigMap was too big to deploy reliably, so pods now fetch the code in an init container from GitHub at a pinned commit (`badge-fetch-code`: `CODE_SHA`) and keep only `badge_sim/` and `radar/`.
  - `deploy/badge/drill-job.yaml` is the staged-outage drill.
- **Live state in `team-backstage`** · `badge-control`, `badge-station-a` and `badge-station-b` are running 1/1. Code is at commit `bed1fd3`.
  - Objects created: `Secret/badge-secrets`, `ConfigMap/badge-config`, `ConfigMap/badge-fetch-code`, `Service/badge-control`. Finished Jobs `badge-drill` and `badge-drill-2` delete themselves an hour after finishing.
  - The internal token is held outside Git, on Ali's laptop.
- **Evidence** · Logged in [docs/radar/README.md](README.md#evidence):
  - **Staged outage:** `badge-station-a` scaled to 0, B reported A offline, reroute returned 202 (idempotent on replay), and B completed `badge-job-001..003`. Result: DRILL PASSED.
  - **Separate real issue investigated with Radar:** the first drill seeded while Station A was still terminating, and treated the heartbeats cleared by reset as an outage.
- **Impact by lane** · **Luke:** from `incident-api`, call `http://badge-control:8090` with the shared `BADGE_INTERNAL_TOKEN`. Ask Ali for it outside Git.
- **Verified** · 35 tests passed. They run the exact `fetch.py` from the ConfigMap and start control plus a station from the fetched code.
- **Open** ·
  - badge-control keeps the queue in memory, so a restart of that pod loses queued jobs until `BADGE_STORE=elastic` lands.
  - In-cluster diagnose is `mock` until Radar issues a service token.
  - `INCIDENT_API_BASE_URL` is empty in the cluster, so signals are recorded only.

## 2026-11-09 — Badge signals checked against the merged incident API

- **Branch or PR** · `ali/badge-k8s`, [PR #4](https://github.com/lukeeskinner/Backstage/pull/4). Merged `ali/badge-simulator` (which includes main at 2555f30).
- **Changes and why** · This log entry only. The finding:
  - The incident API on `main` returns `422 invalid_payload` ("This demo only accepts seating and door counts") for every signal except `zone_count`.
  - I ran it locally (`APP_MODE=mock`) with a token scoped to `source_ids: [station-b]` and `room_ids: [room-c]`. Our `badge_health` and `badge_job_complete` signals passed auth and the contract, then got that 422.
  - The badge outbox treats 422 as permanent: it logs the rejection and doesn't retry.
- **Impact by lane** · **Luke (next owner):** to open the badge stall incident and verify it, the API needs to:
  - accept `badge_health` and `badge_job_complete` from station-scoped tokens;
  - open `badge_stall` from `badge_health` `offline` with aged pending jobs;
  - verify closure once every captured job ID has a `badge_job_complete`.
  The badge side is ready: the payloads are in `fixtures/shared/badge_stall.signals.jsonl`, and the signal ID formats are in the PR #2 entry above.
- **Verified** · The 422 responses are in the uvicorn log. The badge test suite passed after the merge, and so did `make check`.
- **Open** · The owners.json Ali login (`AhmedShAli24`) on `main`, and the badge_stall incident flow in the API (Luke).
- **Reviewed** · main at 2555f30, luke/overflow-api at 1911b12, luke/elastic-overflow at de2884e, and this lane's branches at e137f36 and 61f7062.
