# web

The browser only ever talks to its own origin. nginx forwards `/api/v1/*` to `incident-api:8000` and `POST /v1/traces` and `POST /v1/logs` to `otel-collector:4318`. No Dash0 token or API token is ever baked into the bundle. Owner: Kunj.

## Build and run

```sh
# from the repo root
docker build -f deploy/web/Dockerfile -t backstage-web:dev .
docker run --rm -p 8080:8080 --add-host incident-api:host-gateway --add-host otel-collector:host-gateway backstage-web:dev
```

The build bakes in `VITE_MOCK_API=false`, `VITE_API_BASE_URL=/api/v1` and `VITE_BROWSER_OTLP_URL=/otel`. Override any of them with `--build-arg`. Pass only endpoints and flags. Users enter tokens at runtime.

## Routes

| Path | Goes to |
| --- | --- |
| `/api/v1/...` | `http://incident-api:8000/api/v1/...` (prefix kept, matching `contracts/openapi.yaml`) |
| `POST /otel/v1/traces` (legacy `/v1/traces`) | `http://otel-collector:4318/v1/traces`. Other methods are denied. |
| `POST /otel/v1/logs` (legacy `/v1/logs`) | `http://otel-collector:4318/v1/logs`. Other methods are denied. Browser metrics are not proxied. |
| `/stage`, `/stage.html` | stage mic and caption producer |
| `/healthz` | `ok` (used by probes) |
| anything else | the file if it exists, otherwise `index.html` (board, `#/status`, `#/projector`) |

## Kubernetes

`kustomization.yaml` adds `web.yaml`, which defines Deployment `web` (container port 8080, image `backstage-web:dev`) and Service `web` (port 80). The base sets namespace `team-backstage`; Ali retains control of the aggregate and image tag.

## Constraints to know before the demo

- nginx resolves `incident-api` and `otel-collector` when it starts. If either Service is missing, the pod fails `nginx -t` and crash-loops. Apply the Services first. They resolve as soon as they exist, even before their pods are ready.
- `getUserMedia` works only in a secure context. A stage page served over plain HTTP on a cluster or LAN address gets no microphone. On the stage laptop, use `kubectl port-forward svc/web 8080:80` and open `http://localhost:8080/stage.html`, or put TLS in front. The manual fallback works either way.
- The response headers set `Permissions-Policy: microphone=(self)`.

## Earlier scaffold validation on 2026-11-09

- The image builds with Docker 29.5.2 and the legacy builder.
- `nginx -t` passes when the upstreams resolve.
- A stub API received the `/api/v1/signals` path along with the `Authorization` and `traceparent` headers.
- `/v1/traces` returned 200 from `otel-collector-contrib` 0.164.0.
- The SPA fallback and `stage.html` are served, and `/stage` redirects relatively.
- kubeconform validated the built kustomization.
- Not applied to a cluster.

The bounded traces/logs proxy amendment passed native nginx 1.31.8 runtime smoke on loopback with production dist, real API/collector, body/method/rate rejection and a credential-stripping capture upstream. The pinned production image rebuild remains an integration gate.

Open question: does the venue demo reach `web` through an Ingress with TLS, so the stage page can use the microphone without a port-forward?

## Browser monitoring ingest

See [operations](../../observability/README.md). The nginx proxy accepts only
POST `/otel/v1/traces` and `/otel/v1/logs` (legacy root paths also accepted), clears incoming credentials and other request
headers, and bounds body size, rate, and timeouts. Configure SDK Web once in the
app lane with the same-origin pair; no Dash0 token belongs in the image or bundle.
Both Services must exist before nginx starts. The base targets `team-backstage`.

Production builds pass `--build-arg VITE_SERVICE_VERSION=<published Git SHA>`
and `--build-arg VITE_DEPLOYMENT_ENVIRONMENT=demo`. The local version default
is `development`. The dedicated SDK `/otel` base prevents its own-transport
prefix exclusion from suppressing same-origin API and navigation telemetry.
