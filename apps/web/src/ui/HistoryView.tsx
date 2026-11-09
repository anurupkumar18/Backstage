import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Incident, ProtocolEvent } from "../api/types";
import { EVENT_LABEL, STATE_LABEL, TYPE_LABEL, roomLabel } from "./format";
import "./history.css";

function date(value: string) {
  return new Date(value).toLocaleString();
}

function IncidentHistory({ incident, client }: { incident: Incident; client: ApiClient }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ProtocolEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setEvents(null);
    setError(null);
    void client.listEvents(incident.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setEvents([...result.data.items].sort((a, b) => a.sequence - b.sequence));
      else setError(result.message);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load the event history. Try again.");
    });
    return () => controller.abort();
  }, [open, client, incident.id, incident.version, attempt]);

  return <details className="history__incident" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span><strong>{incident.summary}</strong><span className="history__meta">{roomLabel(incident.room_id)} · {TYPE_LABEL[incident.type]}</span></span>
      <span className="history__state">{STATE_LABEL[incident.state]}</span>
      <time dateTime={incident.updated_at}>{date(incident.updated_at)}</time>
    </summary>
    <div className="history__detail">
      <dl className="history__facts">
        <div><dt>Incident ID</dt><dd>{incident.id}</dd></div>
        <div><dt>Assigned to</dt><dd>{incident.assignment?.assignee_id ?? "Not assigned"}</dd></div>
        <div><dt>Plan</dt><dd>{incident.plan?.summary ?? "No plan recorded"}</dd></div>
        <div><dt>Verification</dt><dd>{incident.verification.summary ?? "Not verified yet"}</dd></div>
      </dl>
      <h2>Event history</h2>
      {error ? <div role="alert"><p>{error}</p><button className="btn btn--quiet" onClick={() => setAttempt((n) => n + 1)}>Retry event history</button></div>
        : events === null ? <p>Loading events…</p>
        : events.length === 0 ? <p>No events recorded.</p>
        : <ol className="history__events">{events.map((event) => <li key={event.event_id}>
          <span><strong>{EVENT_LABEL[event.type] ?? event.type}</strong><span className="history__meta">{event.actor.id} · {STATE_LABEL[event.state_to] ?? event.state_to}</span></span>
          <time dateTime={event.occurred_at}>{date(event.occurred_at)}</time>
        </li>)}</ol>}
    </div>
  </details>;
}

export function HistoryView({ client, mockMode }: { client: ApiClient; mockMode: boolean }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setIncidents([]);
    void client.listIncidents(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setIncidents([...result.data.items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
      else setError(result.message);
      setLoading(false);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setError("Could not load saved incidents. Check the API connection and try again.");
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [client, refresh]);
  const search = query.trim().toLowerCase();
  const visible = incidents.filter((item) =>
    (status === "all" || (status === "resolved" ? item.state === "resolved" : item.state !== "resolved")) &&
    [item.summary, item.id, item.room_id, roomLabel(item.room_id), TYPE_LABEL[item.type], item.assignment?.assignee_id ?? ""].join(" ").toLowerCase().includes(search));
  return <section className="history" aria-labelledby="history-title">
    <div className="history__heading"><div><h1 id="history-title">History</h1><p>{mockMode ? "Sample incident history for this demo." : "Saved incidents and their event history, within your access."}</p></div>
      <button className="btn btn--quiet" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>Refresh history</button></div>
    <div className="history__filters">
      <label className="field">Search history<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Incident, room, or assignee" /></label>
      <label className="field">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="resolved">Resolved</option><option value="unresolved">Unresolved</option></select></label>
    </div>
    {loading ? <p>Loading saved incidents…</p> : error ? <p role="alert">Could not load history. {error}</p> : <>
      <p className="history__count">{visible.length} {visible.length === 1 ? "incident" : "incidents"}</p>
      {visible.length === 0 ? <p>{incidents.length === 0 ? "No saved incidents are available for your role yet." : "No incidents match these filters."}</p>
        : visible.map((incident) => <IncidentHistory key={incident.id} incident={incident} client={client} />)}
    </>}
  </section>;
}
