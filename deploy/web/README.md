# web

The browser only ever talks to its own origin. A loopback-only Node sidecar serves voice token minting and anonymous presence. nginx forwards `/api/v1/*` to `incident-api:8000` and `POST /otel/v1/traces` and `POST /otel/v1/logs` to `otel-collector:4318`. No Dash0 token or API token is ever baked into the bundle. Owner: Kunj.

## Build and run

```sh
# from the repo root
docker build -f deploy/web/Dockerfile --target runtime -t backstage-web-runtime:dev .
docker build -f deploy/web/Dockerfile --target web -t backstage-web:dev .
# The two containers share a pod network in Kubernetes. A standalone nginx needs the runtime beside it.
```

The build bakes in `VITE_MOCK_API=false`, `VITE_API_BASE_URL=/api/v1` `VITE_ENABLE_VOICE=true` and `VITE_BROWSER_OTLP_URL=/otel`. Override any of them with `--build-arg`. Pass only endpoints and flags. Users enter Backstage role tokens at runtime; these are never OpenAI keys.

## Routes

| Path | Goes to |
| --- | --- |
| `/api/v1/...` | `http://incident-api:8000/api/v1/...` (prefix kept, matching `contracts/openapi.yaml`) |
| `POST /otel/v1/traces` (legacy `/v1/traces`) | `http://otel-collector:4318/v1/traces`. Other methods are denied. |
| `POST /otel/v1/logs` (legacy `/v1/logs`) | `http://otel-collector:4318/v1/logs`. Other methods are denied. Browser metrics are not proxied. |
| `POST /openai/briefing/token` | loopback Node runtime; checks the Backstage bearer against the incident API before minting an ephemeral secret |
| `/openai*` other than briefing | 404; transcription/triage/health routes stay private |
| `GET /presence`, `POST/DELETE /presence/join` | anonymous in-memory counts; other presence routes including reset are blocked |
| `/stage`, `/stage.html` | stage mic and caption producer |
| `/healthz` | `ok` (used by probes) |
| anything else | the file if it exists, otherwise `index.html` (board, `#/status`, `#/projector`) |

## Kubernetes

`kustomization.yaml` adds `web.yaml`, which defines Deployment `web` (container port 8080, image `backstage-web:dev`) and Service `web` (port 80). The base targets `team-backstage`; Ali's overlay retains control of the image tags for both `backstage-web` and `backstage-web-runtime`. Keep replicas at one because presence and rate limits are in memory.

## OpenAI server Secret

Provision Secret `web-openai` with key `OPENAI_API_KEY` in the same namespace using the platform's secure Secret editor or secret manager. Never enter it in the web UI, a Vite variable, image build argument, Git file or logged apply request. Only the Node sidecar receives the value through `secretKeyRef`; nginx and the static bundle do not. Restart Deployment `web` after creating or rotating the Secret because environment values are loaded at container startup.

The Secret is optional so the board and check-in can run before it exists. Voice then returns `503 openai_not_configured`. nginx exposes only `/openai/briefing/token`, whose server-side scope check runs before minting; `/openai/triage` and `/openai/realtime/token` must remain blocked. The runtime binds only pod loopback and has no Service port. `OPENAI_ALLOW_REMOTE=1` permits nginx's client forwarding header; it does not bypass bearer validation on briefing.

Ali's current platform overlay includes badge and incident only. Add `../dash0` after provisioning its credentials, then `../web`, and publish both web images to a registry the cluster can pull. This change does not apply the overlay or provision Secrets. Use HTTPS for a public microphone-enabled deployment.

## Constraints to know before the demo

- nginx resolves `incident-api` and `otel-collector` when it starts. If either Service is missing, the pod fails `nginx -t` and crash-loops. Apply the Services first. They resolve as soon as they exist, even before their pods are ready.
- `getUserMedia` works only in a secure context. A stage page served over plain HTTP on a cluster or LAN address gets no microphone. On the stage laptop, use `kubectl port-forward svc/web 8080:80` and open `http://localhost:8080/stage.html`, or put TLS in front. The manual fallback works either way.
- The response headers set `Permissions-Policy: microphone=(self), camera=(self)`. Camera permission is requested only by the video page’s explicit camera button.

## Earlier static-image verification on 2026-11-09

