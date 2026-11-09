import { useEffect, useRef, useState } from "react";
import type { Incident, ProtocolEvent } from "../api/types";
import { deriveFloorBrief } from "../inbox/floorBrief";

function read(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

export function useFloorBrief(incidents: Incident[], eventsById: Record<string, ProtocolEvent[] | undefined>, identityId: string, refresh: () => Promise<void>, active = true) {
  const key = `backstage.brief.lastSeen.${identityId}`;
  const [cutoff, setCutoff] = useState(() => read(key));
  const ready = incidents.every((incident) => eventsById[incident.id] !== undefined);
  const hasDisplayed = useRef(false);
  useEffect(() => { if (active && ready) hasDisplayed.current = true; }, [active, ready]);
  useEffect(() => {
    let hiddenAt: number | null = null;
    const save = (time: number) => { try { localStorage.setItem(key, String(time)); } catch { /* Storage is optional. */ } };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        if (hasDisplayed.current) save(hiddenAt);
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= 60_000) {
          setCutoff(hiddenAt);
          void refresh();
        }
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenAt === null && hasDisplayed.current) save(Date.now());
    };
  }, [key, refresh]);
  return {
    lines: deriveFloorBrief(incidents, eventsById, cutoff),
    ready,
  };
}
