# Local vision preview

`#/demo` plays a bundled 30-second conference edit with real YOLO detection results synchronized to the media clock. It works on a static deployment. **Run YOLO live**, local-file playback and **Use live camera** use this optional loopback preview server for fresh inference.

## Run

Use Python 3.11+ in an isolated environment with `requirements.txt`. On the demo laptop, the existing camera virtualenv already has these packages. Supply existing trusted local YOLO weights; the preview never downloads models automatically.

```sh
# From the repository root, using a Python environment with the camera dependencies:
python apps/web/camera/vision.py --model /absolute/path/to/yolo26n.pt
```

The server listens only on `127.0.0.1:8766`. Vite forwards `/camera/*` to it; override the loopback target with `CAMERA_PROXY_TARGET` in the Vite process environment. Restart Vite after changing that environment. Click **Run YOLO live**, then **Play video**, or choose a local video and play it. **Use live camera** requests camera permission only after a click, with audio disabled. **Stop camera**, switching sources and leaving the route stop tracks. Late permission grants after cancellation are stopped as well.

One JPEG request is in flight per client, at most 640px wide; the server accepts at most 1 MB and one concurrent inference. JPEGs are decoded in memory and discarded. Responses contain normalized person boxes, confidence, model and elapsed inference time; no face recognition, tracking IDs, frame saving, whole-file upload, incident writes or OpenAI requests. Ultralytics sync is disabled. The local source file stays in the browser as a temporary object URL.

## Bundled recording

Source and edit provenance are in `public/demo/source.json`. The user selected HBO's Silicon Valley / TechCrunch Disrupt feature, authorized the cuts and requested a 30-second looping site demo. Three selected shots are repeated, original audio removed, and prerecorded/source credit burned in. `conference-detections.json` has 120 real YOLO samples at 4Hz, with 1–12 person detections per sampled frame. Model: yolo26n.pt, class 0, confidence 0.35, inference size 640. Detector model SHA-256: `9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef`.

Regenerate annotations from the exact bundled video:

```sh
python apps/web/camera/vision.py --model /absolute/path/to/yolo26n.pt \
  --video apps/web/public/demo/conference-30s.mp4 \
  --output apps/web/public/demo/conference-detections.json
```

Boxes follow the preceding sampled frame when seeking or looping. The zone divider changes only the preview's horizontal partition, with every detection counted in exactly one zone. These illustrative zones are not calibrated seating/door zones. Screen images can produce person detections, and occluded people can be missed; counts are not ground-truth occupancy.

## Deployment boundary

The web Docker image includes the clip and recorded results. Same-origin camera permission is enabled, but browsers still ask the user; a public camera preview requires HTTPS. The static image returns 503 for `/camera/*`. The optional `deploy/web/cluster` overlay adds a loopback-only detector and mounts authenticated nginx routes. It verifies the role bearer through the incident API’s status endpoint before accepting inference; producer identities are denied. Remote mode explicitly tells users that sampled frames go to the cluster, while the whole video stays in their browser. See the cluster deployment README for release and rollback instructions. No image frames are sent to the incident API, Elasticsearch or telemetry.

The separate edge service remains responsible for calibrated count signals and the 30-second overflow / 60-second recovery rules. No edge-owned files changed. The video hub also links to the board, role inbox/optional voice, saved History, projector QR and existing stage mic/caption-monitor page. Those links do not make the caption fixture a live transcription integration.

## Verification

```sh
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web
python -m unittest discover -s apps/web/camera -p 'test_*.py' -v
```

The demo-laptop HTTP and browser smoke used actual YOLO weights on the actual clip, including local-file selection and the bundled clip's live-inference mode. Physical webcam access remains unverified. A host deployment must keep this preview local or add authentication before exposing it.
