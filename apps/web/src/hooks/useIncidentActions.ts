import { useCallback, useRef, useState } from "react";
import { newIntent, sameBody, type ActionIntent, type ApiClient } from "../api/client";
import type { Action, Incident } from "../api/types";
import type { ActionState } from "../ui/types";

type UiAction = "approve" | "ack";

export function buildAction(incident: Incident, action: UiAction): Action | null {
  if (action === "approve") {
    return incident.plan
      ? { action: "approve", expected_version: incident.version, payload: { plan_id: incident.plan.id } }
      : null;
  }
  return incident.assignment
    ? {
        action: "ack",
        expected_version: incident.version,
        payload: { assignment_id: incident.assignment.id, decision: "accepted" },
      }
    : null;
}

export interface UseIncidentActionsOptions {
  client: ApiClient;
  applyIncident: (incident: Incident) => void;
  refresh: () => Promise<void>;
}

export function useIncidentActions({ client, applyIncident, refresh }: UseIncidentActionsOptions) {
  const [actionState, setActionState] = useState<Record<string, ActionState | undefined>>({});
  const [focusIncidentId, setFocusIncidentId] = useState<string | null>(null);
  const intents = useRef(new Map<string, ActionIntent>());

  const run = useCallback(
    async (incident: Incident, action: UiAction) => {
      const body = buildAction(incident, action);
      if (!body) {
        setActionState((current) => ({
          ...current,
          [incident.id]: { busy: null, error: { code: "invalid_payload", message: "This incident has nothing to act on yet." } },
        }));
        return;
      }
      const slot = `${incident.id}:${action}`;
      const existing = intents.current.get(slot);
      const intent = existing && sameBody(existing.body, body) ? existing : newIntent(incident.id, body);
      intents.current.set(slot, intent);

      setFocusIncidentId(null);
      setActionState((current) => ({ ...current, [incident.id]: { busy: action, error: null } }));
      const result = await client.applyAction(intent);

      if (result.ok) {
        intents.current.delete(slot);
        setActionState((current) => ({ ...current, [incident.id]: { busy: null, error: null } }));
        applyIncident(result.data);
        setFocusIncidentId(incident.id);
        return;
      }

      if (result.code === "network") {
        setActionState((current) => ({
          ...current,
          [incident.id]: {
            busy: null,
            error: { code: result.code, message: `${result.message} Pressing the button again retries the same request.` },
          },
        }));
        return;
      }

      intents.current.delete(slot);
      const message =
        result.code === "stale_version"
          ? "This incident changed while you were deciding. The board has been refreshed. Review it, then act again."
          : result.message;
      setActionState((current) => ({
        ...current,
        [incident.id]: { busy: null, error: { code: result.code, message } },
      }));
      if (result.code === "stale_version" || result.code === "invalid_transition") {
        await refresh();
      }
    },
    [client, applyIncident, refresh],
  );

  return { actionState, focusIncidentId, run };
}
