import signalSchema from "@contracts/signal.v1.schema.json";
import stageFixture from "@fixtures/stage_av.signals.jsonl?raw";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportRequest, TransportResponse } from "../api/transport";
import { CaptionHeartbeat, MicMonitor, type MicState, type MicStream, type MicTrack } from "./monitors";
import { CAPTION_FIXTURE_LINES, STAGE_TOKEN_KEY, StageApp } from "./StageApp";
import { createSignalFactory, createSignalSender, STAGE_B, utcTimestamp, type StageSignal } from "./signals";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateSignal = ajv.compile(signalSchema);

class FakeTrack extends EventTarget implements MicTrack {
  readyState = "live";
  stopped = false;
  constructor(
    private readonly deviceId = "usb-mic",
    private readonly groupId = "group-usb",
  ) {
    super();
  }
  getSettings() {
    return { deviceId: this.deviceId, groupId: this.groupId };
  }
  stop(): void {
    this.readyState = "ended";
    this.stopped = true;
  }
  unplug(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

function streamOf(track: MicTrack): MicStream {
  return { getAudioTracks: () => [track] };
}

const FIXED = new Date("2026-11-09T19:00:00.123Z");

function recordingTransport(responses: Array<TransportResponse | Error> = []) {
  const requests: TransportRequest[] = [];
  const transport = vi.fn(async (request: TransportRequest): Promise<TransportResponse> => {
    requests.push(request);
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next ?? { status: 202, json: { signal_id: (request.body as StageSignal).signal_id, incident_id: "inc-stage-av-room-b", deduplicated: false } };
  });
  return { transport, requests };
}

describe("stage signal envelopes", () => {
  it("validates every stage kind against signal.v1", () => {
    const make = createSignalFactory(STAGE_B, () => FIXED);
    const signals = [
      make({ kind: "audio_input_lost", trigger: "device" }),
      make({ kind: "audio_input_restored", trigger: "manual" }),
      make({ kind: "caption_stale" }),
      make({ kind: "caption_line", lineSeq: 7 }),
    ];
    for (const signal of signals) {
      expect(validateSignal(signal), JSON.stringify(validateSignal.errors)).toBe(true);
      expect(signal.occurred_at).toBe("2026-11-09T19:00:00Z");
      expect(signal.source_id).toBe("stage-b");
      expect(signal.room_id).toBe("room-b");
    }
    expect(signals.map((signal) => signal.signal_id)).toEqual([
      "stage-b-audio_input_lost-20261109T190000Z-01",
      "stage-b-audio_input_restored-20261109T190000Z-02",
      "stage-b-caption_stale-20261109T190000Z-03",
      "stage-b-caption_line-20261109T190000Z-04",
    ]);
  });

  it("keeps the canonical fixture valid", () => {
    const lines = stageFixture.trim().split("\n");
    for (const line of lines) {
      expect(validateSignal(JSON.parse(line))).toBe(true);
    }
  });

  it("formats UTC timestamps with a trailing Z", () => {
    expect(utcTimestamp(new Date("2026-11-09T12:00:05.999-07:00"))).toBe("2026-11-09T19:00:05Z");
  });

  it("does not collide with IDs from an earlier page load", () => {
    const first = createSignalFactory(STAGE_B, () => new Date("2026-11-09T19:00:00Z"))({ kind: "caption_stale" });
    const second = createSignalFactory(STAGE_B, () => new Date("2026-11-09T19:05:00Z"))({ kind: "caption_stale" });
    expect(first.signal_id).not.toBe(second.signal_id);
  });

  it("retries a network failure with the identical envelope", async () => {
    const { transport, requests } = recordingTransport([new TypeError("offline"), new TypeError("offline")]);
    const send = createSignalSender({ transport, getToken: () => "stage-token" });
    const signal = createSignalFactory(STAGE_B, () => FIXED)({ kind: "audio_input_lost", trigger: "device" });
    const result = await send(signal);
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(3);
    expect(new Set(requests.map((request) => JSON.stringify(request.body))).size).toBe(1);
    expect(requests[0]?.headers.Authorization).toBe("Bearer stage-token");
    expect(requests[0]?.path).toBe("/signals");
  });

  it("surfaces API errors and refuses to send without a token", async () => {
    const { transport } = recordingTransport([{ status: 403, json: { error: { code: "forbidden", message: "Stage scope only." } } }]);
    const signal = createSignalFactory(STAGE_B, () => FIXED)({ kind: "caption_stale" });
    const denied = await createSignalSender({ transport, getToken: () => "t" })(signal);
    expect(denied).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    const noToken = await createSignalSender({ transport, getToken: () => "" })(signal);
    expect(noToken).toMatchObject({ ok: false, code: "no_token" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("MicMonitor", () => {
  function setup(tracks: FakeTrack[]) {
    const devices = new EventTarget();
    const states: MicState[] = [];
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const queue = [...tracks];
    const getUserMedia = vi.fn(async () => {
      const track = queue.shift();
      if (!track) {
        throw new DOMException("No device", "NotFoundError");
      }
      return streamOf(track);
    });
    const monitor = new MicMonitor({ getUserMedia, devices, onStateChange: (state) => states.push(state), onLost, onRestored });
    return { monitor, devices, states, onLost, onRestored, getUserMedia };
  }

  it("reports loss once on track ended and restores on devicechange", async () => {
    const first = new FakeTrack();
    const second = new FakeTrack();
    const ctx = setup([first, second]);
    await ctx.monitor.start();
    expect(ctx.monitor.current).toBe("listening");

    first.unplug();
    first.dispatchEvent(new Event("ended"));
    expect(ctx.onLost).toHaveBeenCalledTimes(1);
    expect(ctx.monitor.current).toBe("lost");

    ctx.devices.dispatchEvent(new Event("devicechange"));
    await waitFor(() => expect(ctx.onRestored).toHaveBeenCalledTimes(1));
    expect(ctx.monitor.current).toBe("listening");
    expect(ctx.states).toEqual(["requesting", "listening", "lost", "requesting", "listening"]);
  });

  it("stays lost when the device has not come back", async () => {
    const first = new FakeTrack();
    const ctx = setup([first]);
    await ctx.monitor.start();
    first.unplug();
    ctx.devices.dispatchEvent(new Event("devicechange"));
    await waitFor(() => expect(ctx.getUserMedia).toHaveBeenCalledTimes(2));
    expect(ctx.monitor.current).toBe("lost");
    expect(ctx.onRestored).not.toHaveBeenCalled();
  });

  it("reports an error when permission is denied, without a loss signal", async () => {
    const ctx = setup([]);
    await ctx.monitor.start();
    expect(ctx.monitor.current).toBe("error");
    expect(ctx.onLost).not.toHaveBeenCalled();
  });

  it("stops the track on dispose without reporting a loss", async () => {
    const track = new FakeTrack();
    const ctx = setup([track]);
    await ctx.monitor.start();
    ctx.monitor.dispose();
    expect(track.stopped).toBe(true);
    expect(ctx.onLost).not.toHaveBeenCalled();
  });
});

describe("CaptionHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits one stale per gap and re-arms on the next line", () => {
    const onLine = vi.fn();
    const onStale = vi.fn();
    const heartbeat = new CaptionHeartbeat({ timeoutMs: 15_000, onLine, onStale });
    heartbeat.start();
    vi.advanceTimersByTime(14_999);
    expect(onStale).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onStale).toHaveBeenCalledTimes(1);

    expect(heartbeat.beat()).toBe(1);
    expect(onLine).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(10_000);
    heartbeat.beat();
    vi.advanceTimersByTime(10_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(onStale).toHaveBeenCalledTimes(2);
  });

  it("does not report stale while stopped", () => {
    const onStale = vi.fn();
    const heartbeat = new CaptionHeartbeat({ timeoutMs: 1_000, onLine: vi.fn(), onStale });
    heartbeat.start();
    heartbeat.stop();
    vi.advanceTimersByTime(5_000);
    expect(onStale).not.toHaveBeenCalled();
  });
});

describe("StageApp", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  function renderStage(responses?: Array<TransportResponse | Error>) {
    const { transport, requests } = recordingTransport(responses);
    const track = new FakeTrack();
    const devices = new EventTarget();
    const getUserMedia = vi.fn(async () => streamOf(track));
    render(<StageApp transport={transport} apiBaseUrl="/api/v1" getUserMedia={getUserMedia} devices={devices} now={() => FIXED} />);
    return { requests, track, user: userEvent.setup() };
  }

  async function saveToken(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Stage-scoped bearer token"), "stage-secret");
    await user.click(screen.getByRole("button", { name: "Save token" }));
  }

  it("keeps the token in sessionStorage and posts a device loss on track ended", async () => {
    const { requests, track, user } = renderStage();
    await saveToken(user);
    expect(window.sessionStorage.getItem(STAGE_TOKEN_KEY)).toBe("stage-secret");
    expect(screen.getByLabelText("Stage-scoped bearer token")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Start microphone" }));
    await waitFor(() => expect(screen.getByTestId("mic-status")).toHaveTextContent("Listening: microphone live."));

    act(() => track.unplug());
    await waitFor(() => expect(requests).toHaveLength(1));
    const body = requests[0]?.body as StageSignal;
    expect(body).toMatchObject({ kind: "audio_input_lost", data: { stage_id: "stage-b", trigger: "device" } });
    expect(validateSignal(body)).toBe(true);
    expect(requests[0]?.headers.Authorization).toBe("Bearer stage-secret");
    expect(screen.getByTestId("mic-status")).toHaveTextContent("Microphone lost.");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(`Last signal sent: audio_input_lost (${body.signal_id}) accepted.`),
    );
  });

  it("sends manual triggers from the keyboard", async () => {
    const { requests, user } = renderStage();
    await saveToken(user);
    screen.getByRole("button", { name: "Report mic lost (manual trigger)" }).focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("button", { name: "Report mic restored (manual trigger)" })).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => (request.body as StageSignal).kind)).toEqual(["audio_input_lost", "audio_input_restored"]);
    expect(requests.every((request) => validateSignal(request.body))).toBe(true);
    expect((requests[0]?.body as { data: { trigger: string } }).data.trigger).toBe("manual");
  });

  it("gates the caption fixture behind rehearsal mode and never sends caption text", async () => {
    const { requests, user } = renderStage();
    await saveToken(user);
    expect(screen.queryByRole("button", { name: "Show next fixture caption line" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Enable rehearsal fixture controls" }));
    await user.click(screen.getByRole("button", { name: "Show next fixture caption line" }));
    await user.click(screen.getByRole("button", { name: "Show next fixture caption line" }));

    expect(screen.getByText(CAPTION_FIXTURE_LINES[1] as string)).toBeInTheDocument();
    await waitFor(() => expect(requests).toHaveLength(2));
    const bodies = requests.map((request) => request.body as StageSignal);
    expect(bodies.map((body) => body.data)).toEqual([
      { stage_id: "stage-b", line_seq: 1 },
      { stage_id: "stage-b", line_seq: 2 },
    ]);
    const wire = JSON.stringify(requests);
    for (const line of CAPTION_FIXTURE_LINES) {
      expect(wire).not.toContain(line);
    }
  });

  it("retries a failed signal with the same signal_id", async () => {
    const { requests, user } = renderStage([{ status: 503, json: null }]);
    await saveToken(user);
    await user.click(screen.getByRole("button", { name: "Report mic lost (manual trigger)" }));
    await waitFor(() => expect(screen.getByTestId("last-signal")).toHaveTextContent("Signal failed"));
    const failedId = (requests[0]?.body as StageSignal).signal_id;
    await user.click(screen.getByRole("button", { name: `Retry ${failedId}` }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.body).toEqual(requests[0]?.body);
    await waitFor(() => expect(screen.getByTestId("last-signal")).toHaveTextContent("accepted"));
  });

  it("does not send without a token and says so", async () => {
    const { requests, user } = renderStage();
    expect(screen.getByText("No stage token set. Signals will not send.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Report mic lost (manual trigger)" }));
    await waitFor(() => expect(screen.getByTestId("last-signal")).toHaveTextContent("no_token"));
    expect(requests).toHaveLength(0);
  });
});
