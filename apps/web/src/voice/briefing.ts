import type { BriefingReadClient } from "./briefingTools";
import { createBriefingTools } from "./briefingTools";

export type VoiceState = "off" | "connecting" | "ready" | "listening" | "answering";
interface Options {
  client: BriefingReadClient;
  tier: number;
  audio: HTMLAudioElement;
  onState(state: VoiceState): void;
  onError(message: string): void;
  fetch?: typeof fetch;
  getUserMedia?: () => Promise<MediaStream>;
  createPeer?: () => RTCPeerConnection;
}

/** No incident writes are reachable here. The microphone is muted except while hold() is active. */
export class VoiceBriefing {
  private readonly abort = new AbortController();
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private holding = false;
  private answering = false;
  private toolRounds = 0;
  private startedAt = 0;

  constructor(private readonly options: Options) {}

  async connect(): Promise<void> {
    const fetchImpl = this.options.fetch ?? fetch;
    this.options.onState("connecting");
    try {
      const tokenResponse = await fetchImpl("/openai/briefing/token", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: this.abort.signal,
      });
      if (!tokenResponse.ok) throw new Error("Voice is unavailable. Your floor brief still works.");
      const token = await tokenResponse.json() as { value?: string };
      if (!token.value?.startsWith("ek_")) throw new Error("Voice returned an invalid session. Use the floor brief.");
      if (this.abort.signal.aborted) return;
      const stream = await (this.options.getUserMedia ?? (() => navigator.mediaDevices.getUserMedia({ audio: true })))();
      for (const track of stream.getTracks()) track.enabled = false;
      if (this.abort.signal.aborted) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const peer = (this.options.createPeer ?? (() => new RTCPeerConnection()))();
      this.peer = peer;
      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
        track.addEventListener("ended", () => this.close());
      }
      peer.ontrack = (event) => { this.options.audio.srcObject = event.streams[0] ?? null; };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") this.close();
      };
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (event) => { void this.onMessage(event.data); });
      channel.addEventListener("close", () => this.close());
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetchImpl("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
        body: offer.sdp, signal: this.abort.signal,
      });
      if (!response.ok) throw new Error("Could not connect voice. Use the floor brief.");
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
      if (channel.readyState !== "open") {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timeout); channel.removeEventListener("open", opened); this.abort.signal.removeEventListener("abort", cancelled); };
          const opened = () => { cleanup(); resolve(); };
          const cancelled = () => { cleanup(); reject(new Error("Voice connection closed.")); };
          const timeout = setTimeout(() => { cleanup(); reject(new Error("Voice connection timed out. Use the floor brief.")); }, 10_000);
          channel.addEventListener("open", opened, { once: true });
          this.abort.signal.addEventListener("abort", cancelled, { once: true });
          if (this.abort.signal.aborted) cancelled();
        });
      }
      if (this.abort.signal.aborted) return;
      this.timer = setTimeout(() => this.close(), 120_000);
      this.options.onState("ready");
    } catch (error) {
      if (this.abort.signal.aborted) return;
      this.close();
      this.options.onError(error instanceof Error && /^(Voice|Could not connect voice)/.test(error.message)
        ? error.message : "Voice could not start. Check microphone permission or use the floor brief.");
    }
  }

  private send(event: object) {
    if (!this.abort.signal.aborted && this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  hold() {
    if (this.channel?.readyState !== "open" || this.abort.signal.aborted || this.holding) return;
    if (this.answering) {
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
      this.answering = false;
    }
    this.send({ type: "input_audio_buffer.clear" });
    this.stream?.getTracks().forEach((track) => { track.enabled = true; });
    this.holding = true;
    this.startedAt = Date.now();
    this.holdTimer = setTimeout(() => this.release(), 20_000);
    this.options.onState("listening");
  }

  release(cancel = false) {
    if (!this.holding) return;
    this.holding = false;
    clearTimeout(this.holdTimer);
    this.stream?.getTracks().forEach((track) => { track.enabled = false; });
    if (cancel || Date.now() - this.startedAt < 150) {
      this.send({ type: "input_audio_buffer.clear" });
      this.options.onState("ready");
      return;
    }
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
    this.answering = true;
    this.options.onState("answering");
  }

  private async onMessage(raw: unknown) {
    if (this.abort.signal.aborted || typeof raw !== "string") return;
    try {
      const event = JSON.parse(raw);
      if (event.type === "error") {
        this.close();
        this.options.onError("Voice could not complete the request. Use the floor brief or reconnect.");
      } else if (event.type === "response.created") {
        this.answering = true;
      } else if (event.type === "response.done") {
        this.answering = false;
        if (event.response?.status === "cancelled") return;
        if (event.response?.status !== "completed") throw new Error("response failed");
        const calls = (Array.isArray(event.response.output) ? event.response.output : []).filter((item: { type?: string }) => item.type === "function_call");
        if (calls.length) {
          if (++this.toolRounds > 12 || calls.length > 6) throw new Error("tool limit");
          const execute = createBriefingTools(this.options.client, this.options.tier);
          const outputs = await Promise.all(calls.map(async (call: { name: string; arguments: string; call_id: string }) => ({
            type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(await execute(call.name, call.arguments)) },
          })));
          for (const output of outputs) this.send(output);
          this.send({ type: "response.create" });
          this.answering = true;
        } else {
          this.options.onState("ready");
        }
      }
    } catch {
      if (this.abort.signal.aborted) return;
      this.close();
      this.options.onError("Voice could not complete the request. Use the floor brief or reconnect.");
    }
  }

  close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    clearTimeout(this.timer);
    clearTimeout(this.holdTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.channel?.close();
    this.peer?.close();
    this.options.audio.srcObject = null;
    this.options.onState("off");
  }
}
