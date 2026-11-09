import { useEffect, useId, useRef } from "react";
import { FloorBrief } from "./FloorBrief";
import { AgentActivity } from "./AgentActivity";
import type { AgentActivity as Activity } from "../inbox/agentActivity";
import type { Incident } from "../api/types";
import type { InboxItem } from "../inbox/deriveInbox";
import { inboxStatus, inboxTitle, inboxVerification } from "../inbox/copy";
import { formatAbsolute, priorityLabel } from "./format";
import type { ActionState, Identity, UiError } from "./types";
import "./inbox.css";

interface InboxViewProps {
  items: InboxItem[];
  activity?: Activity[];
  brief?: { lines: string[]; ready: boolean };
  identity: Identity;
  actionState: Record<string, ActionState | undefined>;
  onAction(incident: Incident, action: "approve" | "ack"): void;
  focusIncidentId: string | null;
  loadError: UiError | null;
  loading: boolean;
  onMarkSeen(): void;
}

export function InboxView({ items, identity, actionState, onAction, focusIncidentId, loadError, loading, onMarkSeen, activity, brief }: InboxViewProps) {
  const titleId = useId();
  const cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (focusIncidentId) cards.current.get(focusIncidentId)?.focus();
  }, [focusIncidentId]);
  const needsYou = items.filter((item) => item.kind === "needs_you").length;
  return (
    <section className="inbox" aria-labelledby={titleId}>
      <header className="inbox__head">
        <h1 id={titleId}>Your floor inbox</h1>
        <p>{identity.label}. {needsYou ? `${needsYou} ${needsYou === 1 ? "incident needs" : "incidents need"} you.` : "No actions waiting for you."}</p>
        {identity.tier === 1 ? <p>Your token shows only your session. Room overflow without a session will not appear here.</p> : null}
        <button type="button" className="btn btn--quiet" onClick={onMarkSeen}>Mark updates read</button>
      </header>
      {!loadError && !loading && brief ? <FloorBrief {...brief} /> : null}
      {activity ? <AgentActivity activity={activity} /> : null}
      {loadError ? <p role="alert" className="notice"><strong>Could not refresh your inbox.</strong> {loadError.message}</p> : null}
      {loading ? <p>Checking the floor…</p> : null}
      {!loading && !loadError && items.length === 0 ? <p>No incidents in your scope. Check room status for public updates.</p> : null}
      <ul className="inbox__items">
        {items.map(({ incident, kind, action, why }) => {
          const state = actionState[incident.id];
          const title = inboxTitle(incident);
          return (
            <li key={incident.id}>
              <article className="inbox__card" data-kind={kind} tabIndex={-1}
                ref={(node) => { if (node) cards.current.set(incident.id, node); else cards.current.delete(incident.id); }}
                aria-label={title}>
                <p className="inbox__kind">{kind === "needs_you" ? "Needs you" : kind === "resolved" ? "Verified recovery" : kind === "update" ? "New update" : "Watching"}</p>
                <h2>{title}</h2>
                <p>{priorityLabel(incident.priority)}. {inboxStatus(incident)}.</p>
                {incident.plan ? <p>{incident.plan.summary}</p> : <p>{incident.summary}</p>}
                <p className="inbox__why">Why you: {why}</p>
                <p className="inbox__verification">{inboxVerification(incident)}</p>
                {incident.verification.summary ? <p>{incident.verification.summary}</p> : null}
                <p className="inbox__time">Updated <time dateTime={incident.updated_at}>{formatAbsolute(incident.updated_at)}</time></p>
                {state?.error ? <p role="alert" className="notice">{state.error.message}</p> : null}
                {action ? <button type="button" className="btn btn--primary btn--wide" disabled={Boolean(state?.busy)}
                  aria-label={`${action === "approve" ? "Approve plan" : "Accept assignment"} for ${title}`}
                  onClick={() => onAction(incident, action)}>
                  {state?.busy ? "Sending…" : action === "approve" ? "Approve plan" : "Accept assignment"}
                </button> : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
