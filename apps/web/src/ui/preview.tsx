import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import examples from "@fixtures/http.examples.json";
import type { Incident, PresenceCounts, PresenceTier, ProtocolEvent, PublicStatus } from "../api/types";
import { AppShell, BoardView, DevPanel, JoinPage, PresenceField, StatusView } from "./index";
import type { ActionState, Identity, Route } from "./types";

interface Example {
  scenario: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
}

const overflow = (examples as unknown as Example[]).filter((example) => example.scenario === "overflow");
const find = (method: string, path: string, status = 200) =>
  overflow.find((example) => example.method === method && example.path === path && example.status === status)?.response;

const proposed = find("GET", "/api/v1/incidents/inc-overflow-room-b") as Incident;
const acceptedFixture = (overflow.filter((e) => e.method === "POST" && e.status === 200).at(-1)?.response ?? proposed) as Incident;
const events = (find("GET", "/api/v1/incidents/inc-overflow-room-b/events") as { items: ProtocolEvent[] }).items;
const status = find("GET", "/api/v1/status") as PublicStatus;

const accepted: Incident = { ...acceptedFixture, id: "inc-preview-accepted", summary: "Room B overflow, second wave" };
const dispatched: Incident = {
  ...accepted,
  id: "inc-preview-dispatched",
  summary: "Mic lost on Stage B",
  type: "stage_av",
  state: "dispatched",
  version: 5,
  allowed_actions: ["ack"],
};
const verifying: Incident = {
  ...accepted,
  id: "inc-preview-verifying",
  summary: "Badge station A stalled",
  type: "badge_stall",
  room_id: "room-c",
  priority: "normal",
  state: "verifying",
  version: 7,
  allowed_actions: [],
  verification: { status: "pending", summary: "Door count under 5 for 30 of 60 seconds." },
};
const resolved: Incident = {
  ...accepted,
  id: "inc-preview-resolved",
  summary: "Room B overflow, first wave",
  state: "resolved",
  version: 8,
  allowed_actions: [],
  verification: { status: "passed", summary: "Door count stayed under 5 for 60 seconds." },
};
const escalated: Incident = {
  ...accepted,
  id: "inc-preview-escalated",
  summary: "Captions frozen",
  type: "stage_av",
  state: "escalated",
  version: 4,
  allowed_actions: [],
};

const identities: Identity[] = [
  { id: "organizer", label: "Organizer", tier: 3, description: "Approves plans and sees every incident." },
  { id: "staff", label: "Staff", tier: 2, description: "Acts inside their domain and accepts or hands off assignments." },
  { id: "speaker", label: "Speaker", tier: 1, description: "Sees their own session and can request help." },
  { id: "attendee", label: "Attendee", tier: 0, description: "Sees status and can report a problem." },
];

const liveOverflow: Incident = {
  ...proposed,
  id: "inc_7f3c2a9e4b1d4c0e8a6f5b2d9c1e0a47",
  updated_at: "2026-11-09T19:04:12.483921+00:00",
  verification: { status: "pending", summary: "Door zone count 14, threshold 5. Waiting for 60 s under threshold." },
};
const liveBadge: Incident = {
  ...proposed,
  id: "inc_2b8d0e61c95a4f7da3e1b04c7f6d2e98",
  type: "badge_stall",
  room_id: "room-c",
  priority: "normal",
  state: "verifying",
  summary: "Badge printing stalled at Station A",
  updated_at: "2026-11-09T19:05:01.000117Z",
  allowed_actions: [],
  verification: { status: "pending", summary: "Print queue drained on Station B. Waiting for 3 successful prints." },
};

const scenes: Record<string, Incident[]> = {
  all: [proposed, dispatched, accepted, verifying, resolved, escalated],
  live: [liveOverflow, liveBadge],
  empty: [],
  one: [proposed],
};

