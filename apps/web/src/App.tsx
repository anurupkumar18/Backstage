import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IncidentEvidence } from "./diagnostics/IncidentEvidence";
import { createClient, type ApiClient } from "./api/client";
import { fetchTransport } from "./api/transport";
import { useBoard } from "./hooks/useBoard";
import { useHashRoute } from "./hooks/useHashRoute";
import { useIncidentActions } from "./hooks/useIncidentActions";
import { useSessionTokens } from "./hooks/useSessionTokens";
import { createHttpPresenceApi } from "./api/presence";
import type { PresenceCounts, PresenceTier } from "./api/types";
import { usePresence } from "./hooks/usePresence";
import { PresenceSimulator } from "./mock/presence";
import { LIVE_IDENTITIES } from "./live/identities";
import { useStatus } from "./hooks/useStatus";
import { MockIncidentApi } from "./mock/store";
import { createMockTransport, DEMO_IDENTITIES, MOCK_PRINCIPALS } from "./mock/transport";
import { VoiceBriefingControl } from "./ui/VoiceBriefingControl";
import { useInbox } from "./hooks/useInbox";
import { HistoryView } from "./ui/HistoryView";
import { InboxView } from "./ui/InboxView";
import type { Identity } from "./ui/types";
import { AppShell, BoardView, DevPanel, JoinPage, StatusView } from "./ui";

const MOCK_MODE = import.meta.env.VITE_MOCK_API !== "false";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const BOARD_POLL_MS = 2000;
const STATUS_POLL_MS = 3000;
const MOCK_LATENCY_MS = 120;

interface BoardRouteProps {
  client: ApiClient;
  announce: (message: string) => void;
  registerProbe: (probe: (() => void) | null) => void;
  presence: PresenceCounts | null;
}

function BoardRoute({ client, announce, registerProbe, presence }: BoardRouteProps) {
  const board = useBoard({ client, pollMs: BOARD_POLL_MS, announce });
  const actions = useIncidentActions({
    client,
    applyIncident: board.applyIncident,
    refresh: board.refresh,
  });

  const firstIncident = board.incidents[0];
  const run = actions.run;
  useEffect(() => {
    registerProbe(firstIncident ? () => void run(firstIncident, "approve") : null);
    return () => registerProbe(null);
  }, [firstIncident, run, registerProbe]);

  return (
    <BoardView
      presence={presence}
      renderEvidence={(incident) => <IncidentEvidence key={incident.id} incident={incident} client={client} mockMode={MOCK_MODE} />}
      incidents={board.incidents}
      eventsById={board.eventsById}
      actionState={actions.actionState}
      onAction={(incident, action) => void actions.run(incident, action)}
      onTimelineOpen={board.onTimelineOpen}
      focusIncidentId={actions.focusIncidentId}
      loadError={board.loadError}
      loading={board.loading}
    />
  );
}

function StatusRoute({ client, variant, presence, joinUrl }: { client: ApiClient; variant: "attendee" | "projector"; presence: PresenceCounts | null; joinUrl: string }) {
  const { status, error } = useStatus(client, STATUS_POLL_MS);
  return <StatusView status={status} error={error} variant={variant} presence={presence} joinUrl={variant === "projector" ? joinUrl : undefined} />;
}

function InboxRoute({ client, identity, token, announce }: { token: string; client: ApiClient; identity: Identity; announce: (message: string) => void }) {
  const inbox = useInbox(client, identity, announce);
  return <><InboxView brief={inbox.brief} activity={inbox.activity} items={inbox.items} identity={identity} actionState={inbox.actionState}
    onAction={(incident, action) => void inbox.run(incident, action)} focusIncidentId={inbox.focusIncidentId}
    loadError={inbox.loadError} loading={inbox.loading} onMarkSeen={inbox.markSeen} />
    {import.meta.env.VITE_ENABLE_VOICE === "true" ? <VoiceBriefingControl token={token} client={client} tier={identity.tier} announce={announce} /> : null}</>;
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const [identityId, setIdentityId] = useState(DEMO_IDENTITIES[0]?.id ?? "organizer");
  const [liveTokens, setLiveToken] = useSessionTokens();
  const [announcement, setAnnouncement] = useState("");
  const [mockApi] = useState(() => (MOCK_MODE ? new MockIncidentApi({ principals: MOCK_PRINCIPALS }) : null));
  const probe = useRef<(() => void) | null>(null);

  const identities = MOCK_MODE ? DEMO_IDENTITIES : LIVE_IDENTITIES;
  const identity = identities.find((candidate) => candidate.id === identityId) ?? identities[0];
  const token = MOCK_MODE ? (identity?.token ?? "") : (liveTokens[identityId] ?? "");
  const [presenceApi] = useState(() => MOCK_MODE ? new PresenceSimulator() : createHttpPresenceApi());
  const presence = usePresence(presenceApi, 2000);
  const [joinedTier, setJoinedTier] = useState<PresenceTier | null>(null);
  const joinUrl = `${window.location.origin}/#/join`;

  const client = useMemo(
    () =>
      createClient({
        transport: mockApi ? createMockTransport(mockApi, MOCK_LATENCY_MS) : fetchTransport(API_BASE_URL),
        getToken: () => token,
      }),
    [mockApi, token],
  );
  // Opaque generation resets scoped caches, actions and inspector state even for the same role.
  const credentialGeneration = useMemo(() => crypto.randomUUID(), [client]);

  const registerProbe = useCallback((next: (() => void) | null) => {
    probe.current = next;
  }, []);

  const devPanel = mockApi ? (
    <DevPanel
      onCheckInWave={() => presenceApi instanceof PresenceSimulator && presenceApi.wave()}
      onBumpVersion={() => mockApi.bumpVersion()}
      onProbeDeniedApprove={() => probe.current?.()}
      onDropNextResponse={() => mockApi.dropNextResponse()}
      onReset={() => {
        mockApi.reset();
        if (presenceApi instanceof PresenceSimulator) presenceApi.reset();
        setJoinedTier(null);
        setAnnouncement("Mock scenario reset to the proposed plan.");
      }}
    />
  ) : undefined;

  if (route === "join") {
    return <main><JoinPage joinedTier={joinedTier} onJoin={async (tier) => {
      const result = await presenceApi.join(tier);
      if (result.ok) setJoinedTier(tier);
      return result;
    }} /></main>;
  }

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      identities={identities}
      activeIdentityId={identityId}
      onIdentityChange={(id) => { setAnnouncement(""); setIdentityId(id); }}
      mockMode={MOCK_MODE}
      token={token}
      onTokenChange={(next) => { setAnnouncement(""); setLiveToken(identityId, next); }}
      announcement={announcement}
      devPanel={devPanel}
    >
      {route === "history" ? (
        <HistoryView key={`history-${identityId}-${credentialGeneration}`} client={client} mockMode={MOCK_MODE} />
      ) : route === "me" && identity && identity.tier > 0 ? (
        <InboxRoute token={token} key={`inbox-${identityId}-${credentialGeneration}`} client={client} identity={identity} announce={setAnnouncement} />
      ) : route === "board" ? (
        <BoardRoute key={`board-${identityId}-${credentialGeneration}`} presence={presence} client={client} announce={setAnnouncement} registerProbe={registerProbe} />
      ) : (
        <StatusRoute
          key={`${route}-${identityId}-${credentialGeneration}`}
          presence={presence}
          joinUrl={joinUrl}
          client={client}
          variant={route === "projector" ? "projector" : "attendee"}
        />
      )}
    </AppShell>
  );
}
