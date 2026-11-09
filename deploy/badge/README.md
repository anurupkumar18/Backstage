# badge

Badge station and badge-control manifests for namespace `team-backstage` on cluster `backstage`. Owner: Ali.

| Object | Role |
| --- | --- |
| `Deployment/badge-control`, `Service/badge-control:8090` | `BADGE_ROLE=control`. Owns the queue, heartbeats and PDFs, and serves the internal contract. Stays up when Station A stops. One replica, because the queue is in memory until `BADGE_STORE=elastic` lands. |
| `Deployment/badge-station-a`, `Deployment/badge-station-b` | `BADGE_ROLE=station`. Heartbeat to badge-control, print their queue, upload PDFs, and report a stale peer. |
| `ConfigMap/badge-config` | Non-secret settings. |
| `ConfigMap/badge-code` | Generated. The `badge_sim` and `radar` packages as `badge-sim.zip`, run on the stock `python:3.13-slim` image via `PYTHONPATH`, so no image build or registry is needed. |
| `Secret/badge-secrets` | Not committed. Create it by hand (below). |

Pods run as non-root with a read-only root filesystem, all capabilities dropped and no service account token.

## Deploy

```sh
kubectl -n team-backstage create secret generic badge-secrets \
  --from-literal=BADGE_INTERNAL_TOKEN="$(openssl rand -hex 24)" \
  --from-literal=BADGE_SIGNAL_TOKEN=<scoped token from Luke> \
  --from-literal=RADAR_TOKEN=                       # empty until a service token exists
kubectl apply -k deploy/platform
kubectl -n team-backstage rollout status deploy/badge-control deploy/badge-station-a deploy/badge-station-b
```

After changing Python code, regenerate the bundle and restart the pods. A ConfigMap change alone does not restart them.

```sh
python deploy/badge/render_code_configmap.py
kubectl apply -k deploy/platform
kubectl -n team-backstage rollout restart deploy/badge-control deploy/badge-station-a deploy/badge-station-b
```

The tests in `services/badge-simulator/tests/test_deploy.py` fail when the bundle is stale.

## Staged outage

```sh
kubectl -n team-backstage port-forward svc/badge-control 8090:8090 &
export BADGE_INTERNAL_TOKEN=<from the secret>
cd services/badge-simulator
python -m badge_sim reset
python -m badge_sim seed --station station-a     # three jobs queued at A
kubectl -n team-backstage scale deployment/badge-station-a --replicas=0
python -m badge_sim state                         # A goes offline after BADGE_HEARTBEAT_TIMEOUT
# diagnose and reroute through the incident API flow, then confirm B completes the three jobs
kubectl -n team-backstage scale deployment/badge-station-a --replicas=1
```

`fault` and `recover` do not apply in the cluster. badge-control answers them with 409 and tells you to scale the Deployment.
