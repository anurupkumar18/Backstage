import type { Incident, ProtocolEvent } from "../api/types";
import type { Identity } from "../ui/types";

export type InboxKind = "needs_you" | "watching" | "update" | "resolved";
export interface InboxItem {
  incident: Incident;
  kind: InboxKind;
  action: "approve" | "ack" | null;
  why: string;
}

/** Input must come from the current token's scoped API; the selected role grants no authority. */
export function deriveInbox(
  incidents: Incident[],
  eventsById: Record<string, ProtocolEvent[] | undefined>,
  identity: Pick<Identity, "tier">,
  lastSeen: number,
): InboxItem[] {
  if (identity.tier === 0) return [];
  return incidents.map((incident): InboxItem => {
    const action = incident.allowed_actions.includes("approve") && incident.plan && incident.state === "plan_proposed"
      ? "approve"
      : incident.allowed_actions.includes("ack") && incident.assignment && incident.state === "dispatched" ? "ack" : null;
    const changed = Date.parse(incident.updated_at) > lastSeen || (eventsById[incident.id] ?? []).some(
      (event) => event.incident_id === incident.id && event.state_from !== event.state_to && Date.parse(event.occurred_at) > lastSeen,
    );
    const kind: InboxKind = action ? "needs_you"
      : incident.state === "resolved" && incident.verification.status === "passed" ? "resolved"
      : changed ? "update" : "watching";
    const why = action === "approve" ? "The current plan needs your approval."
      : action === "ack" ? "This assignment is addressed to you."
      : identity.tier === 3 ? "You oversee this incident on the conference floor."
      : identity.tier === 1 ? "This incident is visible within your session scope."
      : incident.allowed_actions.includes("handoff") ? "You accepted this assignment."
      : "This incident is visible to your team.";
    return { incident, kind, action, why };
  }).sort((a, b) => Number(b.kind === "needs_you") - Number(a.kind === "needs_you")
    || Number(b.incident.priority === "high") - Number(a.incident.priority === "high")
    || Date.parse(b.incident.updated_at) - Date.parse(a.incident.updated_at)
    || a.incident.id.localeCompare(b.incident.id));
}