- The image builds with Docker 29.5.2 and the legacy builder.
- `nginx -t` passes when the upstreams resolve.
- A stub API received the `/api/v1/signals` path along with the `Authorization` and `traceparent` headers.
- `/v1/traces` returned 200 from `otel-collector-contrib` 0.164.0.
- The SPA fallback and `stage.html` are served, and `/stage` redirects relatively.
- kubeconform validated the built kustomization.
- Not applied to a cluster.

Open question: does the venue demo reach `web` through an Ingress with TLS, so the stage page can use the microphone without a port-forward?

## Voice deployment validation on 2026-11-09

Both Docker targets built successfully, including TypeScript and the production Vite build. Kustomize rendering and strict kubeconform validation passed for Deployment and Service. All 30 Node server tests passed.

A local Docker smoke test shared the nginx container's network with the loopback runtime, with a stub incident API and a fake OpenAI key. Root, health, presence reads and joining returned 200. Briefing with an invalid Backstage bearer returned 401 before any vendor mint. Transcription, triage, OpenAI health and presence reset routes returned 404. `nginx -t` passed. No real credentials, vendor calls or cluster changes were used. This does not verify the deployed cluster or a real microphone.

## Video and vision demo

`#/demo` includes the 30-second HBO conference edit, its source/prerecorded labels and recorded real YOLO results. The Docker build copies `apps/web/public` so the video and annotation JSON ship with the site. Static nginx supports range requests for scrubbing. Source/timecode/model provenance is in `/demo/source.json`.

Fresh YOLO inference from a local file or webcam uses the optional [loopback preview server](../../apps/web/camera/README.md), connected through Vite on the laptop. The production image returns 503 for `/camera/*` until an authenticated inference service is deliberately deployed; it retains recorded detection playback. Camera access requires a click and HTTPS or localhost. This change does not deploy the model, send count signals or establish live transcription.

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

The OTLP and API access-log privacy changes passed native nginx 1.31.8 smoke
with production dist; the integrated voice+OTLP Docker targets must be rebuilt
and checked together before cluster rollout. Existing upstream voice Docker
evidence above does not cover this combined final image.

## Releasing both web images

Set `BACKSTAGE_RELEASE` to the published, reviewed full Git SHA pinned by the API
runtime. Set `BACKSTAGE_IMAGE_REGISTRY` to the registry/project the cluster can
pull (without a trailing slash). These are public image coordinates, not secrets.
From a checkout of that exact release:

```sh
test "$(git rev-parse HEAD)" = "$BACKSTAGE_RELEASE"
docker build -f deploy/web/Dockerfile --target runtime \
  -t "$BACKSTAGE_IMAGE_REGISTRY/backstage-web-runtime:$BACKSTAGE_RELEASE" .
docker build -f deploy/web/Dockerfile --target web \
  --build-arg VITE_SERVICE_VERSION="$BACKSTAGE_RELEASE" \
  --build-arg VITE_DEPLOYMENT_ENVIRONMENT=demo \
  -t "$BACKSTAGE_IMAGE_REGISTRY/backstage-web:$BACKSTAGE_RELEASE" .
docker push "$BACKSTAGE_IMAGE_REGISTRY/backstage-web-runtime:$BACKSTAGE_RELEASE"
docker push "$BACKSTAGE_IMAGE_REGISTRY/backstage-web:$BACKSTAGE_RELEASE"
```

Ali sets both overlay `images` entries before applying: name `backstage-web` to
`$BACKSTAGE_IMAGE_REGISTRY/backstage-web` with `newTag: $BACKSTAGE_RELEASE`, and
name `backstage-web-runtime` to `$BACKSTAGE_IMAGE_REGISTRY/backstage-web-runtime`
with the same `newTag`. The dollar expressions describe values to substitute,
not literal Kubernetes YAML. Registry pull credentials, if required, belong in
platform Secret configuration. Never put an OpenAI or Dash0 key in build args.

Preflight: collector and incident API Services exist; Dash0 Secret is provisioned;
API points to its published runtime; both images are pullable; optional server-only
`web-openai` enables voice. Rendering the owner base is `kubectl kustomize deploy/web`;
Ali renders his complete platform overlay after inserting both image mappings.
This handoff does not deploy either image or change the shared cluster.
