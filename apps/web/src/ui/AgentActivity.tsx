import { useEffect, useState } from "react";
import type { AgentActivity as Activity } from "../inbox/agentActivity";
import { domainLabel, formatRelative } from "./format";
import "./agent-activity.css";

const VERB = { raise: "raised an incident", claim: "started triage", propose: "proposed a plan", approve: "recorded approval", dispatch: "sent an assignment", ack: "recorded acceptance", handoff: "routed a handoff", verify: "checked evidence", close: "recorded recovery", escalate: "escalated an incident" };

export function AgentActivity({ activity }: { activity: Activity[] }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <ul className="agent-activity" aria-label="Agents in your scope">
    {activity.map(({ domain, event }) => {
      const age = event ? now - Date.parse(event.occurred_at) : Infinity;
      return <li key={domain} className="agent-activity__item" data-domain={domain}>
        <span className="agent-activity__dot" aria-hidden="true" data-active={age >= 0 && age < 4000 ? "true" : undefined} />
        <p><strong>{domainLabel(domain)} agent</strong><span>{event ? `${VERB[event.type] ?? "updated an incident"} ${formatRelative(event.occurred_at, now)}` : "No activity received in your scope"}</span></p>
      </li>;
    })}
  </ul>;
}