function readParam(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function Preview() {
  const [route, setRoute] = useState<Route>(readParam("route", "board") as Route);
  const [identity, setIdentity] = useState("organizer");
  const [token, setToken] = useState("");
  const [presence, setPresence] = useState<PresenceCounts>({
    attendee: Number(readParam("attendees", "42")),
    speaker: Number(readParam("speakers", "5")),
    staff: Number(readParam("staff", "8")),
    organizer: Number(readParam("organizers", "3")),
  });
  const scene = readParam("scene", "all");
  const incidents = scenes[scene] ?? scenes.all ?? [];
  const mock = readParam("mock", "1") === "1";
  const busy = readParam("busy", "") === "1";
  const showPresence = readParam("presence", "1") === "1";
  const actionState: Record<string, ActionState> = {
    [proposed.id]: busy ? { busy: "approve", error: null } : { busy: null, error: null },
    [dispatched.id]: { busy: null, error: { code: "stale_version", message: "Refresh the incident before taking an action." } },
  };

  const wave = () =>
    setPresence((current) => ({
      attendee: current.attendee + 23,
      speaker: current.speaker + 1,
      staff: current.staff + 2,
      organizer: current.organizer,
    }));
  const leave = () =>
    setPresence((current) => ({
      attendee: Math.max(0, current.attendee - 30),
      speaker: Math.max(0, current.speaker - 1),
      staff: current.staff,
      organizer: current.organizer,
    }));

  const shown = showPresence ? presence : null;

  return (
    <AppShell
      route={route}
      onNavigate={setRoute}
      identities={identities}
      activeIdentityId={identity}
      onIdentityChange={setIdentity}
      mockMode={mock}
      token={token}
      onTokenChange={setToken}
      announcement="Room B overflow: state changed to Approved."
      devPanel={
        mock ? (
          <>
            <DevPanel
              onBumpVersion={noop}
              onProbeDeniedApprove={noop}
              onDropNextResponse={noop}
              onReset={noop}
              onCheckInWave={wave}
            />
            <button type="button" className="btn btn--quiet" onClick={leave}>
              Remove 30 check-ins (preview only)
            </button>
          </>
        ) : undefined
      }
    >
      {route === "board" ? (
        <BoardView
          incidents={incidents}
          eventsById={{ [proposed.id]: events }}
          actionState={actionState}
          onAction={noop}
          onTimelineOpen={noop}
          focusIncidentId={null}
          loadError={readParam("error", "") === "1" ? { code: "network", message: "The API did not respond. Retrying." } : null}
          loading={false}
          presence={shown}
        />
      ) : route === "status" && readParam("only", "") === "presence" ? (
        <PresenceField counts={presence} variant="hero" />
      ) : (
        <StatusView
          status={{
            rooms: [
              ...status.rooms,
              { room_id: "room-c", label: "Registration", status: "recovering", accessibility_status: "Badge printing moved to Station B." },
              { room_id: "room-a", label: "Room A", status: "normal", accessibility_status: null },
            ],
            sessions: [
              { session_id: "s-1", room_id: "room-b", label: "Keynote", status: "affected", accessibility_status: "Captions are being restored." },
            ],
          }}
          error={null}
          variant={route === "projector" ? "projector" : "attendee"}
          presence={shown}
          joinUrl={readParam("qr", "1") === "1" ? "https://backstage.example/#/join" : undefined}
        />
      )}
    </AppShell>
  );
}

function JoinPreview() {
  const [joined, setJoined] = useState<PresenceTier | null>(null);
  const fail = readParam("fail", "") === "1";
  return (
    <JoinPage
      joinedTier={joined}
      onJoin={async (tier) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (fail) return { ok: false, message: "Check-in is closed right now. Try again in a minute." };
        setJoined(tier);
        return { ok: true, message: `You're in as ${tier}.` };
      }}
    />
  );
}

function noop() {}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {readParam("route", "board") === "join" ? <JoinPreview /> : <Preview />}
    </StrictMode>,
  );
}
