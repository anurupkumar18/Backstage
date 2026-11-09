# observability

Every service ships spans to one collector, `otel-collector`, and only that collector holds the Dash0 token. Owner: Kunj.

## Collector address for the team

| Caller | Set |
| --- | --- |
| Services in the cluster (`incident-api`, `agent-workers`, `badge-station-a`, `badge-station-b`, `badge-control`) | `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`, `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`, `OTEL_SERVICE_NAME=<k8s service name>` |
| Same, if your SDK only does HTTP | `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| Local processes against `docker run`/compose below | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`, `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` |
| Browser (`web`) | Same-origin `/v1/traces`; nginx in `deploy/web/` proxies to `otel-collector:4318`. Local dev uses `VITE_BROWSER_OTLP_URL=http://localhost:4318/v1/traces`. |

Both endpoints are plaintext inside the namespace; Ali wires the network path (Service `otel-collector`, ports 4317/4318, namespace in `deploy/dash0/`). Health: `http://otel-collector:13133/`.

## Files

- `otel-collector.yaml`: OTLP gRPC 4317 and HTTP 4318, CORS for one browser origin, `memory_limiter`, an attribute scrub for auth/cookie/idempotency headers, `batch`, then `otlp/dash0` with `Authorization: Bearer ${DASH0_AUTH_TOKEN}` and `Dash0-Dataset: ${DASH0_DATASET}`. Traces, metrics and logs pipelines.
- `otel-collector.local.yaml`: same receivers and processors, `debug` exporter. Use it when no Dash0 token exists.
- `docker-compose.yaml`: `otel-collector` (debug) by default, `otel-collector-dash0` under the `dash0` profile reading `.env`.
- `.env.example`: copy to `.env` (ignored) for the Dash0 profile.

Header format comes from Dash0's own Python distribution docs (`Authorization=Bearer $DASH0_AUTH_TOKEN,Dash0-Dataset=default`). The ingress host is region-specific; copy it from Dash0 onboarding, in `host:4317` form for this gRPC exporter.

## Run and validate

```sh
docker run --rm -v "$PWD":/cfg:ro -e DASH0_OTLP_ENDPOINT=ingress.example.invalid:4317 -e DASH0_AUTH_TOKEN=placeholder \
  otel/opentelemetry-collector-contrib:0.164.0 validate --config=/cfg/otel-collector.yaml
docker run --rm -v "$PWD":/cfg:ro otel/opentelemetry-collector-contrib:0.164.0 validate --config=/cfg/otel-collector.local.yaml

docker compose up otel-collector                     # debug exporter
docker compose --profile dash0 up otel-collector-dash0  # needs .env
```

Without the compose plugin, the debug collector runs as:

```sh
docker run --rm -p 4317:4317 -p 4318:4318 -p 13133:13133 \
  -v "$PWD/otel-collector.local.yaml":/etc/otelcol/config.yaml:ro \
  otel/opentelemetry-collector-contrib:0.164.0 --config=/etc/otelcol/config.yaml
```

Never put incident IDs in metric attributes, and never put caption text, frames, badge PII or tokens in any signal. The scrub processor is a backstop, not the control.

Open question: does the demo venue network let the laptop reach the cluster's `/v1/traces` route, or does the stage laptop need its own port-forward to 4318?
