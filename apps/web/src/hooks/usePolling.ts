import { useEffect } from "react";

/** Runs `task` now and again `intervalMs` after each run settles, so requests never overlap. */
export function usePolling(task: (signal: AbortSignal) => Promise<void>, intervalMs: number): void {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        await task(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        throw error;
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void tick(), intervalMs);
      }
    };
    void tick();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [task, intervalMs]);
}
