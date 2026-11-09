import { useEffect, useRef, useState } from "react";
import { boxesAt, readDetections, zoneCounts, type ClipDetections, type PersonBox } from "./detections";
import "./video-demo.css";

type Mode = "demo" | "file" | "camera";
const DEMO = "/demo/conference-30s.mp4";

export function VideoDemo({ token = "" }: { token?: string }) {
  const [mode, setMode] = useState<Mode>("demo");
  const [source, setSource] = useState(DEMO);
  const [name, setName] = useState("Silicon Valley conference cut");
  const [recording, setRecording] = useState<ClipDetections | null>(null);
  const [boxes, setBoxes] = useState<PersonBox[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [divider, setDivider] = useState(0.65);
  const [elapsed, setElapsed] = useState(0);
  const [backend, setBackend] = useState("Checking detector…");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [pendingCamera, setPendingCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const blobUrl = useRef<string | null>(null);
  const active = useRef(true);
  const sourceEpoch = useRef(0);
  const cameraRequest = useRef(0);
  const isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

  useEffect(() => {
    active.current = true;
    const abort = new AbortController();
    fetch("/demo/conference-detections.json", { signal: abort.signal }).then((r) => { if (!r.ok) throw Error(); return r.json(); }).then(readDetections).then(setRecording).catch(() => { if (!abort.signal.aborted) setError("The clip’s YOLO recording could not load. Video playback still works."); });
    fetch("/camera/healthz", { signal: abort.signal }).then(async (r) => { if (!r.ok) throw Error(); const value = await r.json(); if (value.status !== "ready") throw Error(); return value; }).then((value) => setBackend(`${value.model} detector ready`)).catch(() => { if (!abort.signal.aborted) setBackend("Detector offline. The bundled YOLO recording still works."); });
    return () => {
      active.current = false;
      cameraRequest.current++;
      abort.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (mode === "camera") { element.srcObject = stream.current; void element.play().catch(() => setError("Press play to start the camera preview.")); }
    else element.srcObject = null;
  }, [mode, source]);

  // Only one JPEG/inference request is in flight. Source changes, pause and unmount invalidate it.
  useEffect(() => {
    if (mode === "demo" || !enabled || !playing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const canvas = document.createElement("canvas");
    const tick = async () => {
      const element = video.current;
      if (cancelled || !element || element.readyState < 2 || !element.videoWidth || document.visibilityState === "hidden") {
        if (!cancelled) timer = setTimeout(tick, 300);
        return;
      }
      const epoch = sourceEpoch.current;
      canvas.width = Math.min(640, element.videoWidth);
      canvas.height = Math.round(canvas.width * element.videoHeight / element.videoWidth);
      canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      if (cancelled || !jpeg) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      const capturedAt = element.currentTime;
      try {
        const response = await fetch("/camera/detect", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Backstage-Vision": "1", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: jpeg, signal: controller.signal });
        if (response.status === 429) {
          if (!cancelled) timer = setTimeout(tick, 750);
          return;
        }
        if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? "Enter a valid Backstage role token to use live detection." : "YOLO detector is unavailable. Retry or use the bundled recording.");
        const result = await response.json();
        const checked = readDetections({ model: result.model, sample_fps: 1, duration: 1, frames: [{ at: 0, boxes: result.boxes }] });
        if (!cancelled && epoch === sourceEpoch.current && Math.abs(element.currentTime - capturedAt) < 2) {
          setBoxes(checked.frames[0]?.boxes ?? []);
          setLatency(result.inference_ms);
          setBackend(`${result.model} processing frames`);
        }
      } catch (failure) {
        if (!cancelled) {
          setBoxes([]);
          setEnabled(false);
          setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Detector timed out. Retry YOLO or use the bundled recording.");
        }
      } finally { clearTimeout(timeout); }
      if (!cancelled) timer = setTimeout(tick, 250);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); controller?.abort(); };
  }, [mode, enabled, playing, source, token]);

  const resetSource = () => {
    cameraRequest.current++;
    sourceEpoch.current++;
    video.current?.pause();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
    setBoxes([]); setElapsed(0); setError(""); setLatency(null); setPlaying(false); setPendingCamera(false);
  };
  const startCamera = async () => {
    resetSource();
    const request = cameraRequest.current;
    setPendingCamera(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error("Camera access needs HTTPS or localhost.");
      const next = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false });
      if (!active.current || request !== cameraRequest.current) { next.getTracks().forEach((t) => t.stop()); return; }
      stream.current = next;
      setMode("camera"); setSource(""); setName("Live camera"); setEnabled(true);
    } catch { if (active.current && request === cameraRequest.current) setError("Camera could not start. Allow camera access or choose a local video."); }
    finally { if (active.current && request === cameraRequest.current) setPendingCamera(false); }
  };
  const stopCamera = () => { resetSource(); setMode("demo"); setSource(DEMO); setName("Silicon Valley conference cut"); setEnabled(true); setPendingCamera(false); };
  const shown = enabled ? mode === "demo" && recording ? boxesAt(recording, elapsed) : boxes : [];
  const counts = zoneCounts(shown, divider);
  const sampled = enabled && (mode === "demo" ? Boolean(recording) : latency !== null);
  const liveDemo = mode === "file" && source === DEMO;
  return <section className="video-demo" aria-labelledby="video-demo-title">
    <header className="video-demo__head">
      <div><h1 id="video-demo-title">Video &amp; vision</h1><p>See the conference floor through the person detector.</p></div>
      <a className="btn btn--quiet" href="#/board">Open incident board</a>
    </header>
    <div className="video-demo__layout">
      <section className="video-demo__viewer" aria-label="Video and person detections">
        <div className="video-demo__source"><span className="dot" data-tone={mode === "camera" ? "ok" : "info"} /><strong>{name}</strong><span>{mode === "camera" ? "Live camera" : mode === "demo" || liveDemo ? "Prerecorded · 30 seconds · loops" : "Local video"}</span></div>
        <div className="video-demo__picture">
          <video ref={video} src={mode === "camera" ? undefined : source} controls={mode !== "camera"} muted playsInline loop={loop && mode !== "camera"} preload="metadata"
            aria-label={name} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onTimeUpdate={() => setElapsed(video.current?.currentTime ?? 0)}
            onSeeking={() => { sourceEpoch.current++; setBoxes([]); setElapsed(video.current?.currentTime ?? 0); }}
            onError={() => setError("This video could not load. Choose another file or reload the demo clip.")} />
          {shown.length > 0 || enabled ? <svg className="video-demo__overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <line x1={divider * 1000} x2={divider * 1000} y1="0" y2="1000" className="video-demo__divider" />
            {shown.map(({ box }, i) => <rect key={i} x={box[0] * 1000} y={box[1] * 1000} width={(box[2] - box[0]) * 1000} height={(box[3] - box[1]) * 1000} />)}
          </svg> : null}
        </div>
        <div className="video-demo__transport">
          <button type="button" className="btn btn--primary" onClick={() => { if (playing) video.current?.pause(); else void video.current?.play().catch(() => setError("Video playback could not start.")); }}>{playing ? "Pause video" : "Play video"}</button>
          <button type="button" className="btn btn--quiet" aria-pressed={enabled} onClick={() => { setEnabled(!enabled); setError(""); }}>{enabled ? "Hide detections" : "Start YOLO"}</button>
          <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop video</label>
        </div>
        <p className="video-demo__caption">{mode === "demo" ? "HBO / Silicon Valley: TechCrunch Disrupt! · Repeated edited footage. Boxes come from actual YOLO inference, recorded at 4 samples/sec and synchronized to playback." : isLocal ? "YOLO processes sampled frames on the local preview server. Frames stay in memory; no recordings or face recognition." : "Sampled JPEG frames are sent to this deployment’s detector. Frames stay in memory; no recordings or face recognition."}</p>
        {error ? <p role="alert" className="notice">{error}</p> : null}
      </section>
      <aside className="video-demo__side" aria-label="Vision readout and sources">
        <section className="video-demo__readout"><h2>Person detections</h2><div className="video-demo__total"><strong>{sampled ? shown.length : "—"}</strong><span>{sampled ? `${shown.length === 1 ? "person" : "people"} in sampled frame` : enabled ? "waiting for a sample" : "detection paused"}</span></div><dl><div><dt>Floor left</dt><dd>{sampled ? counts.left : "—"}</dd></div><div><dt>Aisle right</dt><dd>{sampled ? counts.right : "—"}</dd></div><div><dt>Source</dt><dd>{mode === "demo" ? "Recorded YOLO results" : isLocal ? "Local inference" : "Cluster inference"}</dd></div><div><dt>Model</dt><dd>{mode === "demo" ? recording?.model ?? "Loading…" : "YOLO"}</dd></div>{latency !== null ? <div><dt>Inference</dt><dd>{latency} ms</dd></div> : null}</dl>
          <label className="video-demo__zone-label">Zone divider <input type="range" min="20" max="80" value={divider * 100} onChange={(e) => setDivider(Number(e.target.value) / 100)} /></label>
          <p>Preview counts only. This page does not send incident signals or bypass approval and recovery checks.</p>
        </section>
        <section className="video-demo__sources"><h2>Video source</h2><button type="button" className="btn btn--quiet" onClick={stopCamera}>Use conference demo</button>
          <button type="button" className="btn btn--primary" onClick={() => { resetSource(); setMode("file"); setSource(DEMO); setName("Silicon Valley conference cut"); setEnabled(true); }}>Run YOLO live</button>
          <label className="video-demo__upload">Choose a local video<input type="file" accept="video/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; resetSource(); const url = URL.createObjectURL(file); blobUrl.current = url; setMode("file"); setSource(url); setName(file.name); setEnabled(true); e.target.value = ""; }} /></label>
          {mode === "camera" || pendingCamera ? <button type="button" className="btn btn--quiet" onClick={stopCamera}>Stop camera</button> : <button type="button" className="btn btn--quiet" onClick={() => void startCamera()}>Use live camera</button>}
          <p>{backend}</p>{!isLocal ? <p>Live inference requires a Backstage role token. Sampled frames go to the cluster detector; the full source video stays in your browser.</p> : null}
        </section>
        <section className="video-demo__links"><h2>Continue the demo</h2><a href="#/me">Role inbox and voice briefing</a><a href="/stage.html">Stage microphone and caption monitor</a><a href="#/history">Saved incident history</a><a href="#/projector">Conference projector and check-in QR</a></section>
      </aside>
    </div>
  </section>;
}
