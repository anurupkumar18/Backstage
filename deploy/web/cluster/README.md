# Hosted web and vision

This overlay upgrades only web, without restarting badge queues or replacing incident credentials. It adapts Ali’s stock-image bootstrap to build a pinned public Git commit and install CPU YOLO in a private loopback sidecar. Python dependencies are pinned; model bytes must match the recorded SHA256. Cold installs can take several minutes and repeat after a pod replacement; a prebuilt registry image is preferable after the demo.

Render from the repository root:

```sh
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/web/cluster > release.yaml
```

The explicit load restriction is needed to reuse the owner’s parent web.yaml without duplicating it. Inspect the rendered Deployment, set build-web CODE_SHA to a published commit containing the camera bootstrap, and apply Deployment/web only. Service/web already exists as ClusterIP. Do not apply the full platform overlay or copy local environment files into cluster Secrets.

The deployment stays at one replica with Recreate because presence is in memory. build-web copies the static site, Node runtime, camera source and optional vision nginx include. install-vision uses a shared virtualenv, installs CPU-only torch/torchvision, and fetches the official model with checksum verification. Vision binds only 127.0.0.1:8766 and has no Service port. The nginx auth_request checks GET /api/v1/status using the caller’s bearer; missing/invalid tokens fail401, producer tokens fail403. Tokens are stripped before inference. JPEG body size, rate, timeouts and concurrency are bounded; frames are memory-only. The browser must disclose remote frame processing before users select a file or camera.

Prerequisites: existing incident-api and otel-collector Services; optional web-openai.OPENAI_API_KEY enables voice server-side. Dash0 remains disabled until its Secret exists. Keep all existing generated role identities and Elastic checkpoints. HTTPS is needed for physical cameras and microphones.

The event’s working HTTPRoute/app is on the host cluster and reaches Service/app on port80. Its selector now targets app.kubernetes.io/name=web. The user approved public access; Ali verified that editing the vcluster HTTPRoute has no effect and reverted it. Preserve the existing HTTPRoute, and use event-service-patch.yaml with kubectl patch if restoring the starter Service selector is necessary. Do not apply that selector patch as a standalone Service. Persist it in the organizer-managed GitOps source when available. LoadBalancer and NodePort are denied by event quota.

Verification: wait for web’s three containers ready, inspect init logs without secret values, and check health, video Range206 and120 annotations. Check invalid inference bearer401, producer403, valid human bearer200 with real boxes. Check private OpenAI/reset endpoints404. Mint a briefing with a legitimate scoped identity and confirm only allowed tools, without printing the ephemeral credential. Physical webcam/microphone and paid voice transport remain separate browser checks.

Rollback: restore the prior Deployment YAML/published source pin. For this session the previously healthy static release was395ed2bcc4358b56dde50589a45a7eec70ddd162, without vision init/sidecar/include. Reverting only CODE_SHA cannot remove the new init dependency; restore the whole Deployment or Kubernetes prior revision. If undoing public routing, restore the saved original Service/app selector; leave the host HTTPRoute untouched. Keep web-openai and incident Secrets untouched.


## Verified event runtime

The quota-safe web Pod has three ready containers, CPU limits250m/250m/1core and a1core dependency init. Source690fc6aaec0491bfb66ce9924e657ef15e2f6723 includes the provider-free inspector UI from main; build settings enable /otel, demo environment and the same source SHA as service.version. Collector uses250m CPU, its own Dash0 Secret, and the HTTPS CORS origin. See docs/demo/handoff-log.md for the actual smoke and provider readback evidence. Never reapply Ali’s older stock bootstrap over this overlay: it omits vision and keeps collector0.

The API runtime isf536b757, with a separate strict evidence alias backstage-demo-incident-evidence provisioned from the checksum-verified upstream bootstrap. Its live env enables projection and OTLP to http://otel-collector:4318. These API settings belong in Luke’s owned deployment overlay; record them for him rather than editing deploy/incident from this lane. The generated identity map, Elastic checkpoint and badge queue are preserved.
