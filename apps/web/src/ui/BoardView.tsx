import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Incident, PresenceCounts, ProtocolEvent } from "../api/types";
import { deriveAgentActivity } from "../inbox/agentActivity";
import { PresenceField } from "./PresenceField";
import {
  PHASES,
  domainLabel,
  eventLabel,
  formatAbsolute,
  formatRelative,
  needsAction,
  phaseIndex,
  priorityLabel,
  roomLabel,
  stateHint,
  stateLabel,
  toneFor,
  typeLabel,
  verificationTitle,
} from "./format";
import type { ActionState, UiError } from "./types";

export interface BoardViewProps {
  incidents: Incident[];
  eventsById: Record<string, ProtocolEvent[] | undefined>;
  actionState: Record<string, ActionState | undefined>;
  onAction(incident: Incident, action: "approve" | "ack"): void;
  /** Called when an incident becomes the selected one and whenever its version changes, so the feed stays fresh. */
  onTimelineOpen(incidentId: string): void;
  focusIncidentId: string | null;
  loadError: UiError | null;
  loading: boolean;
  presence?: PresenceCounts | null;
  /**
   * Free-text command from the bottom bar ("Ask BACKSTAGE, or report a problem"). When absent, the bar finds an
   * incident by id, room, type or state and selects it, which needs no backend.
   */
  onCommand?: (text: string) => void;
  renderEvidence?: (incident: Incident) => ReactNode;
}

