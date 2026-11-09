import { useCallback, useState } from "react";
import type { PresenceApi } from "../api/presence";
import type { PresenceCounts } from "../api/types";
import { usePolling } from "./usePolling";

export function usePresence(api: PresenceApi | null, pollMs: number): PresenceCounts | null {
  const [counts, setCounts] = useState<PresenceCounts | null>(null);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (!api) {
        return;
      }
      try {
        const next = await api.read(signal);
        if (next) {
          setCounts(next);
        }
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
      }
    },
    [api],
  );

  usePolling(refresh, pollMs);
  return counts;
}
