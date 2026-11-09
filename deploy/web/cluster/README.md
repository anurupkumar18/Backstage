# Hosted web and vision

This overlay upgrades only web, without restarting badge queues or replacing incident credentials. It adapts Ali’s stock-image bootstrap to build a pinned public Git commit and install CPU YOLO in a private loopback sidecar. Python dependencies are pinned; model bytes must match the recorded SHA256. Cold installs can take several minutes and repeat after a pod replacement; a prebuilt registry image is preferable after the demo.

Render from the repository root:

```sh
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/web/cluster > release.yaml
```

The explicit load restriction is needed to reuse the owner’s parent web.yaml without duplicating it. Inspect the rendered Deployment, set build-web CODE_SHA to a published commit containing the camera bootstrap, and apply Deployment/web only. Service/web already exists as ClusterIP. Do not apply the full platform overlay or copy local environment files into cluster Secrets.

The deployment stays at one replica with Recreate because presence is in memory. build-web copies the static site, Node runtime, camera source and optional vision nginx include. install-vision uses a shared virtualenv, installs CPU-only torch/torchvision, and fetches the official model with checksum verification. Vision binds only 127.0.0.1:8766 and has no Service port. The nginx auth_request checks GET /api/v1/status using the caller’s bearer; missing/invalid tokens fail401, producer tokens fail403. Tokens are stripped before inference. JPEG body size, rate, timeouts and concurrency are bounded; frames are memory-only. The browser must disclose remote frame processing before users select a file or camera.

Prerequisites: existing incident-api and otel-collector Services; optional web-openai.OPENAI_API_KEY enables voice server-side. Dash0 remains disabled until its Secret exists. Keep all existing generated role identities and Elastic checkpoints. HTTPS is needed for physical cameras and microphones.

The event already provides HTTPRoute/app for backstage.cnh.radarhq.io through Gateway gateway/cnh’s https listener. It currently targets Service/app, the welcome placeholder. Route traffic to Service/web:80 only after explicit approval for public exposure and a successful private smoke. It is Argo-tracked, so persist the backend change in the organizer-managed GitOps source or check for reconciliation. Do not create a LoadBalancer or NodePort: event quota denies both.

Verification: wait for web’s three containers ready, inspect init logs without secret values, and check health, video Range206 and120 annotations. Check invalid inference bearer401, producer403, valid human bearer200 with real boxes. Check private OpenAI/reset endpoints404. Mint a briefing with a legitimate scoped identity and confirm only allowed tools, without printing the ephemeral credential. Physical webcam/microphone and paid voice transport remain separate browser checks.

Rollback: restore the prior Deployment YAML/published source pin. For this session the previously healthy static release was395ed2bcc4358b56dde50589a45a7eec70ddd162, without vision init/sidecar/include. Reverting only CODE_SHA cannot remove the new init dependency; restore the whole Deployment or Kubernetes prior revision. Revert HTTPRoute/app’s backend to app:80 separately if routing was changed. Keep web-openai and incident Secrets untouched.
