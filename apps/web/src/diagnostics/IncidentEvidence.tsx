import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ApiClient } from "../api/client";
import type { ApiResult, Incident, ProtocolEvent } from "../api/types";
import { browserMonitoringState } from "../telemetry/init";
import { usePolling } from "../hooks/usePolling";
import type {
  EvidenceHit,
  EvidencePage,
  IncidentDiagnostics,
  Projection,
} from "./types";
import "./diagnostics.css";

interface Props {
  incident: Incident;
  client: ApiClient;
  mockMode: boolean;
}
/** Credentials define a new scope, synchronously dropping every cached incident, event and search hit. */
export function IncidentEvidence(props: Props) {
  const [scope, setScope] = useState({ client: props.client, generation: 0 });
  if (scope.client !== props.client) {
    setScope({ client: props.client, generation: scope.generation + 1 });
    return null;
  }
  return <EvidenceScope key={scope.generation} {...props} />;
}
function EvidenceScope({ incident, client, mockMode }: Props) {
  const [historical, setHistorical] = useState<Incident | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const inspected = historical ?? incident;
  const open = async (hit: EvidenceHit) => {
    const mine = ++request.current;
    setOpening(true);
    setOpenError(null);
    const result = await client.getIncident(hit.incident_id);
    if (!alive.current || mine !== request.current) return;
    setOpening(false);
    if (result.ok) {
      setHistorical(result.data);
      setEventId(hit.event_id);
      setFocusRequest((value) => value + 1);
    } else setOpenError(result.message);
  };
  return (
    <section className="evidence" aria-label="Incident evidence">
      <header className="evidence__header">
        <div>
          <p className="evidence__eyebrow">Committed evidence</p>
          <h3>Investigate this incident</h3>
        </div>
        <span className="evidence__mode">
          {mockMode ? "Mock API · rehearsal" : "Live API transport"}
        </span>
      </header>
      <p className="evidence__muted">
        Recorded events explain each step. Search may take a few seconds to
        catch up.
      </p>
      <p className="evidence__muted">
        {browserMonitoringState() === "configured"
          ? "Monitoring enabled; delivery not confirmed."
          : "Browser monitoring is off."}
      </p>
      {historical ? (
        <button
          type="button"
          onClick={() => {
            request.current++;
            setHistorical(null);
            setEventId(null);
            setOpenError(null);
            setOpening(false);
            setFocusRequest((value) => value + 1);
          }}
        >
          Return to board incident
        </button>
      ) : null}
      <Inspector
        key={inspected.id}
        incident={inspected}
        client={client}
        selectedEventId={eventId}
        focusRequest={focusRequest}
      />
      <EvidenceSearch client={client} onOpen={open} />
      {opening ? <p role="status">Opening authorized incident…</p> : null}
      {openError ? (
        <p role="alert">Could not open incident. {openError}</p>
      ) : null}
    </section>
  );
}
function safeTraceUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function Trace({
  traceId,
  url,
}: {
  traceId: string | null;
  url: string | null;
}) {
  const [message, setMessage] = useState("");
  const link = safeTraceUrl(url);
  if (!traceId)
    return (
      <p className="evidence__muted">
        No trace ID recorded for this selection.
      </p>
    );
  return (
    <div className="evidence__trace">
      <p>
        Trace ID <code>{traceId}</code>
      </p>
      <div className="evidence__actions">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(traceId).then(
              () => setMessage("Trace ID copied."),
              () =>
                setMessage(
                  "Copy unavailable. Select the trace ID above to copy it.",
                ),
            );
            if (!navigator.clipboard)
              setMessage(
                "Copy unavailable. Select the trace ID above to copy it.",
              );
          }}
        >
          Copy full trace ID
        </button>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer">
            Open trace in Dash0
          </a>
        ) : (
          <span>Trace link not configured.</span>
        )}
      </div>
      <p className="evidence__muted">
        Provider ingestion is not verified by this board.
      </p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
