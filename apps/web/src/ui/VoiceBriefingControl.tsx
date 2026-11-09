import { useEffect, useRef, useState } from "react";
import type { BriefingReadClient } from "../voice/briefingTools";
import { VoiceBriefing, type VoiceState } from "../voice/briefing";

export function VoiceBriefingControl({ client, tier, token, announce }: { token: string; client: BriefingReadClient; tier: number; announce(message: string): void }) {
  const [state, setState] = useState<VoiceState>("off");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const controller = useRef<VoiceBriefing | null>(null);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") controller.current?.close(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); controller.current?.close(); };
  }, [client, tier, token]);
  const connect = () => {
    if (!audio.current) return;
    controller.current?.close();
    setError("");
    const next = new VoiceBriefing({ client, tier, token, audio: audio.current,
      onState: (value) => { setState(value); announce(value === "listening" ? "Listening while you hold the button." : value === "ready" ? "Voice ready." : value === "off" ? "Voice disconnected." : value === "reading" ? "Checking floor data." : "Connecting or answering."); },
      onError: setError,
    });
    controller.current = next;
    void next.connect();
  };
  return <section className="inbox__voice" aria-label="Ask Backstage">
    <h2>Ask Backstage</h2>
    <p>Voice is read-only. Connecting uses OpenAI; audio is sent while you hold the button, along with scoped status and event metadata. Audio and transcripts are not saved by Backstage.</p>
    <audio ref={audio} autoPlay controls hidden={state === "off"} aria-label="Backstage voice response" />
    {state === "off" ? <button type="button" className="btn btn--quiet" onClick={connect}>Connect voice</button> : <>
      <button type="button" className="btn btn--primary" disabled={state === "connecting" || state === "reading"}
        aria-pressed={state === "listening"}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); controller.current?.hold(); }}
        onPointerUp={() => controller.current?.release()}
        onPointerCancel={() => controller.current?.release(true)}
        onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); controller.current?.hold(); } }}
        onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); controller.current?.release(); } }}
        onBlur={() => controller.current?.release(true)}>
        {state === "connecting" ? "Connecting…" : state === "reading" ? "Checking floor…" : state === "listening" ? "Release to ask" : "Hold to ask"}
      </button>
      <button type="button" className="btn btn--quiet" onClick={() => controller.current?.close()}>Disconnect voice</button>
    </>}
    {error ? <p role="alert" className="notice">{error}</p> : null}
  </section>;
}
