import type { Domain, Incident, ProtocolEvent } from "../api/types";

export interface AgentActivity {
  domain: Domain;
  event: ProtocolEvent | null;
}
const DOMAIN = { overflow: "venue", stage_av: "av", badge_stall: "it", reported_problem: null } as const;
const DOMAINS = ["venue", "av", "it"] as const;

/** Derive only from current-scope incidents and their fetched events; never from actor names or payload text. */
export function deriveAgentActivity(incidents: Incident[], eventsById: Record<string, ProtocolEvent[] | undefined>): AgentActivity[] {
  const latest = new Map<Domain, ProtocolEvent>();
  for (const incident of incidents) {
    const domain = DOMAIN[incident.type] ?? incident.assignment?.domain;
    if (!domain) continue;
    for (const event of eventsById[incident.id] ?? []) {
      if (event.incident_id !== incident.id || event.actor.kind !== "agent" || !Number.isFinite(Date.parse(event.occurred_at))) continue;
      const previous = latest.get(domain);
      if (!previous || Date.parse(event.occurred_at) > Date.parse(previous.occurred_at)
        || (event.incident_id === previous.incident_id && event.sequence > previous.sequence)) latest.set(domain, event);
    }
  }
  return DOMAINS.map((domain) => ({ domain, event: latest.get(domain) ?? null }));
}
