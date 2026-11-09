# Observability operations

The collector alone holds the Dash0 credential. Anurup owns this setup. Browser
telemetry uses a same-origin proxy, backend exports run independently of API
success, and evidence search reads Elasticsearch rather than Dash0. Namespace:
`team-backstage`. No live deployment is implied by these configuration files.

## Endpoints and configuration

| Caller | Configuration |
| --- | --- |
| Incident API | `OTEL_ENABLED=true`, `OTEL_SERVICE_NAME=incident-api`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| Other namespace services | Same endpoint/protocol and their own `OTEL_SERVICE_NAME`; owners must enable their SDKs |
| API resources | `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=demo,service.namespace=team-backstage,service.version=<deployed Git SHA>` |
| Browser SDK Web | `VITE_BROWSER_OTLP_URL=/otel`; SDK trace and log URLs resolve to same-origin `/otel/v1/traces` and `/otel/v1/logs` |
| Local API | `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` with the same enabled flag/protocol |
| Collector | `DASH0_OTLP_ENDPOINT` = onboarding gRPC host:port, `DASH0_AUTH_TOKEN`, optional `DASH0_DATASET=default` |
| Local browser direct to collector | `OTEL_CORS_ALLOWED_ORIGIN=http://localhost:5173`; exact origin only |

Browser-visible values contain endpoints and flags only. Never set a provider
credential in `VITE_*`, browser headers, Docker build args, or a URL. Kubernetes
Secret `dash0-credentials` contains only collector settings; `incident-secrets`
retains its existing server identities. Do not replace either Secret wholesale
from an old local file. Operators create/update them through an approved secret
entry path without printing values. Do not enter secrets through logged tools.

`deploy/incident/incident-api.yaml` pins bootstrap and runtime `CODE_SHA` to the
same existing release. Before releasing this implementation, publish a full
40-character commit and update **both** pins to it; runtime `service.version`
expands from `CODE_SHA`. Applying new env with the old code does not enable the
new SDK or evidence endpoints. Deploy one writer with Recreate strategy.

## Privacy and bounded failure

SDK Web emits OTLP/HTTP JSON to the standard trace/log receiver; backend uses
HTTP/protobuf. Collector supports both on port 4318. The nginx `/otel/v1/traces` and `/otel/v1/logs` routes rewrite to collector
`/v1/traces` and `/v1/logs`. Legacy root routes remain accepted. The dedicated
`/otel` SDK base prevents its transport-prefix exclusion from suppressing API
and navigation monitoring. These nginx routes accept POST
only, strip all incoming request headers except Content-Type/Content-Encoding,
share a per-client 10 requests/second budget (burst 20), and enforce a 2 MiB body
limit plus 2-second connection / 5-second IO limits. Access logs for telemetry
are disabled. Namespace collector Service remains internal. The proxy does not
authenticate browser payloads: do not expose collector ports publicly; public
web ingress may need an operator traffic policy if used outside this demo.

Capture producers own query/fragment scrubbing, URL/path sanitization, and log
allowlisting. Only counts and safe lifecycle metadata belong here; no request
bodies, auth headers, caption text, frames, badge PII, raw search text, or replay.
Collector auth/cookie/idempotency-attribute deletion is defense in depth and
cannot sanitize arbitrary log bodies. Debug output is local synthetic QA only.

Both collector configs cap decompressed HTTP input to 2 MiB and use a fixed
384 MiB memory limit (96 MiB spike margin) inside a 512 MiB container budget.
Batches cap at 512 records. Dash0 export uses a 256-request memory queue, two
consumers, nonblocking overflow, 5-second calls and at most 15 seconds retry.
An outage may drop telemetry; API mutations must not wait for ingestion.
Queue bounds are batches, not a byte guarantee. Collector health checks prove
process readiness, not successful vendor delivery. No disk spool is configured.

## Local validation and run

From `observability/` (Docker is a prerequisite):

```sh
docker run --rm -v "$PWD":/cfg:ro \
  -e DASH0_OTLP_ENDPOINT=ingress.example.invalid:4317 \
  -e DASH0_AUTH_TOKEN=placeholder \
  otel/opentelemetry-collector-contrib:0.164.0 validate --config=/cfg/otel-collector.yaml
docker run --rm -v "$PWD":/cfg:ro \
  otel/opentelemetry-collector-contrib:0.164.0 validate --config=/cfg/otel-collector.local.yaml

docker compose up otel-collector
# Or separately: copy .env.example to ignored .env, populate through local editor,
# stop debug collector first (same ports), then:
docker compose --profile dash0 up otel-collector-dash0
```

Compose binds only loopback and caps memory to 512 MiB. No Elasticsearch is
started. The local debug exporter prints counts/basic metadata, not a Dash0
receipt. Test JSON traces **and logs** with clearly labeled synthetic payloads.
Empty `{}` POSTs test transport acceptance only, not a real span/log ingest.

## Cluster rollout and acceptance

