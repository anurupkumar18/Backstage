# Ali — connect the badge demo to the incident API

## Goal

Make the deployed badge stations open a Room C incident in Luke's API. Organizer approval and IT acceptance must trigger the reroute. Close only after Station B finishes all three jobs with PDFs.

The code is on `luke/connect-badge-cluster`. Pull that branch for this handoff, or use main after it merges. API runtime is pinned to main commit `8e61ac90ada0469e3d12c817656a166f80222ef1`. No kubeconfig is required if your Radar tools can apply resources and update workloads.

## 1. Check the existing cluster

Use Radar to confirm cluster `backstage` (recorded Radar ID `Wa7aYihloY4`) and namespace `team-backstage`. Read the current badge workloads and settings before changing anything. Confirm `badge-control`, `badge-station-a`, `badge-station-b`, and `badge-secrets` exist.

Schedule this between rehearsals. Restarting badge-control loses its current in-memory jobs and PDFs. Keep the existing `BADGE_INTERNAL_TOKEN` and Radar credentials unchanged. Do not paste credentials into Git, handoffs, chat, or tool logs.

## 2. Prepare storage and private identities

The deployment uses `APP_MODE=live`. Luke must provide the Elastic endpoint and API key privately, with a dedicated provisioned demo alias. Follow [Elasticsearch setup](../../data/elasticsearch/README.md); do not repurpose `backstage-smoke-overflow-state`, which contains the isolated smoke evidence. If the demo alias or credentials are missing, report that exact blocker before deploying.

Luke must create `incident-secrets` in `team-backstage` using kubectl and an ignored local `.env.cluster` file. Do not submit secret values through Radar `apply_resource`, which logs resource bodies. The Secret must contain:

| Key | Value |
| --- | --- |
| `ELASTICSEARCH_URL` | The shared Elastic endpoint |
| `ELASTICSEARCH_API_KEY` | Its private API key |
| `ELASTICSEARCH_INDEX_PREFIX` | Prefix for the provisioned `<prefix>-overflow-state` alias |
| `AUTH_TOKENS_JSON` | JSON object mapping private bearer tokens to the identities below |
| `CORS_ALLOWED_ORIGINS` | Kunj's exact web origin, comma-separated if multiple |

Required identities are an organizer with `id: organizer, tier: 3`, IT staff with `id: it-staff-01, tier: 2, domain: it`, and a producer with `id: badge-simulator`, `source_ids: [station-a, station-b]`, `room_ids: [room-c]`, `signal_kinds: [badge_health, badge_job_complete]` and no tier. Preserve other identities needed by the board. Use private generated tokens as JSON keys. Share the organizer and IT tokens privately with Kunj.

The API reads `BADGE_INTERNAL_TOKEN` directly from the existing `badge-secrets`. No copy or rotation is needed.

## 3. Deploy through Radar

Render plain Kubernetes YAML locally using Python with PyYAML installed (already in the API requirements):

```sh
python3 deploy/incident/render.py > /tmp/backstage-incident.yaml
```

The output contains no credentials. It includes the bootstrap ConfigMap, Service and single-replica Deployment. Use Radar's resource apply capability to dry-run and then apply these three resources to `team-backstage`. If the tool accepts one object at a time, split the YAML documents at `---`.

Wait for `incident-api` to become ready. Its `/readyz` checks Elasticsearch. Inspect init-container logs if startup fails; it needs network access to GitHub and PyPI. Do not point the badge stations at an unready API.

If you have kubectl instead, [the deployment README](../../deploy/incident/README.md) provides `connect.py`, which performs deployment and connection after the Secrets are ready.

## 4. Connect both directions

The API manifest already sets `BADGE_SERVICE_URL=http://badge-control:8090`.

Luke must set the signal token using kubectl or `connect.py --apply`, preserving all other Secret keys. Ali can update the non-secret ConfigMap through Radar after that:

- Set `badge-secrets.BADGE_SIGNAL_TOKEN` to the exact producer token used as a key in `AUTH_TOKENS_JSON`.
- Set `badge-config.INCIDENT_API_BASE_URL` to `http://incident-api:8000/api/v1`.
- Restart badge-control and both station Deployments, waiting for readiness. Retain the existing Radar mode until a real service token is configured.

In your own lane, persist that URL in `deploy/badge/badge-config.yaml` and add `../incident` under `resources` in `deploy/platform/kustomization.yaml`. Otherwise applying the old aggregate config removes the URL again. Push these changes with an Ali handoff entry.

## 5. Run the combined rehearsal

1. Scale Station A to zero and wait until its pod is gone.
2. Call badge-control's authenticated `POST /admin/reset`, then wait for Station B to heartbeat. Call `POST /admin/seed` with `{"station_id":"station-a","job_ids":["badge-job-001","badge-job-002","badge-job-003"]}`. Use the existing internal token for these admin calls.
3. Wait for the API to show a Room C `badge_stall` incident in `plan_proposed`.
4. Approve in the board as organizer. Accept as the assigned IT staff member. If the board is unavailable, use the same documented [API actions](../../contracts/openapi.yaml) with current versions, plan/assignment IDs, and unique idempotency keys.
5. Confirm the API drives reroute, all three jobs complete on Station B, and each PDF is available. Confirm the incident is `resolved` and its timeline ends with `verify`, `close`, containing the three completion evidence IDs.
6. Restore Station A to one replica and confirm readiness even if the test fails.

Do not run the existing `badge-drill` Job for this test. That standalone drill reroutes directly, bypassing organizer approval and staff acceptance.

## 6. Record results

Append to `docs/radar/handoff-log.md` and push with your deployment changes. Record the deployed SHAs, namespace, incident ID, timeline outcome, three job/PDF results, and restored Station A health. Include any remaining blockers. Link the entry for Luke and Kunj.

Local HTTP integration can verify code behavior, but only this cluster rehearsal proves the deployed connection. Real Radar diagnosis and persistent badge queue storage remain separate unfinished work.
