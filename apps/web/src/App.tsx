import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IncidentEvidence } from "./diagnostics/IncidentEvidence";
import { createClient, type ApiClient } from "./api/client";
import { fetchTransport } from "./api/transport";
import { useBoard } from "./hooks/useBoard";
import { useHashRoute } from "./hooks/useHashRoute";
import { useIncidentActions } from "./hooks/useIncidentActions";
import { useSessionTokens } from "./hooks/useSessionTokens";
import { useStatus } from "./hooks/useStatus";
import { MockIncidentApi } from "./mock/store";
import { createMockTransport, DEMO_IDENTITIES, MOCK_PRINCIPALS } from "./mock/transport";
import { AppShell, BoardView, DevPanel, StatusView } from "./ui";

const MOCK_MODE = import.meta.env.VITE_MOCK_API !== "false";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const BOARD_POLL_MS = 2000;
const STATUS_POLL_MS = 3000;
const MOCK_LATENCY_MS = 120;

interface BoardRouteProps {
  client: ApiClient;
  announce: (message: string) => void;
  registerProbe: (probe: (() => void) | null) => void;
}

function BoardRoute({ client, announce, registerProbe }: BoardRouteProps) {
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

function StatusRoute({ client, variant }: { client: ApiClient; variant: "attendee" | "projector" }) {
  const { status, error } = useStatus(client, STATUS_POLL_MS);
  return <StatusView status={status} error={error} variant={variant} />;
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const [identityId, setIdentityId] = useState(DEMO_IDENTITIES[0]?.id ?? "organizer");
  const [liveTokens, setLiveToken] = useSessionTokens();
  const [announcement, setAnnouncement] = useState("");
  const [mockApi] = useState(() => (MOCK_MODE ? new MockIncidentApi({ principals: MOCK_PRINCIPALS }) : null));
  const probe = useRef<(() => void) | null>(null);

  const identity = DEMO_IDENTITIES.find((candidate) => candidate.id === identityId) ?? DEMO_IDENTITIES[0];
  const token = MOCK_MODE ? (identity?.token ?? "") : (liveTokens[identityId] ?? "");

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
      onBumpVersion={() => mockApi.bumpVersion()}
      onProbeDeniedApprove={() => probe.current?.()}
      onDropNextResponse={() => mockApi.dropNextResponse()}
      onReset={() => {
        mockApi.reset();
        setAnnouncement("Mock scenario reset to the proposed plan.");
      }}
    />
  ) : undefined;

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      identities={DEMO_IDENTITIES}
      activeIdentityId={identityId}
      onIdentityChange={setIdentityId}
      mockMode={MOCK_MODE}
      token={token}
      onTokenChange={(next) => setLiveToken(identityId, next)}
      announcement={announcement}
      devPanel={devPanel}
    >
      {route === "board" ? (
        <BoardRoute key={`board-${identityId}-${credentialGeneration}`} client={client} announce={setAnnouncement} registerProbe={registerProbe} />
      ) : (
        <StatusRoute
          key={`${route}-${identityId}-${credentialGeneration}`}
          client={client}
          variant={route === "projector" ? "projector" : "attendee"}
        />
      )}
    </AppShell>
  );
}
