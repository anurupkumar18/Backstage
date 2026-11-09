import { useId } from "react";
import type { PresenceCounts, PublicRoomStatus, PublicStatus } from "../api/types";
import { EVENT, venueRoomLabel } from "../venue/kubecon-na-2026";
import { PRIVACY_NOTE } from "./AppShell";
import { JoinQr } from "./JoinQr";
import { PresenceField } from "./PresenceField";
import { ROOM_STATUS_LABEL, roomLabel } from "./format";
import type { UiError } from "./types";

const TONE: Record<PublicRoomStatus, "ok" | "alert" | "info"> = { normal: "ok", affected: "alert", recovering: "info" };
const RANK: Record<PublicRoomStatus, number> = { affected: 0, recovering: 1, normal: 2 };

export interface StatusViewProps {
  status: PublicStatus | null;
  error: UiError | null;
  variant: "attendee" | "projector";
  presence?: PresenceCounts | null;
  /** Projector only: the attendee join link, shown as a large QR next to the presence hero. */
  joinUrl?: string;
}

function StatusWord({ status }: { status: PublicRoomStatus }) {
  return (
    <p className="status-word" data-status={status}>
      <span className="dot" data-tone={TONE[status]} aria-hidden="true" />
      {ROOM_STATUS_LABEL[status]}
    </p>
  );
}

export function StatusView({ status, error, variant, presence, joinUrl }: StatusViewProps) {
  const titleId = useId();
  const roomsId = useId();
  const sessionsId = useId();
  const projector = variant === "projector";

  const rooms = status
    ? status.rooms.map((room) => ({ ...room, label: venueRoomLabel(room.room_id, room.label) })).sort((a, b) => RANK[a.status] - RANK[b.status])
    : [];
  const headline = projector && rooms[0] && rooms[0].status !== "normal" ? rooms[0] : null;
  const gridRooms = headline ? rooms.slice(1) : rooms;
  const tickerText = status
    ? [...rooms, ...status.sessions].map((entry) => `${entry.label}: ${ROOM_STATUS_LABEL[entry.status]}`).join("   ·   ")
    : "";

  return (
    <section className={`status status--${variant}`} aria-labelledby={titleId}>
      {projector ? (
        <div className="status__event">
          <p className="status__event-name">{EVENT.name}</p>
          <p className="status__event-where">
            {EVENT.venue}, {EVENT.city}. {EVENT.dates}.
          </p>
        </div>
      ) : null}

      <h1 id={titleId} className="status__title">
        {projector ? "Conference floor" : "Room status"}
      </h1>

      {error ? (
        <p role="alert" className="notice notice--error">
          <strong>Could not load status.</strong> {error.message}
        </p>
      ) : null}

      {status === null && !error ? <p className="status__empty">Loading status...</p> : null}

      {projector && (presence || joinUrl) ? (
        <div className="status__hero" data-with-qr={joinUrl ? "true" : undefined}>
          {presence ? <PresenceField counts={presence} variant="hero" /> : null}
          {joinUrl ? <JoinQr url={joinUrl} /> : null}
        </div>
      ) : null}
      {!projector && presence ? <PresenceField counts={presence} variant="compact" /> : null}

      {status ? (
        <>
          {projector && !headline && rooms.length > 0 ? <p className="status__calm">All rooms normal.</p> : null}

          {headline ? (
            <section className="headline" data-status={headline.status} aria-label="Most affected room">
              <h2 className="headline__name">{headline.label}</h2>
              <StatusWord status={headline.status} />
              {headline.accessibility_status ? (
                <p className="headline__a11y">
                  <strong>Accessibility update:</strong> {headline.accessibility_status}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby={roomsId}>
            <h2 id={roomsId} className="status__heading">
              {headline ? "Other rooms" : "Rooms"}
            </h2>
            {gridRooms.length === 0 ? (
              <p className="status__empty">{headline ? "No other rooms reported." : "No rooms reported."}</p>
            ) : (
              <ul className="status__grid">
                {gridRooms.map((room) => (
                  <li key={room.room_id} className="status-card" data-status={room.status}>
                    <h3 className="status-card__name">{room.label}</h3>
                    <StatusWord status={room.status} />
                    {room.accessibility_status ? (
                      <p className="status-card__a11y">
                        <strong>Accessibility update:</strong> {room.accessibility_status}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {status.sessions.length > 0 ? (
            <section aria-labelledby={sessionsId}>
              <h2 id={sessionsId} className="status__heading">
                Sessions
              </h2>
              <ul className="status__grid">
                {status.sessions.map((session) => (
                  <li key={session.session_id} className="status-card" data-status={session.status}>
                    <h3 className="status-card__name">{session.label}</h3>
                    <p className="status-card__room">{roomLabel(session.room_id)}</p>
                    <StatusWord status={session.status} />
                    {session.accessibility_status ? (
                      <p className="status-card__a11y">
                        <strong>Accessibility update:</strong> {session.accessibility_status}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {projector && tickerText ? (
        <div className="ticker" aria-hidden="true">
          <div className="ticker__track">
            <span className="ticker__copy">{tickerText}</span>
            <span className="ticker__copy">{tickerText}</span>
          </div>
        </div>
      ) : null}

      <p className="privacy-note status__privacy">{PRIVACY_NOTE}</p>
    </section>
  );
}
