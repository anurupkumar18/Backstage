# web

The browser only ever talks to its own origin. nginx forwards `/api/v1/*` to `incident-api:8000` and `POST /v1/traces` to `otel-collector:4318`. No Dash0 token or API token is ever baked into the bundle. Owner: Kunj.

## Build and run

```sh
# from the repo root
docker build -f deploy/web/Dockerfile -t backstage-web:dev .
docker run --rm -p 8080:8080 --add-host incident-api:host-gateway --add-host otel-collector:host-gateway backstage-web:dev
```

The build bakes in `VITE_MOCK_API=false`, `VITE_API_BASE_URL=/api/v1` and `VITE_BROWSER_OTLP_URL=/v1/traces`. Override any of them with `--build-arg`. Pass only endpoints and flags. Users enter tokens at runtime.

## Routes

| Path | Goes to |
| --- | --- |
| `/api/v1/...` | `http://incident-api:8000/api/v1/...` (prefix kept, matching `contracts/openapi.yaml`) |
| `POST /v1/traces` | `http://otel-collector:4318/v1/traces`. Other methods are denied. Browser metrics and logs are not proxied. |
| `/stage`, `/stage.html` | stage mic and caption producer |
| `/healthz` | `ok` (used by probes) |
| anything else | the file if it exists, otherwise `index.html` (board, `#/status`, `#/projector`) |

## Kubernetes

`kustomization.yaml` adds `web.yaml`, which defines Deployment `web` (container port 8080, image `backstage-web:dev`) and Service `web` (port 80). The kustomization sets no namespace, so Ali's overlay sets the namespace and the image tag.

## Constraints to know before the demo

- nginx resolves `incident-api` and `otel-collector` when it starts. If either Service is missing, the pod fails `nginx -t` and crash-loops. Apply the Services first. They resolve as soon as they exist, even before their pods are ready.
- `getUserMedia` works only in a secure context. A stage page served over plain HTTP on a cluster or LAN address gets no microphone. On the stage laptop, use `kubectl port-forward svc/web 8080:80` and open `http://localhost:8080/stage.html`, or put TLS in front. The manual fallback works either way.
- The response headers set `Permissions-Policy: microphone=(self)`.

## Verified on 2026-11-09

- The image builds with Docker 29.5.2 and the legacy builder.
- `nginx -t` passes when the upstreams resolve.
- A stub API received the `/api/v1/signals` path along with the `Authorization` and `traceparent` headers.
- `/v1/traces` returned 200 from `otel-collector-contrib` 0.164.0.
- The SPA fallback and `stage.html` are served, and `/stage` redirects relatively.
- kubeconform validated the built kustomization.
- Not applied to a cluster.

Open question: does the venue demo reach `web` through an Ingress with TLS, so the stage page can use the microphone without a port-forward?
