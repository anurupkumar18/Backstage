# radar

Radar setup and investigation notes. Owner: Ali.

## Access

- Radar Cloud MCP is configured for coding agents in the repo's `.mcp.json` (`https://api.radarhq.io/mcp`). Each person signs in once with `/mcp` → radar → Authenticate.
- Org: Cloud Native Hackathon. Our cluster is `backstage`, id `Wa7aYihloY4`.
- Namespace `team-backstage` exists. On 2026-11-09 it held a Deployment `app` (2 pods, `node:22-alpine`). Argo CD and Argo Rollouts are installed in the cluster.

## Service access (open dependency)

`badge-control` in `RADAR_MODE=radar` needs a bearer token it can use without a browser (`RADAR_TOKEN`). The coding-agent login is an interactive OAuth sign-in stored on the laptop and must not be copied into the cluster. Confirm with the Radar team whether Radar Cloud issues service or API tokens scoped to one cluster and read-only tools. Until then badge-control runs in `RADAR_MODE=mock`, and real Radar evidence comes from the coding agent's investigation.

## Deployment through Radar (2026-11-09)

The badge services were deployed with Radar MCP alone, with no `kubectl` and no image build:

1. `apply_resource` with `dry_run: true` on the manifests. The API server accepted all of them, including the restricted pod security settings.
2. `apply_resource` created `Secret/badge-secrets`, the two ConfigMaps, `Service/badge-control` and the three Deployments.
3. `wait_for` reported every Deployment `rolled out: 1/1 available`. The `fetch-code` init containers downloaded the pinned commit from GitHub, which confirmed that pods have egress to GitHub.
4. `get_workload_logs` showed `station-a online` and `station-b online` with no `tick failed` lines, so both stations were heartbeating to badge-control.

## Evidence

### 1. Staged outage: Station A stopped as a real workload

| Time (UTC) | Source | Observation |
| --- | --- | --- |
| 19:34:34 | `manage_workload scale badge-station-a 0`; Radar `get_events` | `ScalingReplicaSet`: "Scaled down replica set badge-station-a-57498f49bb from 1 to 0" |
| 19:34:34 | Radar `diagnose deployment/badge-station-a`, `recentChanges` | `spec.replicas` 1 → 0 (`spec_config` change) |
| 19:35:31 | `badge-station-b` logs | `station-b reports station-a offline (3 pending)` |
| 19:35:37 | `job/badge-drill-2` logs | jobs stuck at station-a: `badge-job-001..003`; diagnose (`mode: mock`): "Station A is offline: never sent a heartbeat. 3 pending job(s)" |
| 19:35:37 | `job/badge-drill-2` logs | reroute `202 {"accepted_job_ids": [...3 jobs]}`; replay with the same `Idempotency-Key` returned the same body |
| 19:35:38–40 | `badge-station-b` logs | `station-b completed badge-job-00{1,2,3} as pdf-badge-job-00{1,2,3}` |
| 19:35:41 | `job/badge-drill-2` | all three jobs `complete` at `station-b` with stable `pdf_ref`. **DRILL PASSED** |
| 19:36 | `manage_workload scale badge-station-a 1`; `wait_for` | Station A restored, `1/1 available` |

The in-service diagnose ran in `mock` mode because badge-control has no Radar service token yet (see above). The Radar evidence for the stopped workload comes from the coding agent's `diagnose` and `get_events` calls in this table.

### 2. Real issue investigated with Radar: the first drill failed

This is separate from the staged outage. The first drill (`job/badge-drill`, 19:34:40) failed, and Radar showed two real causes:

- **The drill reported Station A offline before Station A had stopped.** The drill log showed `station-a offline: heartbeat_age_s null` immediately after `/admin/reset`. Reset clears all heartbeats, so the drill treated "no heartbeat yet" as "offline". The reroute then got `409 invalid_transition: station-b is not online`, because B had not heartbeated since the reset either.
- **Station A printed the seeded jobs while terminating.** Radar `diagnose deployment/badge-station-a` (`logsCurrent`) showed the old pod still running after the scale-down and logging `station-a completed badge-job-001..003` at 19:34:42–44, eight seconds after `replicas: 1→0`. The pod had not finished terminating when the drill seeded.

Fix (in `deploy/badge/drill-job.yaml`): wait for the station-a pod to be deleted (`wait_for ... condition=deleted`) before starting the drill. After the reset, the drill now waits until B is online and A is silent, then checks that all three jobs actually stall at A before rerouting. The second run (`job/badge-drill-2`) passed.
