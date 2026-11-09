import type { Transport } from "../api/transport";

export type StageSignalKind = "audio_input_lost" | "audio_input_restored" | "caption_stale" | "caption_line";
export type Trigger = "device" | "manual";

export type StageSignalData =
  | { stage_id: string; trigger: Trigger }
  | { stage_id: string }
  | { stage_id: string; line_seq: number };

export interface StageSignal {
  schema_version: 1;
  signal_id: string;
  kind: StageSignalKind;
  source_id: string;
  room_id: string;
  session_id?: string;
  occurred_at: string;
  data: StageSignalData;
}

export interface StageIdentity {
  stageId: string;
  sourceId: string;
  roomId: string;
  sessionId?: string;
}

export const STAGE_B: StageIdentity = { stageId: "stage-b", sourceId: "stage-b", roomId: "room-b" };

/** RFC 3339 UTC with second precision and a trailing Z, e.g. 2026-11-09T19:00:00Z. */
export function utcTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Compact UTC run stamp, e.g. 20261109T190000Z. Keeps IDs unique across page reloads. */
export function runStamp(date: Date): string {
  return utcTimestamp(date).replace(/[-:]/g, "");
}

export type SignalInput =
  | { kind: "audio_input_lost" | "audio_input_restored"; trigger: Trigger }
  | { kind: "caption_stale" }
  | { kind: "caption_line"; lineSeq: number };

/**
 * Builds envelopes with IDs of the form `<source>-<kind>-<run>-<NN>`. Each call is one emission and gets a
 * new ID; a retry must resend the returned envelope unchanged.
 */
export function createSignalFactory(identity: StageIdentity, now: () => Date = () => new Date()) {
  const run = runStamp(now());
  let sequence = 0;
  return (input: SignalInput): StageSignal => {
    sequence += 1;
    const data: StageSignalData =
      input.kind === "caption_line"
        ? { stage_id: identity.stageId, line_seq: input.lineSeq }
        : input.kind === "caption_stale"
          ? { stage_id: identity.stageId }
          : { stage_id: identity.stageId, trigger: input.trigger };
    return {
      schema_version: 1,
      signal_id: `${identity.sourceId}-${input.kind}-${run}-${String(sequence).padStart(2, "0")}`,
      kind: input.kind,
      source_id: identity.sourceId,
      room_id: identity.roomId,
      ...(identity.sessionId ? { session_id: identity.sessionId } : {}),
      occurred_at: utcTimestamp(now()),
      data,
    };
  };
}

export type SendResult =
  | { ok: true; signal: StageSignal; incidentId: string | null; deduplicated: boolean }
  | { ok: false; signal: StageSignal; status: number; code: string; message: string };

export interface SenderOptions {
  transport: Transport;
  getToken: () => string;
  /** Extra attempts after a thrown network error, each with the identical envelope. */
  maxRetries?: number;
}

export function createSignalSender({ transport, getToken, maxRetries = 2 }: SenderOptions) {
  return async function send(signal: StageSignal): Promise<SendResult> {
    const token = getToken();
    if (!token) {
      return { ok: false, signal, status: 0, code: "no_token", message: "Enter the stage token before sending signals." };
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await transport({
          method: "POST",
          path: "/signals",
          headers: { Authorization: `Bearer ${token}` },
          body: signal,
        });
        if (response.status >= 200 && response.status < 300) {
          const accepted = (response.json ?? {}) as { incident_id?: string | null; deduplicated?: boolean };
          return {
            ok: true,
            signal,
            incidentId: accepted.incident_id ?? null,
            deduplicated: accepted.deduplicated === true,
          };
        }
        const error = (response.json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
        return {
          ok: false,
          signal,
          status: response.status,
          code: typeof error?.code === "string" ? error.code : `http_${response.status}`,
          message: typeof error?.message === "string" ? error.message : `Request failed with status ${response.status}.`,
        };
      } catch {
        if (attempt >= maxRetries) {
          return { ok: false, signal, status: 0, code: "network", message: "Could not reach the incident API." };
        }
      }
    }
  };
}
