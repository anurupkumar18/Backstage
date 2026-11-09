import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Transport } from "../api/transport";
import { CaptionHeartbeat, MicMonitor, type MicDeviceInfo, type MicState, type MicStream } from "./monitors";
import {
  createSignalFactory,
  createSignalSender,
  STAGE_B,
  type SendResult,
  type SignalInput,
  type StageIdentity,
  type StageSignal,
} from "./signals";

export const STAGE_TOKEN_KEY = "backstage.stageToken";

export const CAPTION_FIXTURE_LINES = [
  "Welcome back to Room B. We are starting the next session now.",
  "Our first speaker will cover venue operations at scale.",
  "Please hold questions until the end of the talk.",
  "Slides for this session will be posted after the event.",
];

function readToken(): string {
  try {
    return window.sessionStorage.getItem(STAGE_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(token: string): void {
  try {
    if (token) {
      window.sessionStorage.setItem(STAGE_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(STAGE_TOKEN_KEY);
    }
  } catch {
    return;
  }
}

const MIC_TEXT: Record<MicState, string> = {
  idle: "Microphone not started.",
  requesting: "Requesting microphone access.",
  listening: "Listening: microphone live.",
  lost: "Microphone lost. Waiting for the device to return.",
  error: "Microphone unavailable.",
};

export interface StageAppProps {
  transport: Transport;
  apiBaseUrl: string;
  getUserMedia?: (deviceId?: string) => Promise<MicStream>;
  enumerateDevices?: () => Promise<MicDeviceInfo[]>;
  devices?: EventTarget;
  identity?: StageIdentity;
  now?: () => Date;
  defaultTimeoutSeconds?: number;
}

function describe(result: SendResult): string {
  const { signal } = result;
  if (result.ok) {
    const incident = result.incidentId ? ` Incident ${result.incidentId}.` : " No incident yet.";
    const dedup = result.deduplicated ? " Deduplicated." : "";
    return `Last signal sent: ${signal.kind} (${signal.signal_id}) accepted.${incident}${dedup}`;
  }
  const status = result.status ? ` ${result.status}` : "";
  return `Signal failed: ${signal.kind} (${signal.signal_id})${status} ${result.code}. ${result.message}`;
}

export function StageApp({
  transport,
  apiBaseUrl,
  getUserMedia,
  enumerateDevices,
  devices,
  identity = STAGE_B,
  now,
  defaultTimeoutSeconds = 15,
}: StageAppProps) {
  const [token, setToken] = useState(readToken);
  const [draftToken, setDraftToken] = useState("");
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const [micState, setMicState] = useState<MicState>("idle");
  const [micDetail, setMicDetail] = useState<string | undefined>();
  const [lastResult, setLastResult] = useState<SendResult | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [rehearsal, setRehearsal] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(defaultTimeoutSeconds);
  const [captionRunning, setCaptionRunning] = useState(false);
  const [captionStale, setCaptionStale] = useState(false);
  const [lineSeq, setLineSeq] = useState(0);
  const [fixtureIndex, setFixtureIndex] = useState(-1);

  const makeSignal = useMemo(() => createSignalFactory(identity, now), [identity, now]);
  const send = useMemo(() => createSignalSender({ transport, getToken: () => tokenRef.current }), [transport]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const dispatch = useCallback(
    (signal: StageSignal) => {
      queue.current = queue.current.then(async () => {
        const result = await send(signal);
        setLastResult(result);
        setAnnouncement(describe(result));
      });
      return queue.current;
    },
    [send],
  );

  const emit = useCallback((input: SignalInput) => dispatch(makeSignal(input)), [dispatch, makeSignal]);

  const emitRef = useRef(emit);
  emitRef.current = emit;

  const micRef = useRef<MicMonitor | null>(null);
  useEffect(() => {
    if (!getUserMedia) {
      return undefined;
    }
    const monitor = new MicMonitor({
      getUserMedia,
      enumerateDevices,
      devices,
      onStateChange: (state, detail) => {
        setMicState(state);
        setMicDetail(detail);
      },
      onLost: () => {
        setAnnouncement("Microphone lost. Sending audio input lost.");
        void emitRef.current({ kind: "audio_input_lost", trigger: "device" });
      },
      onRestored: () => {
        setAnnouncement("Microphone restored. Sending audio input restored.");
        void emitRef.current({ kind: "audio_input_restored", trigger: "device" });
      },
    });
    micRef.current = monitor;
    return () => {
      monitor.dispose();
      micRef.current = null;
    };
  }, [getUserMedia, enumerateDevices, devices]);

  const captionRef = useRef<CaptionHeartbeat | null>(null);
  if (!captionRef.current) {
    captionRef.current = new CaptionHeartbeat({
      timeoutMs: defaultTimeoutSeconds * 1000,
      onLine: (seq) => {
        setLineSeq(seq);
        setCaptionStale(false);
        void emitRef.current({ kind: "caption_line", lineSeq: seq });
      },
      onStale: () => {
        setCaptionStale(true);
        setAnnouncement("Captions stale. Sending caption stale.");
        void emitRef.current({ kind: "caption_stale" });
      },
    });
  }
  useEffect(() => () => captionRef.current?.stop(), []);

  const saveToken = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draftToken.trim();
    writeToken(value);
    setToken(value);
    setDraftToken("");
    setAnnouncement(value ? "Stage token saved for this browser session." : "Stage token cleared.");
  };

  const clearToken = () => {
    writeToken("");
    setToken("");
    setAnnouncement("Stage token cleared.");
  };

  const toggleCaptions = () => {
    const heartbeat = captionRef.current;
    if (!heartbeat) {
      return;
    }
    if (heartbeat.isRunning) {
      heartbeat.stop();
      setCaptionRunning(false);
      setAnnouncement("Caption heartbeat monitor stopped.");
    } else {
      heartbeat.start();
      setCaptionRunning(true);
      setAnnouncement(`Caption heartbeat monitor started. Stale after ${timeoutSeconds} seconds without a line.`);
    }
  };

  const changeTimeout = (value: number) => {
    if (!Number.isFinite(value) || value < 1) {
      return;
    }
    setTimeoutSeconds(value);
    captionRef.current?.setTimeout(value * 1000);
  };

  const nextFixtureLine = () => {
    setFixtureIndex((index) => (index + 1) % CAPTION_FIXTURE_LINES.length);
    captionRef.current?.beat();
  };

  const micText = MIC_TEXT[micState] + (micDetail && micState !== "listening" ? ` (${micDetail})` : "");
  const captionText = !captionRunning
    ? "Caption heartbeat monitor off."
    : captionStale
      ? `Captions stale: no line within ${timeoutSeconds} seconds.`
      : `Captions live. Last line number ${lineSeq}.`;

  return (
    <main className="stage">
      <h1>Stage B signal producer</h1>
      <p>
        Room {identity.roomId}, stage {identity.stageId}. Signals post to <code>{apiBaseUrl}/signals</code>. Signals
        carry device state and caption line numbers only, never caption text.
      </p>

      <div role="status" aria-live="polite" className="stage-live">
        {announcement}
      </div>

      <section aria-labelledby="token-heading">
        <h2 id="token-heading">Stage token</h2>
        <p>{token ? "Stage token set for this browser session." : "No stage token set. Signals will not send."}</p>
        <form onSubmit={saveToken}>
          <label htmlFor="stage-token">Stage-scoped bearer token</label>
          <input
            id="stage-token"
            type="password"
            autoComplete="off"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
          />
          <button type="submit">Save token</button>
          <button type="button" onClick={clearToken} disabled={!token}>
            Clear token
          </button>
        </form>
      </section>

      <section aria-labelledby="mic-heading">
        <h2 id="mic-heading">Microphone</h2>
        <p data-testid="mic-status">{micText}</p>
        <button type="button" onClick={() => void micRef.current?.start()} disabled={!getUserMedia || micState === "requesting"}>
          Start microphone
        </button>
        <button type="button" onClick={() => void micRef.current?.reconnect()} disabled={!getUserMedia || micState === "requesting"}>
          Reconnect microphone
        </button>
        {!getUserMedia ? (
          <p>This browser exposes no microphone API here. Use HTTPS or localhost, or the manual fallback below.</p>
        ) : null}
      </section>

      <section aria-labelledby="manual-heading">
        <h2 id="manual-heading">Manual fallback</h2>
        <p>Use when the browser does not report the unplug. Signals are labelled trigger manual.</p>
        <button type="button" onClick={() => void emit({ kind: "audio_input_lost", trigger: "manual" })}>
          Report mic lost (manual trigger)
        </button>
        <button type="button" onClick={() => void emit({ kind: "audio_input_restored", trigger: "manual" })}>
          Report mic restored (manual trigger)
        </button>
      </section>

      <section aria-labelledby="caption-heading">
        <h2 id="caption-heading">Caption heartbeat</h2>
        <p data-testid="caption-status">{captionText}</p>
        <button type="button" onClick={toggleCaptions} aria-pressed={captionRunning}>
          {captionRunning ? "Stop caption monitor" : "Start caption monitor"}
        </button>
        <label htmlFor="caption-timeout">Stale timeout in seconds</label>
        <input
          id="caption-timeout"
          type="number"
          min={1}
          value={timeoutSeconds}
          onChange={(event) => changeTimeout(Number(event.target.value))}
        />
      </section>

      <section aria-labelledby="rehearsal-heading" className="stage-rehearsal">
        <h2 id="rehearsal-heading">Rehearsal mode</h2>
        <label>
          <input type="checkbox" checked={rehearsal} onChange={(event) => setRehearsal(event.target.checked)} />
          Enable rehearsal fixture controls
        </label>
        {rehearsal ? (
          <div>
            <p>
              <strong>Rehearsal fixture.</strong> These caption lines are canned text shown only on this page. Each line
              sends a caption line number to the API.
            </p>
            <button type="button" onClick={nextFixtureLine}>
              Show next fixture caption line
            </button>
            <figure aria-label="Caption fixture, rehearsal only" className="stage-fixture">
              <figcaption>Caption fixture (rehearsal only, not live captions)</figcaption>
              <p>{fixtureIndex >= 0 ? CAPTION_FIXTURE_LINES[fixtureIndex] : "No fixture line shown yet."}</p>
            </figure>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="signal-heading">
        <h2 id="signal-heading">Last signal</h2>
        <p data-testid="last-signal">{lastResult ? describe(lastResult) : "No signal sent yet."}</p>
        {lastResult && !lastResult.ok ? (
          <button type="button" onClick={() => void dispatch(lastResult.signal)}>
            Retry {lastResult.signal.signal_id}
          </button>
        ) : null}
      </section>
    </main>
  );
}
