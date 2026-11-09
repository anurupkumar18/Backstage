import { useCallback, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Incident, ProtocolEvent } from "../api/types";
import { STATE_LABEL } from "../ui/format";
import type { UiError } from "../ui/types";
import { usePolling } from "./usePolling";

export function sortIncidents(incidents: Incident[]): Incident[] {
  const rank = { high: 0, normal: 1 } as const;
  return [...incidents].sort(
    (a, b) => rank[a.priority] - rank[b.priority] || Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
}

function needsViewerAction(incident: Incident): boolean {
  return incident.allowed_actions.includes("approve") || incident.allowed_actions.includes("ack");
}

/** Announce only real changes between two board snapshots. */
export function describeChanges(previous: Map<string, Incident> | null, next: Incident[]): string[] {
  if (!previous) {
    return [`Board loaded. ${next.length} open ${next.length === 1 ? "incident" : "incidents"}.`];
  }
  const messages: string[] = [];
  for (const incident of next) {
    const before = previous.get(incident.id);
    const action = needsViewerAction(incident) ? " Your action is needed." : "";
    if (!before) {
      messages.push(`New ${incident.priority} priority incident: ${incident.summary}, ${STATE_LABEL[incident.state]}.${action}`);
    } else if (before.state !== incident.state) {
      messages.push(`${incident.summary} is now ${STATE_LABEL[incident.state]}.${action}`);
    }
  }
  const ids = new Set(next.map((incident) => incident.id));
  for (const [id, before] of previous) {
    if (!ids.has(id)) {
      messages.push(`${before.summary} is no longer on the board.`);
    }
  }
  return messages;
}

export interface UseBoardOptions {
  client: ApiClient;
  pollMs: number;
  announce: (message: string) => void;
}

export function useBoard({ client, pollMs, announce }: UseBoardOptions) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<UiError | null>(null);
  const [eventsById, setEventsById] = useState<Record<string, ProtocolEvent[] | undefined>>({});

  const snapshot = useRef<Map<string, Incident> | null>(null);
  const openTimelines = useRef(new Set<string>());
  const fetchedVersion = useRef(new Map<string, number>());
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);

  const loadEvents = useCallback(
    async (incident: Incident, signal?: AbortSignal) => {
      fetchedVersion.current.set(incident.id, incident.version);
      try {
        const result = await client.listEvents(incident.id, signal);
        if (signal?.aborted || fetchedVersion.current.get(incident.id) !== incident.version) return;
        if (result.ok) {
          setEventsById((current) => ({ ...current, [incident.id]: result.data.items }));
        } else {
          fetchedVersion.current.delete(incident.id);
          setEventsById((current) => ({ ...current, [incident.id]: undefined }));
        }
      } catch {
        if (fetchedVersion.current.get(incident.id) === incident.version) fetchedVersion.current.delete(incident.id);
      }
    },
    [client],
  );

  const merge = useCallback(
    (next: Incident[], signal?: AbortSignal) => {
      const sorted = sortIncidents(next);
      for (const message of describeChanges(snapshot.current, sorted)) {
        announce(message);
      }
      snapshot.current = new Map(sorted.map((incident) => [incident.id, incident]));
      setIncidents(sorted);
      for (const incident of sorted) {
        if (openTimelines.current.has(incident.id) && fetchedVersion.current.get(incident.id) !== incident.version) {
          void loadEvents(incident, signal);
        }
      }
    },
    [announce, loadEvents],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      requestSeq.current += 1;
      const mine = requestSeq.current;
      const result = await client.listIncidents(signal);
      if (mine < appliedSeq.current) {
        return;
      }
      appliedSeq.current = mine;
      if (result.ok) {
        setLoadError(null);
        merge(result.data.items, signal);
      } else {
        setLoadError({ code: result.code, message: result.message });
        if (result.status === 401 || result.status === 403 || result.status === 404) {
          snapshot.current = null;
          setIncidents([]);
          setEventsById({});
        }
      }
      setLoading(false);
    },
    [client, merge],
  );

  usePolling(refresh, pollMs);

  const applyIncident = useCallback(
    (incident: Incident) => {
      const current = snapshot.current ? [...snapshot.current.values()] : [];
      const without = current.filter((item) => item.id !== incident.id);
      merge([...without, incident]);
    },
    [merge],
  );

  const onTimelineOpen = useCallback(
    (incidentId: string) => {
      openTimelines.current.add(incidentId);
      const incident = snapshot.current?.get(incidentId);
      if (incident) {
        void loadEvents(incident);
      }
    },
    [loadEvents],
  );

  return { incidents, loading, loadError, eventsById, refresh, applyIncident, onTimelineOpen };
}