export function BoardView({
  incidents,
  eventsById,
  actionState,
  onAction,
  onTimelineOpen,
  focusIncidentId,
  loadError,
  loading,
  presence,
  onCommand,
  renderEvidence,
}: BoardViewProps) {
  const titleId = useId();
  const listId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpId, setJumpId] = useState<{ id: string } | null>(null);

  const fallback = incidents.find(needsAction) ?? incidents[0];
  const selected = incidents.find((incident) => incident.id === selectedId) ?? fallback;
  const waiting = incidents.filter(needsAction).length;

  useEffect(() => {
    if (selectedId === null && fallback) setSelectedId(fallback.id);
  }, [selectedId, fallback]);

  useEffect(() => {
    if (focusIncidentId) setSelectedId(focusIncidentId);
  }, [focusIncidentId]);

  const selectedKey = selected?.id;
  const selectedVersion = selected?.version;
  useEffect(() => {
    if (selectedKey !== undefined) onTimelineOpen(selectedKey);
    // The handler identity is deliberately not a dependency: refetch only when the incident or version changes.
  }, [selectedKey, selectedVersion]);

  const find = (query: string): Incident | undefined => {
    const needle = query.trim().toLowerCase();
    if (!needle) return undefined;
    return incidents.find((incident) =>
      [incident.id, incident.summary, roomLabel(incident.room_id), incident.room_id, typeLabel(incident.type), stateLabel(incident.state)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  };

  return (
    <section className="board" aria-labelledby={titleId}>
      <h1 id={titleId} className="board__title">
        Incident board
      </h1>


      {loadError ? (
        <p role="alert" className="notice notice--error">
          <strong>Could not load incidents.</strong> {loadError.message}
        </p>
      ) : null}

      {loading && incidents.length === 0 && !loadError ? <p className="board__empty">Loading incidents...</p> : null}
      {!loading && !loadError && incidents.length === 0 ? (
        <p className="board__empty">All clear. No open incidents.</p>
      ) : null}

      {incidents.length > 0 && selected ? (
        <div className="console">
          <section className="console__list" aria-labelledby={listId}>
            <h2 id={listId} className="console__label">
              Open incidents
            </h2>
            <p className="board__summary">
              <strong>
                {incidents.length} open, {waiting === 0 ? "none need" : `${waiting} ${waiting === 1 ? "needs" : "need"}`} your action.
              </strong>
            </p>
            <ul className="console__cards">
              {incidents.map((incident) => (
                <li key={incident.id}>
                  <IncidentCard
                    incident={incident}
                    state={actionState[incident.id]}
                    selected={incident.id === selected.id}
                    focusIncidentId={focusIncidentId}
                    jump={jumpId}
                    onSelect={setSelectedId}
                  />
                </li>
              ))}
            </ul>
          </section>
          <Detail incident={selected} events={eventsById[selected.id]} state={actionState[selected.id]} onAction={onAction} evidence={renderEvidence?.(selected)} />
        </div>
      ) : null}

      {presence ? <PresenceField counts={presence} variant="compact" agentActivity={deriveAgentActivity(incidents, eventsById)} /> : null}

      <CommandBar
        onCommand={onCommand}
        onFind={(query) => {
          const match = find(query);
          if (match) {
            setSelectedId(match.id);
            setJumpId({ id: match.id });
          }
          return match;
        }}
      />
    </section>
  );
}

interface CommandBarProps {
  onCommand?: (text: string) => void;
  onFind(query: string): Incident | undefined;
}

function CommandBar({ onCommand, onFind }: CommandBarProps) {
  const inputId = useId();
  const [hidden, setHidden] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "miss"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);

  useEffect(() => {
    if (!toggled.current) return;
    if (hidden) showRef.current?.focus();
    else inputRef.current?.focus();
  }, [hidden]);

  const toggle = (next: boolean) => {
    toggled.current = true;
    setHidden(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (onCommand) {
      onCommand(value);
      setText("");
      setMessage({ kind: "ok", text: `Sent: ${value}` });
      return;
    }
    const match = onFind(value);
    setMessage(
      match
        ? { kind: "ok", text: `Showing ${match.summary}.` }
        : { kind: "miss", text: `No open incident matches "${value}".` },
    );
  };

  const label = onCommand ? "Ask BACKSTAGE or report a problem" : "Find an incident by room, type, state or id";

  return (
    <div className="command">
      <div className="command__wrap" data-hidden={hidden ? "true" : undefined} inert={hidden} aria-hidden={hidden ? true : undefined}>
        <form className="command__bar" role="search" aria-label="Command bar" onSubmit={submit}>
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="command__input"
            type="text"
            autoComplete="off"
            placeholder={onCommand ? "Ask BACKSTAGE, or report a problem" : "Find by room, type or incident ID"}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setMessage(null);
            }}
          />
          <button type="submit" className="command__go">
            {onCommand ? "Send" : "Find"}
          </button>
          <button type="button" className="command__away" aria-label="Hide incident search" onClick={() => toggle(true)}>
            Hide search
          </button>
        </form>
        {message ? (
          <p className="command__message" role={message.kind === "miss" ? "alert" : undefined}>
            {message.text}
          </p>
        ) : null}
      </div>
      {hidden ? (
        <div className="command__return">
          <button ref={showRef} type="button" className="btn btn--primary" onClick={() => toggle(false)}>
            Show search
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StateWord({ incident }: { incident: Incident }) {
  return (
    <span className="state-word">
      <span className="dot" data-tone={toneFor(incident)} aria-hidden="true" />
      {stateLabel(incident.state)}
    </span>
  );
}

function StepBar({ incident, label }: { incident: Incident; label: string }) {
  const index = phaseIndex(incident.state);
  const escalated = incident.state === "escalated";
  return (
    <ol className="steps" aria-label={label} data-tone={toneFor(incident)}>
      {PHASES.map((name, i) => {
        const status = escalated ? "flag" : i < index ? "done" : i === index ? "current" : "todo";
        return (
          <li key={name} className="steps__item" data-status={status} aria-current={status === "current" ? "step" : undefined}>
            <span className="steps__bar" aria-hidden="true" />
            <span className="steps__name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

function EscalatedFlag() {
  return (
    <p className="flag">
      <span className="flag__mark" aria-hidden="true">
        !
      </span>
      Flagged: escalated to a person
    </p>
  );
}

interface IncidentCardProps {
  incident: Incident;
  state: ActionState | undefined;
  selected: boolean;
  focusIncidentId: string | null;
  jump: { id: string } | null;
  onSelect(id: string): void;
}

function IncidentCard({ incident, state, selected, focusIncidentId, jump, onSelect }: IncidentCardProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const showVerification = incident.state === "verifying" || incident.state === "resolved" || incident.verification.status !== "pending";

  useEffect(() => {
    if (focusIncidentId === incident.id) ref.current?.focus();
  }, [focusIncidentId, incident.id]);

  useEffect(() => {
    if (jump?.id === incident.id) ref.current?.focus();
  }, [jump, incident.id]);

  return (
    <article
      ref={ref}
      tabIndex={-1}
      className="card"
      data-incident-id={incident.id}
      data-state={incident.state}
      data-selected={selected ? "true" : undefined}
      aria-labelledby={titleId}
    >
      <div className="card__top">
        <span className="mono card__id">{incident.id}</span>
        <StateWord incident={incident} />
      </div>
      <h3 id={titleId} className="card__title">
        <button type="button" className="card__select" aria-current={selected ? "true" : undefined} onClick={() => onSelect(incident.id)}>
          {incident.summary}
        </button>
      </h3>
      <p className="card__meta">
        {typeLabel(incident.type)} in {roomLabel(incident.room_id)}. {priorityLabel(incident.priority)}.
      </p>
      {showVerification ? (
        <p className="card__verify" data-verification={incident.state === "resolved" ? "passed" : incident.verification.status}>
          {verificationTitle(incident)}
        </p>
      ) : null}
      {incident.state === "escalated" ? <EscalatedFlag /> : null}
      <StepBar incident={incident} label={`Progress for ${incident.summary}`} />
      {!selected && state?.error ? (
        <p role="alert" className="notice notice--error">
          <strong>Action not applied.</strong> {state.error.message}
        </p>
      ) : null}
    </article>
  );
}

interface DetailProps {
  evidence?: ReactNode;
  incident: Incident;
  events: ProtocolEvent[] | undefined;
  state: ActionState | undefined;
  onAction(incident: Incident, action: "approve" | "ack"): void;
}

function Detail({ incident, events, state, onAction, evidence }: DetailProps) {
  const titleId = useId();
  const planId = useId();
  const progressId = useId();
  const feedId = useId();
  const busy = state?.busy ?? null;
  const canApprove = incident.allowed_actions.includes("approve");
  const canAck = incident.allowed_actions.includes("ack");
  const canHandoff = incident.allowed_actions.includes("handoff");
  const attention = needsAction(incident);

  return (
    <section className="detail" aria-labelledby={titleId} data-detail-for={incident.id}>
      <header className="detail__head">
        <div className="detail__heading">
          <p className="detail__id mono">
            {incident.id}
            {incident.trace_id ? (
              <>
                {" "}
                <span className="detail__trace">
                  trace <code title={incident.trace_id}>{incident.trace_id.slice(0, 8)}</code>
                </span>
              </>
            ) : null}
          </p>
          <h2 id={titleId} className="detail__title">
            {incident.summary}
          </h2>
          <p className="detail__room">
            {typeLabel(incident.type)} in {roomLabel(incident.room_id)}. {priorityLabel(incident.priority)}.
          </p>
        </div>
        <p className="chip">
          <span className="dot" data-tone={toneFor(incident)} aria-hidden="true" />
          {stateLabel(incident.state)}
        </p>
      </header>

      {incident.state === "escalated" ? <EscalatedFlag /> : null}

      <p className="detail__hint" data-attention={attention ? "true" : undefined}>
        {attention ? <strong>Needs you: </strong> : null}
        {stateHint(incident)}
      </p>

      <div className="detail__grid">
        <section className="panel" aria-labelledby={planId}>
          <div className="panel__head">
            <AgentMark className="blob" />
            <div>
              <h3 id={planId} className="panel__title">
                Proposed plan
              </h3>
              <p className="panel__sub">Review the plan before dispatch</p>
            </div>
          </div>
          <p className="panel__body">{incident.plan ? incident.plan.summary : "No plan yet."}</p>
          <p className="panel__sub">Closes only after verification passes.</p>

          <div className="panel__actions">
            {canApprove ? (
              <button
                type="button"
                className="btn btn--primary btn--wide"
                disabled={busy !== null}
                aria-busy={busy === "approve" ? true : undefined}
                onClick={() => onAction(incident, "approve")}
              >
                {busy === "approve" ? "Approving plan" : "Approve plan"} <span className="sr-only">for {incident.summary}</span>
              </button>
            ) : null}
            {canAck ? (
              <button
                type="button"
                className="btn btn--primary btn--wide"
                disabled={busy !== null}
                aria-busy={busy === "ack" ? true : undefined}
                onClick={() => onAction(incident, "ack")}
              >
                {busy === "ack" ? "Acknowledging assignment" : "Acknowledge assignment"}{" "}
                <span className="sr-only">for {incident.summary}</span>
              </button>
            ) : null}
            {canHandoff ? <p className="panel__sub">Handoff available</p> : null}
            {!canApprove && incident.state === "plan_proposed" ? (
              <p className="panel__note">Only organizers can approve plans. Switch to Organizer to approve.</p>
            ) : null}
            {state?.error ? (
              <p role="alert" className="notice notice--error">
                <strong>Action not applied.</strong> {state.error.message}
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby={progressId}>
          <h3 id={progressId} className="panel__title">
            Progress
          </h3>
          <StepBar incident={incident} label="Incident progress" />
          <dl className="facts">
            <div className="facts__row">
              <dt>Assignment</dt>
              <dd>
                {incident.assignment ? (
                  <>
                    {incident.assignment.assignee_id}
                    <span className="facts__sub">{domainLabel(incident.assignment.domain)} team</span>
                  </>
                ) : (
                  "Not assigned yet."
                )}
              </dd>
            </div>
            <VerificationRow incident={incident} />
            <div className="facts__row">
              <dt>Updated</dt>
              <dd>
                <time dateTime={incident.updated_at}>{formatAbsolute(incident.updated_at)}</time>
                <span className="facts__sub">{formatRelative(incident.updated_at)}</span>
              </dd>
            </div>
            <div className="facts__row">
              <dt>Version</dt>
              <dd className="mono">{incident.version}</dd>
            </div>
          </dl>
        </section>
      </div>

      {evidence ?? <section className="panel" aria-labelledby={feedId}>
        <h3 id={feedId} className="panel__title">
          Agent protocol
        </h3>
        <Feed events={events} />
      </section>}
    </section>
  );
}

function VerificationRow({ incident }: { incident: Incident }) {
  const { verification, state } = incident;
  return (
    <div
      className="facts__row"
      data-verification={state === "resolved" ? "passed" : verification.status}
      data-verifying={state === "verifying" && verification.status === "pending" ? "true" : undefined}
    >
      <dt>Verification</dt>
      <dd>
        <span className="facts__strong">{verificationTitle(incident)}</span>
        {verification.summary ? <span className="facts__sub">{verification.summary}</span> : null}
      </dd>
    </div>
  );
}

function Feed({ events }: { events: ProtocolEvent[] | undefined }) {
  if (events === undefined) return <p className="panel__sub">Loading protocol feed...</p>;
  if (events.length === 0) return <p className="panel__sub">No protocol events yet.</p>;
  return (
    <ol className="feed">
      {events.map((event) => (
        <li key={event.event_id} className="feed__row">
          <FeedAvatar event={event} />
          <span className="feed__type mono">{event.type}</span>
          <p className="feed__text">
            <strong>{event.actor.id}</strong> ({event.actor.kind}
            {event.actor.tier !== null ? `, tier ${event.actor.tier}` : ""}). {eventLabel(event.type)}:{" "}
            {event.state_from
              ? `${stateLabel(event.state_from)} to ${stateLabel(event.state_to)}`
              : `started as ${stateLabel(event.state_to)}`}
          </p>
          <time className="feed__time" dateTime={event.occurred_at}>
            {formatAbsolute(event.occurred_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function FeedAvatar({ event }: { event: ProtocolEvent }) {
  if (event.actor.kind === "agent") {
    return <AgentMark className="blob blob--small" />;
  }
  const initials = event.actor.kind === "system" ? "API" : event.actor.id.slice(0, 2).toUpperCase();
  return (
    <span className="avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

function AgentMark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="16" height="14" rx="3" />
      <path d="M12 3v3M8 11h8M8 15h5" strokeLinecap="round" />
    </svg>
  );
}
