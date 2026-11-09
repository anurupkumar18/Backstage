# dash0

The collector is the only workload that holds a Dash0 credential. Everything here either runs it or describes what Dash0 should show. Setup owner: Anurup. See [the operations runbook](../../observability/README.md) for the current release and proof gates.

## Files

| File | What | Applied by |
| --- | --- | --- |
| `kustomization.yaml` | Collector base: ConfigMap, Deployment, Service `otel-collector` (4317 gRPC, 4318 HTTP, 13133 health). `team-backstage` namespace. | Ali's overlay, or `kubectl --context CONTEXT -n team-backstage apply -k deploy/dash0` |
| `collector-configmap.yaml` | Byte copy of `observability/otel-collector.yaml` | via kustomization |
| `dash0-secret.example.yaml` | Placeholder Secret `dash0-credentials` (keys `DASH0_OTLP_ENDPOINT`, `DASH0_AUTH_TOKEN`, optional `DASH0_DATASET`). Not in the kustomization. | Create the real one with `kubectl create secret` (command in the file) |
| `slo-check-rules.yaml` | Inactive historical SLO proposal; do not apply (no corresponding emitter) | Deferred outside incident-evidence scope |
| `dashboard-incident-timing.yaml` | `PersesDashboard` for measured HTTP, ES, search, document projection and revision lag | Dash0 operator, or `dash0 dashboards create -f` |
| `metrics.md` | Implemented metric names, units, labels and interpretation | Luke implements the emitter |

Regenerate the ConfigMap after editing the collector config, and check drift:

```sh
python3 -c "import yaml;print(yaml.safe_load(open('deploy/dash0/collector-configmap.yaml'))['data']['config.yaml']==open('observability/otel-collector.yaml').read())"
```

The rules and dashboard are not in the kustomization. Their CRDs (`monitoring.coreos.com`, `perses.dev`) only exist where the Dash0 operator or the Prometheus or Perses operators are installed. Ali confirms whether the demo cluster has them. Without them, paste the PromQL from `metrics.md` into the Dash0 UI.

## Evidence the handoff requires

Save both to `docs/demo/evidence/`, and link them in the PR and the demo runbook.

### One trace link

1. Run one overflow incident end to end against the deployed stack. Note its `incident_id` and `trace_id`; the API returns `trace_id` on the incident.
2. In Dash0, open Tracing and filter `service.name = incident-api` with attribute `incident.id = <incident_id>`, or paste the `trace_id`.
3. Confirm the trace shows the `web` fetch span (browser `traceparent`), API ingress, state transition spans with `incident.id` and `event.id`, and the dispatch and ack hops.
4. Copy the trace's share link and take a screenshot. Record the date, incident ID and which spans are present in `docs/demo/evidence/trace.md`.

### One real bug investigation (Dash0 MCP or Agent0)

The bug has to be real, not the staged mic or Station A outage. Good candidates: a 409 storm, a missing span link, a slow Elasticsearch call, or a collector export error.

1. When it happens, ask Agent0 in Dash0, or a coding agent with the Dash0 MCP server connected, something like "why did `POST /api/v1/incidents/{id}/actions` return 409 between 14:05 and 14:10", scoped to the `incident-api` service.
2. Save the question, the tool calls or Agent0 steps, the trace and log links it cites, the root cause, and the fix commit or PR to `docs/demo/evidence/dash0-investigation.md`.
3. Keep tokens and caption text out of the saved transcript.

## Earlier scaffold validation and remaining cluster gates

- The manifests were checked offline and have not been applied to a cluster. Run from this directory:
  - `docker run --rm -v "$PWD":/k:ro registry.k8s.io/kustomize/kustomize:v5.6.0 build /k | docker run --rm -i ghcr.io/yannh/kubeconform:v0.7.0 -strict -summary -` validates ConfigMap, Deployment and Service.
  - kubeconform with the datreeio CRDs-catalog schema location validates `slo-check-rules.yaml`.
  - No public schema for `PersesDashboard` was found, so it was only YAML-parsed.
- The original scaffold had no Dash0 org access; the later API validation below supersedes its dashboard/metric limitation. Historical SLO checks remain inactive.
- The Dash0 MCP was not loaded in the session that wrote this.

Open question: does the demo namespace already run the Dash0 operator with a `Dash0Monitoring` resource, or do the SLO rules have to be created through the Dash0 UI or CLI?

## Verified provider dashboard (2026-11-09)

Anurup created `Backstage measured API and evidence` in dataset `default`, ID
`api-9c3b3b01-71b8-411c-b01a-ec2dd38d6644`. Provider readback matched all nine
panel definitions and layouts. All nine PromQL calls succeeded with real
backend telemetry; empty persistence-error series remain no data. Aggregations
retain `service_version` to avoid combining releases with different histogram
buckets. Whole snapshot projection-pass duration includes multiple ES calls;
individual ES project request latency is a different measurement.

Use the existing dashboard ID for updates rather than creating a duplicate.
The CLI reads `DASH0_API_URL`, `DASH0_AUTH_TOKEN`, `DASH0_DATASET` from a safe
process environment; no token value belongs in command arguments or Git.

```sh
dash0 dashboards update api-9c3b3b01-71b8-411c-b01a-ec2dd38d6644 -f deploy/dash0/dashboard-incident-timing.yaml
dash0 dashboards get api-9c3b3b01-71b8-411c-b01a-ec2dd38d6644 -o json
```

This provider API proof is separate from shared-cluster rollout, dashboard
browser inspection and the Agent0 investigation; record those in the QA handoff.
