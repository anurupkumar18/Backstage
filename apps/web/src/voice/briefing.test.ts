import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceBriefing } from "./briefing";

class Track extends EventTarget { enabled = true; stop = vi.fn(); }
class Channel extends EventTarget {
  readyState = "open";
  sent: { type: string; item?: { output: string } }[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
}
function setup() {
  const track = new Track();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const channel = new Channel();
  const peer = { addTrack: vi.fn(), createDataChannel: () => channel, createOffer: async () => ({ sdp: "offer" }), setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close: vi.fn() };
  const client = { getStatus: vi.fn(async () => ({ ok: true as const, data: { rooms: [], sessions: [] } })), listIncidents: vi.fn(async () => ({ ok: true as const, data: { items: [], next_cursor: null } })), listEvents: vi.fn() };
  const media = vi.fn(async () => stream);
  const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => String(url).startsWith("/")
    ? new Response(JSON.stringify({ value: "ek_test", allowed_tools: ["get_status", "list_incidents", "get_incident_events"] }), { status: 200 })
    : new Response("answer", { status: 200 }));
  const onError = vi.fn();
  const voice = new VoiceBriefing({ client, tier: 3, token: "local-test-organizer", audio: document.createElement("audio"), onState: vi.fn(), onError, fetch: fetchImpl, getUserMedia: media, createPeer: () => peer as unknown as RTCPeerConnection });
  return { voice, track, stream, channel, client, fetchImpl, media, onError };
}

afterEach(() => vi.restoreAllMocks());

describe("voice lifecycle", () => {
  it("keeps the microphone muted except while holding and stops tracks on close", async () => {
    const { voice, track, channel } = setup();
    try {
      await voice.connect();
      expect(track.enabled).toBe(false);
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      voice.hold();
      expect(track.enabled).toBe(true);
      now.mockReturnValue(2000);
      voice.release();
      expect(track.enabled).toBe(false);
      expect(channel.sent.map((item) => item.type)).toEqual(["input_audio_buffer.clear", "input_audio_buffer.commit", "response.create"]);
    } finally { voice.close(); }
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("does not request the microphone when the server has no voice session", async () => {
    const { voice, fetchImpl, media, onError } = setup();
    fetchImpl.mockResolvedValue(new Response("", { status: 503 }));
    await voice.connect();
    expect(media).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Voice is unavailable. Your floor brief still works.");
  });
  it("stops a late microphone grant after the user disconnected", async () => {
    const { voice, media, stream, track } = setup();
    let grant!: (stream: MediaStream) => void;
    media.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const connecting = voice.connect();
    await waitFor(() => expect(media).toHaveBeenCalledOnce());
    voice.close();
    grant(stream);
    await connecting;
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("batches read-only tool outputs into a single continuation", async () => {
    const { voice, channel, client } = setup();
    try {
      await voice.connect();
      channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "response.done", response: { status: "completed", output: [
        { type: "function_call", name: "get_status", arguments: "{}", call_id: "a" },
        { type: "function_call", name: "approve", arguments: "{}", call_id: "b" },
      ] } }) }));
      await waitFor(() => expect(channel.sent).toHaveLength(3));
      expect(client.getStatus).toHaveBeenCalledOnce();
      expect(channel.sent.filter((item) => item.type === "response.create")).toHaveLength(1);
      expect(channel.sent[1]?.item?.output).toContain("tool_not_allowed");
    } finally { voice.close(); }
  });
  it("does not commit a cancelled or accidental short hold", async () => {
    const { voice, track, channel } = setup();
    try {
      await voice.connect();
      voice.hold(); voice.release(true);
      expect(track.enabled).toBe(false);
      expect(channel.sent.some((item) => item.type === "input_audio_buffer.commit")).toBe(false);
    } finally { voice.close(); }
  });
});

it("blocks a hold during tool execution so only one continuation is created", async () => {
  const { voice, channel, client, track } = setup();
  let finish!: (value: { ok: true; data: { rooms: []; sessions: [] } }) => void;
  client.getStatus.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  try {
    await voice.connect();
    channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "response.done", response: { status: "completed", output: [
      { type: "function_call", name: "get_status", arguments: "{}", call_id: "a" },
    ] } }) }));
    await waitFor(() => expect(client.getStatus).toHaveBeenCalledOnce());
    voice.hold();
    expect(track.enabled).toBe(false);
    finish({ ok: true, data: { rooms: [], sessions: [] } });
    await waitFor(() => expect(channel.sent).toHaveLength(2));
    voice.release();
    expect(channel.sent.filter((item) => item.type === "response.create")).toHaveLength(1);
  } finally { voice.close(); }
});

it("uses the server-granted tool allowlist even when the selected role says organizer", async () => {
  const { voice, channel, fetchImpl, client } = setup();
  fetchImpl.mockImplementation(async (url) => String(url).startsWith("/")
    ? new Response(JSON.stringify({ value: "ek_test", allowed_tools: ["get_status"] }), { status: 200 })
    : new Response("answer", { status: 200 }));
  try {
    await voice.connect();
    channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "response.done", response: { status: "completed", output: [
      { type: "function_call", name: "list_incidents", arguments: "{}", call_id: "a" },
    ] } }) }));
    await waitFor(() => expect(channel.sent).toHaveLength(2));
    expect(client.listIncidents).not.toHaveBeenCalled();
    expect(channel.sent[0]?.item?.output).toContain("tool_not_allowed");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer local-test-organizer" });
  } finally { voice.close(); }
});
