import { useCallback, useState } from "react";
import type { ApiClient } from "../api/client";
import type { PublicStatus } from "../api/types";
import type { UiError } from "../ui/types";
import { usePolling } from "./usePolling";

export function useStatus(client: ApiClient, pollMs: number) {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const result = await client.getStatus(signal);
      if (result.ok) {
        setStatus(result.data);
        setError(null);
      } else {
        setError({ code: result.code, message: result.message });
      }
    },
    [client],
  );

  usePolling(refresh, pollMs);
  return { status, error };
}
