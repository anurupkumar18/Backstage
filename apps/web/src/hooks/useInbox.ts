import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { deriveAgentActivity } from "../inbox/agentActivity";
import { deriveInbox } from "../inbox/deriveInbox";
import type { Identity } from "../ui/types";
import { useFloorBrief } from "./useFloorBrief";
import { useBoard } from "./useBoard";
import { useIncidentActions } from "./useIncidentActions";

function readLastSeen(key: string): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

export function useInbox(client: ApiClient, identity: Identity, announce: (message: string) => void) {
  const key = `backstage.inbox.lastSeen.${identity.id}`;
  const [lastSeen, setLastSeen] = useState(() => readLastSeen(key));
  const board = useBoard({ client, pollMs: 2000, announce });
  const actions = useIncidentActions({ client, applyIncident: board.applyIncident, refresh: board.refresh });
  const brief = useFloorBrief(board.incidents, board.eventsById, identity.id, board.refresh, !board.loading && !board.loadError);
  const opened = useRef(new Set<string>());

  useEffect(() => {
    for (const incident of board.incidents) {
      if (!opened.current.has(incident.id)) {
        opened.current.add(incident.id);
        board.onTimelineOpen(incident.id);
      }
    }
  }, [board.incidents, board.onTimelineOpen]);

  const markSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    try { window.localStorage.setItem(key, String(now)); } catch { /* Storage can be disabled. */ }
  };

  return {
    ...board, ...actions,
    items: deriveInbox(board.incidents, board.eventsById, identity, lastSeen),
    activity: deriveAgentActivity(board.incidents, board.eventsById),
    brief,
    markSeen,
  };
}
