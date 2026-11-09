import { PRESENCE_TIERS, type PresenceCounts, type PresenceTier } from "./types";

export interface JoinResult {
  ok: boolean;
  message: string;
}

export interface PresenceApi {
  read(signal?: AbortSignal): Promise<PresenceCounts | null>;
  join(tier: PresenceTier): Promise<JoinResult>;
}

const DEVICE_KEY = "backstage.deviceId";

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Opaque per-browser id so rescanning the QR moves your dot instead of adding another. Never a name. */
export function getDeviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_KEY);
    if (stored) {
      return stored;
    }
    const created = randomId();
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}

function readCounts(value: unknown): PresenceCounts | null {
  const counts = (value as { counts?: Record<string, unknown> } | null)?.counts;
  if (!counts || !PRESENCE_TIERS.every((tier) => typeof counts[tier] === "number")) {
    return null;
  }
  return counts as unknown as PresenceCounts;
}

export function createHttpPresenceApi(baseUrl = "/presence"): PresenceApi {
  return {
    async read(signal) {
      const response = await fetch(baseUrl, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        return null;
      }
      return readCounts(await response.json());
    },
    async join(tier) {
      try {
        const response = await fetch(`${baseUrl}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: getDeviceId(), tier }),
        });
        if (response.ok) {
          return { ok: true, message: "You are on the floor." };
        }
        const message = ((await response.json()) as { error?: { message?: string } }).error?.message;
        return { ok: false, message: message ?? "Could not join. Try again." };
      } catch {
        return { ok: false, message: "Could not reach the floor. Check your connection and try again." };
      }
    },
  };
}