1. Confirm explicit kubectl context and namespace `team-backstage`; inventory
   existing resources without reading Secret values. Preserve Ali's aggregate
   and badge configuration. Confirm the collector Secret exists and is nonempty
   through a safe operator check; no credentials in shell history or artifacts.
2. Validate collector config and render owner bases. Apply collector resources
   first, then deploy API at the final published SHA and a rebuilt web image.
   Wait for each rollout; use `kubectl --context CONTEXT -n team-backstage ...`.
   Web nginx resolves API and collector Services at startup, so both must exist.
3. Bootstrap the evidence alias `${ELASTICSEARCH_INDEX_PREFIX}-incident-evidence`
   with `data/elasticsearch/incident-evidence-v1.json` and grant the backend identity
   `read`, `create_doc`, `view_index_metadata`, and `maintenance` (for refresh) on
   only its evidence index. The workload defaults `EVIDENCE_PROJECTION_ENABLED=false`;
   change to `true` and restart the single writer only after provisioning. Missing
   alias/permission is an explicit deployment failure, never successful empty search.
   Optional `DASH0_TRACE_URL_TEMPLATE` may be set server-side to an HTTPS Dash0 URL
   containing `{trace_id}`; no valid template means diagnostics link stays null.
4. Configure SDK Web once with privacy filters, endpoint pair, and release/env
   metadata in the frontend lane. Build the web image with
   `--build-arg VITE_SERVICE_VERSION=<published Git SHA>` and
   `--build-arg VITE_DEPLOYMENT_ENVIRONMENT=demo`; the default version
   `development` is for local builds only. Confirm HTTPS origin for real browser monitoring
   and mic features. Loopback/port-forward QA must be labeled local.
5. Drive a labeled synthetic incident through authorization gates. Find the same
   trace ID in the browser request, API ingress and ES child spans. Observe a
   correlated backend committed log, metric samples and browser event/log in
   Dash0 itself; receiving HTTP 200 from collector is insufficient.
6. Import `deploy/dash0/dashboard-incident-timing.yaml` using the provider UI or
   approved CLI/operator path. Dashboard CRDs are not included in the workload
   base; absence of the Perses CRD requires provider import rather than kubectl.
   Confirm every intended instrument has actual samples and queries return those
   samples. An empty panel means no data. See `deploy/dash0/metrics.md`.
7. For evidence storage, backend owner provisions isolated prefix mappings and
   access rights (see `data/elasticsearch/`). Confirm committed projection,
   searchable watermark, restart/replay uniqueness, scoped filters and explicit
   search outage. Never substitute the live demo alias for an isolated QA prefix.
8. Record UTC window, deployed Git SHA/image, actual provider trace/log/metric
   links and inspected results without credentials. Use Agent0/MCP for one real
   finding and fix or record the exact access limitation. Do not claim historical
   SLO timing rules were measured: those emitters are outside this implementation.

An unavailable collector must not prevent API readiness, mutation commits, or
search responses. Verify a short collector export outage in an isolated QA
setup; recovery proves current export resumed, not that dropped data returned.
Rollback workload images/runtime pins to the previous release and remove only
this deployment's telemetry env if necessary. Preserve checkpoints, evidence
indices and existing identities; do not clear storage to recover telemetry.

## Source and generated config

`otel-collector.yaml` is the Dash0 config; `otel-collector.local.yaml` has identical
receivers and processors with local debug export. The deployment ConfigMap must
contain the source byte for byte. From repository root:

```sh
python3 -c "import yaml; from pathlib import Path; assert yaml.safe_load(Path('deploy/dash0/collector-configmap.yaml').read_text())['data']['config.yaml'] == Path('observability/otel-collector.yaml').read_text()"
python3 deploy/incident/render.py > /tmp/backstage-incident-render.yaml
```

Schema references:
[OTLP receiver](https://github.com/open-telemetry/opentelemetry-collector/blob/main/receiver/otlpreceiver/README.md),
[HTTP limits](https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/confighttp/README.md),
[Dash0 panel/query format](https://www.dash0.com/docs/dash0/dashboards/reference-dashboard-source-format).
Validate against pinned collector 0.164.0 before rollout; current online docs may
be newer. Local static checks cannot establish cluster or Dash0 ingest success.

## Validation evidence for this amendment (2026-11-09)

Official Darwin arm64 collector-contrib 0.164.0 asset SHA256 verified against its
published `.sha256`: `af6a0c56886e3cc36ccebe849fa167bad2bc47a97a48fd8497a0d6f93d0cf73a`.
Both source configs passed native `validate`. An isolated loopback debug run on
ports 14317/14318/14333 accepted one labeled synthetic OTLP/JSON trace and log
(200 with exact-origin CORS), rejected malformed log JSON (400), and emitted
one span / one log record through debug. Process stopped afterward. All 14 owned
YAML files parsed, source/ConfigMap equality and incident standalone render passed.
No current nginx binary, image build, kustomize/kubeconform, cluster apply, provider
receipt or dashboard import was tested by this amendment's local validation.