function ProjectionStatus({ projection }: { projection: Projection }) {
  const revision = (value: Projection["checkpoint_revision"]) =>
    value ? `${value.seq_no}/${value.primary_term}` : "not available";
  return (
    <div className="evidence__projection">
      <p>
        Search projection: {projection.status} · incident coverage version{" "}
        {projection.watermark_version ?? "unknown"}
      </p>
      <p className="evidence__muted">
        Checkpoint revision {revision(projection.checkpoint_revision)} ·
        searchable revision {revision(projection.indexed_revision)}. Last
        indexed: {projection.projected_at ?? "not yet indexed"}.
      </p>
      {projection.last_error ? (
        <p role="alert">Projection error: {projection.last_error}</p>
      ) : null}
    </div>
  );
}
function Inspector({
  incident,
  client,
  selectedEventId,
  focusRequest,
}: {
  incident: Incident;
  client: ApiClient;
  selectedEventId: string | null;
  focusRequest: number;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusRequest > 0) heading.current?.focus();
  }, [focusRequest]);
  const [diagnostics, setDiagnostics] = useState<IncidentDiagnostics | null>(
    null,
  );
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [events, setEvents] = useState<ProtocolEvent[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState<string | null>(selectedEventId);
  const diagnosticRequest = useRef(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  useEffect(() => setChosen(selectedEventId), [selectedEventId]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const mine = ++diagnosticRequest.current;
      const response = await client.getDiagnostics(incident.id, signal);
      if (signal.aborted || mine !== diagnosticRequest.current) return;
      if (response.ok) {
        setDiagnostics(response.data);
        setDiagnosticError(null);
        setCheckedAt(new Date().toISOString());
      } else setDiagnosticError(response.message);
    },
    [client, incident.id, incident.version],
  );
  usePolling(load, 5000);
  useEffect(() => {
    const controller = new AbortController();
    setTimelineError(null);
    void client
      .listEvents(incident.id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.ok) {
          setEvents(response.data.items);
          setTimelineError(null);
        } else setTimelineError(response.message);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setTimelineError(
            error instanceof Error ? error.message : "Timeline unavailable",
          );
      });
    return () => controller.abort();
  }, [client, incident.id, incident.version, retry]);
  const ordered = events
    ? [...events].sort((a, b) => a.sequence - b.sequence)
    : null;
  const selected = chosen
    ? ordered?.find((event) => event.event_id === chosen)
    : ordered?.at(-1);
  const diag = diagnosticError ? null : diagnostics;
  const payloadSignalIds = [
    ...(typeof selected?.payload.signal_id === "string"
      ? [selected.payload.signal_id]
      : []),
    ...(Array.isArray(selected?.payload.evidence_signal_ids)
      ? selected.payload.evidence_signal_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : []),
  ];
  const selectedRefs =
    diag?.events.find((event) => event.event_id === selected?.event_id)
      ?.signal_ids ?? payloadSignalIds;
  const matchingSignals =
    diag?.signals.filter((signal) => selectedRefs.includes(signal.signal_id)) ??
    [];
  const traceId =
    selected?.trace_id ?? diag?.trace.trace_id ?? incident.trace_id;
  const traceUrl =
    traceId === diag?.trace.trace_id ? (diag?.trace.url ?? null) : null;
  return (
    <section
      className="evidence__inspector"
      aria-label={`Evidence for ${incident.summary}`}
    >
      <h4 ref={heading} tabIndex={-1}>
        Evidence for {incident.summary}
      </h4>
      <p className="evidence__muted">
        <code>{incident.id}</code> · board version {incident.version} ·{" "}
        {incident.state}
      </p>
      {diagnosticError ? (
        <div role="alert">
          <p>Diagnostics unavailable. {diagnosticError}</p>
          <button
            type="button"
            onClick={() => void load(new AbortController().signal)}
          >
            Retry diagnostics
          </button>
        </div>
      ) : null}
      {!diagnostics && !diagnosticError ? (
        <p>Loading storage and verification evidence…</p>
      ) : null}
      {diag ? (
        <>
          <details className="evidence__technical">
            <summary>Storage, source and freshness</summary>
            <dl className="evidence__facts">
              <div>
                <dt>Checkpoint</dt>
                <dd>
                  {diag.storage.mode === "memory"
                    ? "Memory checkpoint"
                    : "Elasticsearch checkpoint"}{" "}
                  · {diag.storage.durable ? "durable" : "not durable"}
                </dd>
              </div>
              <div>
                <dt>Signal provenance</dt>
                <dd>
                  Origin {diag.provenance.origin}. Source ID identifies the
                  producer; it does not prove live or synthetic origin.
                </dd>
              </div>
              <div>
                <dt>Last checked</dt>
                <dd>
                  {checkedAt} · diagnostics version {diag.version}
                </dd>
              </div>
            </dl>
            <ProjectionStatus projection={diag.projection} />
          </details>
          <div className="evidence__wait">
            <h5>
              {diag.verification.status === "passed"
                ? "Recovery evidence passed"
                : "Why recovery waits"}
            </h5>
            <p>
              {diag.verification.reason ||
                incident.verification.summary ||
                "No verification explanation recorded."}
            </p>
            {diag.verification.required_duration_s !== null ? (
              <>
                <p>
                  {diag.verification.observed_duration_s === null
                    ? "Observed duration unavailable"
                    : `${diag.verification.observed_duration_s} of ${diag.verification.required_duration_s} seconds observed`}
                </p>
                {diag.verification.observed_duration_s !== null ? (
                  <progress
                    aria-label="Observed recovery evidence"
                    max={diag.verification.required_duration_s}
                    value={diag.verification.observed_duration_s}
                  />
                ) : null}
                <p className="evidence__muted">
                  Evidence time advances only when qualifying samples arrive.
                  Stale or above-threshold samples can reset the window.
                </p>
              </>
            ) : null}
            <p>
              Verification references:{" "}
              {diag.verification.evidence_signal_ids.join(", ") ||
                "none recorded"}
            </p>
          </div>
        </>
      ) : null}
      <h5>What happened</h5>
      {chosen && ordered && !selected ? (
        <div role="alert">
          <p>
            The selected event is unavailable in the committed timeline. Refresh
            the timeline to try again.
          </p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Refresh timeline
          </button>
        </div>
      ) : null}
      {timelineError ? (
        <div role="alert">
          <p>Timeline unavailable. {timelineError}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry timeline
          </button>
        </div>
      ) : null}
      {!events && !timelineError ? <p>Loading committed timeline…</p> : null}
      {ordered?.length === 0 ? <p>No committed protocol events yet.</p> : null}
      {ordered && ordered.length > 0 ? (
        <>
          <ol
            className="evidence__sequence"
            aria-label="Committed event sequence"
          >
            {ordered.map((event) => (
              <li key={event.event_id}>
                <button
                  type="button"
                  aria-pressed={selected?.event_id === event.event_id}
                  onClick={() => setChosen(event.event_id)}
                >
                  <span>
                    #{event.sequence} {event.type}
                  </span>
                  <small>
                    {event.state_from ?? "start"} → {event.state_to}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {selected ? (
            <section className="evidence__event" aria-label="Selected event">
              <h5>
                #{selected.sequence} {selected.type}
              </h5>
              <dl className="evidence__facts">
                <div>
                  <dt>Event ID</dt>
                  <dd>
                    <code>{selected.event_id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Actor</dt>
                  <dd>
                    {selected.actor.id} · {selected.actor.kind}
                    {selected.actor.tier !== null
                      ? ` · tier ${selected.actor.tier}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Committed at</dt>
                  <dd>
                    <time dateTime={selected.occurred_at}>
                      {selected.occurred_at}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Transition</dt>
                  <dd>
                    {selected.state_from ?? "start"} → {selected.state_to}
                  </dd>
                </div>
              </dl>
              <p>
                Signal references: {selectedRefs.join(", ") || "none recorded"}
              </p>
              <details>
                <summary>Committed event payload</summary>
                <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
              </details>
              {matchingSignals.map((signal) => (
                <div key={signal.signal_id} className="evidence__signal">
                  <strong>{signal.signal_id}</strong>
                  <p>
                    {signal.kind} · source {signal.source_id} · origin{" "}
                    {signal.origin}
                  </p>
                  {signal.facts ? (
                    <p>
                      {signal.facts.zone} count {signal.facts.count}, threshold{" "}
                      {signal.facts.threshold}
                    </p>
                  ) : null}
                  <p>
                    Observed: {signal.observed_at}
                    <br />
                    Received: {signal.received_at ?? "unknown"}
                  </p>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      <Trace key={traceId} traceId={traceId} url={traceUrl} />
    </section>
  );
}
function EvidenceSearch({
  client,
  onOpen,
}: {
  client: ApiClient;
  onOpen: (hit: EvidenceHit) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [room, setRoom] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<ApiResult<EvidencePage> | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current++;
      controller.current?.abort();
    },
    [],
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    controller.current?.abort();
    controller.current = new AbortController();
    const mine = ++request.current;
    setLoading(true);
    setResult(null);
    try {
      const next = await client.searchEvidence(
        {
          q,
          room_id: room,
          event_type: type,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to).toISOString() : undefined,
          limit: 20,
        },
        controller.current.signal,
      );
      if (mine === request.current) {
        setResult(next);
        setLoading(false);
      }
    } catch {
      if (mine === request.current) {
        setResult({
          ok: false,
          code: "network",
          status: 0,
          message: "Search could not complete. Try again.",
        });
        setLoading(false);
      }
    }
  };
  return (
    <section className="evidence__search" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Search committed evidence</h4>
      <form
        role="search"
        aria-label="Committed evidence search"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor={`${id}-q`}>Search committed evidence</label>
        <input
          id={`${id}-q`}
          type="search"
          maxLength={200}
          autoComplete="off"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Incident, event or protocol text"
        />
        <div className="evidence__filters">
          <label>
            Room ID
            <input
              value={room}
              maxLength={100}
              onChange={(event) => setRoom(event.target.value)}
              placeholder="room-b"
            />
          </label>
          <label>
            Event type
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">All events</option>
              {[
                "raise",
                "claim",
                "propose",
                "approve",
                "dispatch",
                "ack",
                "handoff",
                "verify",
                "close",
                "escalate",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            From (local time)
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            To (local time)
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Searching evidence…" : "Search evidence"}
        </button>
      </form>
      {result && !result.ok ? <p role="alert">{result.message}</p> : null}
      {result?.ok ? (
        <>
          <p role="status">
            Showing {result.data.items.length} authorized results (limit{" "}
            {result.data.limit}). Narrow filters to find more evidence.
          </p>
          <details>
            <summary>Search freshness</summary>
            <ProjectionStatus projection={result.data.projection} />
          </details>
          {result.data.items.length === 0 ? (
            <p>No committed evidence matches these filters.</p>
          ) : (
            <ul className="evidence__results">
              {result.data.items.map((hit) => (
                <li key={hit.document_id}>
                  <button type="button" onClick={() => onOpen(hit)}>
                    Open {hit.summary} · {hit.incident_id}
                    {hit.sequence !== null ? ` · event #${hit.sequence}` : ""}
                  </button>
                  <small>
                    {hit.room_id} · {hit.event_type} · {hit.occurred_at}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
