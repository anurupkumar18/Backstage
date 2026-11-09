import type { Incident, ProtocolEvent } from "../api/types";
import { inboxStatus, inboxTitle, inboxVerification } from "./copy";

/** One current-state sentence per changed incident. No actor ids, names or free-form event payloads. */
export function deriveFloorBrief(incidents: Incident[], eventsById: Record<string, ProtocolEvent[] | undefined>, lastSeen: number): string[] {
  return incidents.filter((incident) => (eventsById[incident.id] ?? []).some(
    (event) => event.incident_id === incident.id && Date.parse(event.occurred_at) > lastSeen,
  )).map((incident) => {
    const next = incident.allowed_actions.includes("approve") && incident.state === "plan_proposed" ? " Your approval is needed."
      : incident.allowed_actions.includes("ack") && incident.state === "dispatched" ? " Your assignment is waiting."
      : "";
    return `${inboxTitle(incident)}. ${inboxStatus(incident)}. ${inboxVerification(incident)}.${next}`;
  });
}
