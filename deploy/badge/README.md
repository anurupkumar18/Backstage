# badge

Badge station and badge-control manifests for namespace `team-backstage` on cluster `backstage` (Radar id `Wa7aYihloY4`). Owner: Ali.

**Status (2026-11-09):** deployed and drilled on the cluster. See [docs/radar](../../docs/radar/README.md) for the evidence.

| Object | Role |
| --- | --- |
| `Deployment/badge-control`, `Service/badge-control:8090` | `BADGE_ROLE=control`. Owns the queue, heartbeats and PDFs, and serves the internal contract. Stays up when Station A stops. One replica, because the queue is in memory until `BADGE_STORE=elastic` lands. |
| `Deployment/badge-station-a`, `Deployment/badge-station-b` | `BADGE_ROLE=station`. Heartbeat to badge-control, print their queue, upload PDFs, and report a stale peer. |
| `ConfigMap/badge-config` | Non-secret settings. |
| `ConfigMap/badge-fetch-code` | `fetch.py`, plus the repo and the pinned commit `CODE_SHA`. Each pod's `fetch-code` init container downloads that commit from GitHub and keeps only `badge_sim/` and `radar/`. The main container runs them on the stock `python:3.13-slim` image, so no image build or registry is needed. |
| `Secret/badge-secrets` | Not committed. Create it by hand (below). |
| `drill-job.yaml` | The staged-outage drill as a Job. Not in the kustomization, so it only runs when you apply it. |

Pods run as non-root with a read-only root filesystem, all capabilities dropped and no service-account token.

## Deploy

```sh
kubectl -n team-backstage create secret generic badge-secrets \
  --from-literal=BADGE_INTERNAL_TOKEN="$(openssl rand -hex 24)" \
  --from-literal=BADGE_SIGNAL_TOKEN= \
  --from-literal=RADAR_TOKEN=
kubectl apply -k deploy/platform
kubectl -n team-backstage rollout status deploy/badge-control deploy/badge-station-a deploy/badge-station-b
```

The token in the cluster today is in `services/badge-simulator/.env.cluster` on Ali's laptop. That file is git-ignored.

To ship new code: push the commit, set `CODE_SHA` in `badge-fetch-code.yaml` to it, apply, then restart the pods. A ConfigMap change alone does not restart them.

```sh
kubectl apply -k deploy/platform
kubectl -n team-backstage rollout restart deploy/badge-control deploy/badge-station-a deploy/badge-station-b
```

## Staged outage drill

```sh
kubectl -n team-backstage scale deployment/badge-station-a --replicas=0
kubectl -n team-backstage wait --for=delete pod -l app.kubernetes.io/name=badge-station-a --timeout=60s
kubectl -n team-backstage delete job badge-drill --ignore-not-found
kubectl -n team-backstage apply -f deploy/badge/drill-job.yaml
kubectl -n team-backstage logs -f job/badge-drill          # ends with DRILL PASSED
kubectl -n team-backstage scale deployment/badge-station-a --replicas=1
```

The drill resets badge-control, waits for B to heartbeat, and seeds `badge-job-001..003` at A. It checks they stall, runs diagnose, then reroutes to B and replays the same `Idempotency-Key`. It ends by checking that B completes all three with `pdf-<job_id>`.

Wait for A's pod to be gone before seeding. On the first attempt the drill seeded while A was still terminating, so A printed the jobs itself.

The same steps work through Radar MCP without `kubectl`: `manage_workload` scales the station, `wait_for` waits for the pod to be deleted, `apply_resource` starts the drill Job, and `get_workload_logs` reads its output.
