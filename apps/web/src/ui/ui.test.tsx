import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Incident, IncidentState, ProtocolEvent, PublicStatus } from "../api/types";
import { AppShell, BoardView, DevPanel, PRIVACY_NOTE, StatusView } from "./index";
import type { BoardViewProps } from "./index";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    type: "overflow",
    room_id: "room-b",
    session_id: null,
    priority: "high",
    state: "plan_proposed",
    version: 3,
    updated_at: "2026-11-09T19:00:30Z",
    summary: "Room B overflow",
    plan: { id: "plan-1", summary: "Send venue staff to the door." },
    assignment: null,
    verification: { status: "pending", summary: null },
    allowed_actions: ["approve"],
    trace_id: "301b8846dc4f475e9b4175b7fe35b31c",
    ...overrides,
  };
}

function board(props: Partial<BoardViewProps> = {}) {
  const onAction = vi.fn();
  const onTimelineOpen = vi.fn();
  const view = (extra: Partial<BoardViewProps> = {}) => (
    <BoardView
      incidents={[incident()]}
      eventsById={{}}
      actionState={{}}
      onAction={onAction}
      onTimelineOpen={onTimelineOpen}
      focusIncidentId={null}
      loadError={null}
      loading={false}
      {...props}
      {...extra}
    />
  );
  return { ...render(view()), onAction, onTimelineOpen, view };
}

const raise: ProtocolEvent = {
  schema_version: 1,
  event_id: "e1",
  incident_id: "inc-1",
  sequence: 1,
  type: "raise",
  occurred_at: "2026-11-09T19:00:30Z",
  actor: { id: "incident-api", kind: "system", tier: null },
  state_from: null,
  state_to: "detected",
  payload: { signal_id: "s1" },
  trace_id: null,
};

describe("BoardView", () => {
  it("mounts the isolated evidence inspector for the selected incident", async () => {
    const user = userEvent.setup();
    board({
      incidents: [incident(), incident({ id: "inc-2", summary: "Mic lost" })],
      renderEvidence: (selected) => <p>Inspecting {selected.id}</p>,
    });
    expect(screen.getByText("Inspecting inc-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mic lost" }));
    expect(screen.getByText("Inspecting inc-2")).toBeInTheDocument();
  });

  it("renders buttons only for allowed approve and ack actions", () => {
    const { rerender, view } = board({ incidents: [incident({ allowed_actions: ["approve"] })] });
    expect(screen.getByRole("button", { name: "Approve plan for Room B overflow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge/i })).not.toBeInTheDocument();

    rerender(view({ incidents: [incident({ state: "dispatched", allowed_actions: ["ack"] })] }));
    expect(screen.getByRole("button", { name: "Acknowledge assignment for Room B overflow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();

    rerender(view({ incidents: [incident({ state: "accepted", allowed_actions: ["handoff"] })] }));
    expect(screen.queryByRole("button", { name: /approve|acknowledge|handoff/i })).not.toBeInTheDocument();
    expect(screen.getByText("Handoff available")).toBeInTheDocument();
  });

  it("explains why approve is missing for roles that cannot approve", () => {
    board({ incidents: [incident({ allowed_actions: [] })] });
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByText("Only organizers can approve plans. Switch to Organizer to approve.")).toBeInTheDocument();
  });

  it("approves with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { onAction } = board();
    const button = screen.getByRole("button", { name: "Approve plan for Room B overflow" });
    for (let presses = 0; presses < 4 && document.activeElement !== button; presses += 1) await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "inc-1" }), "approve");
  });

  it("moves focus to the card named by focusIncidentId and shows its detail", () => {
    const two = [incident(), incident({ id: "inc-2", summary: "Mic lost", allowed_actions: [] })];
    const { rerender, view } = board({ incidents: two });
    expect(document.body).toHaveFocus();
    rerender(view({ incidents: two, focusIncidentId: "inc-2" }));
    const card = document.querySelector('[data-incident-id="inc-2"]');
    expect(card).toHaveFocus();
    expect(card?.tagName).toBe("ARTICLE");
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(document.querySelector('[data-detail-for="inc-2"]')).toBeInTheDocument();
  });

  it("disables the button and sets aria-busy while an action runs", () => {
    board({ actionState: { "inc-1": { busy: "approve", error: null } } });
    const button = screen.getByRole("button", { name: "Approving plan for Room B overflow" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it.each<[IncidentState, string]>([
    ["detected", "Detect"],
    ["triaged", "Detect"],
    ["plan_proposed", "Plan"],
    ["approved", "Plan"],
    ["dispatched", "Dispatch"],
    ["accepted", "Dispatch"],
    ["verifying", "Verify"],
    ["resolved", "Verify"],
  ])("maps %s to the %s step and shows the exact state word", (state, phase) => {
    board({ incidents: [incident({ state, allowed_actions: [] })] });
    const bar = screen.getByRole("list", { name: "Incident progress" });
    const current = bar.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(phase);
    const detail = document.querySelector("[data-detail-for]") as HTMLElement;
    const words: Record<string, string> = { plan_proposed: "Plan proposed" };
    const word = words[state] ?? state.charAt(0).toUpperCase() + state.slice(1);
    expect(within(detail).getByText(word, { selector: ".chip" })).toBeInTheDocument();
  });

  it("flags escalated incidents without marking a current step", () => {
    board({ incidents: [incident({ state: "escalated", allowed_actions: [] })] });
    const bar = screen.getByRole("list", { name: "Incident progress" });
    expect(bar.querySelector('[aria-current="step"]')).toBeNull();
    expect(bar.querySelectorAll('[data-status="flag"]')).toHaveLength(4);
    expect(screen.getAllByText("Escalated").length).toBeGreaterThan(0);
  });

  it("shows priority, verifying and passed states as text", () => {
    const { rerender, view } = board({
      incidents: [
        incident({ state: "verifying", allowed_actions: [], verification: { status: "pending", summary: "Door count under 5 for 30 s." } }),
      ],
    });
    expect(screen.getAllByText(/High priority/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Verifying: waiting for evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Door count under 5 for 30 s.")).toBeInTheDocument();

    rerender(
      view({
        incidents: [incident({ state: "resolved", allowed_actions: [], verification: { status: "passed", summary: "Count stayed low." } })],
      }),
    );
    expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
  });

  it("shows venue room names while ids on the wire stay the same", () => {
    board({ incidents: [incident({ room_id: "room-c", summary: "Badge station A stalled", type: "badge_stall" })] });
    expect(screen.getAllByText(/Badge stall in Registration/).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-incident-id="inc-1"]')).toBeInTheDocument();
  });

  it("loads the protocol feed for the selected incident and again when its version changes", () => {
    const { onTimelineOpen, rerender, view } = board({ eventsById: { "inc-1": [raise] } });
    expect(onTimelineOpen).toHaveBeenCalledWith("inc-1");
    expect(onTimelineOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("raise")).toBeInTheDocument();
    expect(screen.getByText("incident-api")).toBeInTheDocument();
    rerender(view({ incidents: [incident({ version: 4 })], eventsById: { "inc-1": [raise] } }));
    expect(onTimelineOpen).toHaveBeenCalledTimes(2);
  });

  it("selecting another incident requests its feed", async () => {
    const user = userEvent.setup();
    const two = [incident(), incident({ id: "inc-2", summary: "Mic lost", type: "stage_av", allowed_actions: [] })];
    const { onTimelineOpen } = board({ incidents: two });
    await user.click(screen.getByRole("button", { name: "Mic lost" }));
    expect(onTimelineOpen).toHaveBeenLastCalledWith("inc-2");
    expect(screen.getByRole("button", { name: "Mic lost" })).toHaveAttribute("aria-current", "true");
  });

  it("scopes action errors to the selected detail or to a card, and load errors to the board", () => {
    const two = [incident(), incident({ id: "inc-2", summary: "Mic lost", allowed_actions: [] })];
    board({
      incidents: two,
      actionState: {
        "inc-1": { busy: null, error: { code: "forbidden", message: "Organizer approval is required." } },
        "inc-2": { busy: null, error: { code: "stale_version", message: "Refresh the incident before taking an action." } },
      },
      loadError: { code: "network", message: "The API did not respond." },
    });
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    const detail = document.querySelector('[data-detail-for="inc-1"]') as HTMLElement;
    expect(within(detail).getByRole("alert")).toHaveTextContent("Organizer approval is required.");
    const card = document.querySelector('[data-incident-id="inc-2"]') as HTMLElement;
    expect(within(card).getByRole("alert")).toHaveTextContent("Refresh the incident");
  });

  it("shows the empty state and keeps live regions out of the board", () => {
    const { container } = board({ incidents: [] });
    expect(screen.getByText("All clear. No open incidents.")).toBeInTheDocument();
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it("renders the presence strip only when presence is provided", () => {
    const { rerender, view } = board();
    expect(screen.queryByText("Checked in")).not.toBeInTheDocument();
    rerender(view({ presence: { attendee: 10, speaker: 2, staff: 3, organizer: 1 } }));
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    rerender(view({ presence: null }));
    expect(screen.queryByText("Checked in")).not.toBeInTheDocument();
  });
});

describe("AppShell", () => {
  const identities = [
    { id: "org", label: "Organizer", tier: 3 as const, description: "Approves plans." },
    { id: "att", label: "Attendee", tier: 0 as const, description: "Reads status." },
  ];

  function shell(route: "board" | "status" | "projector" = "board", mockMode = true) {
    const onNavigate = vi.fn();
    render(
      <AppShell
        route={route}
        onNavigate={onNavigate}
        identities={identities}
        activeIdentityId="org"
        onIdentityChange={vi.fn()}
        mockMode={mockMode}
        token=""
        onTokenChange={vi.fn()}
        announcement="Room B overflow is now Approved."
        devPanel={
          <DevPanel
            onBumpVersion={vi.fn()}
            onProbeDeniedApprove={vi.fn()}
            onDropNextResponse={vi.fn()}
            onReset={vi.fn()}
            onCheckInWave={vi.fn()}
          />
        }
      >
        <p>content</p>
      </AppShell>,
    );
    return { onNavigate };
  }

  it("has one polite live region, a main landmark, nav with aria-current, the privacy note and event context", () => {
    const { onNavigate } = shell("board");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Projector" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText(PRIVACY_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/KubeCon \+ CloudNativeCon North America 2026 at Salt Palace Convention Center/)).toBeInTheDocument();
    screen.getByRole("link", { name: "Attendee status" }).click();
    expect(onNavigate).toHaveBeenCalledWith("status");
  });

  it("offers a labelled role switcher and hides the token field in mock mode", () => {
    shell("board", true);
    const roles = screen.getByRole("group", { name: "Viewing as" });
    expect(within(roles).getByRole("button", { name: "Organizer, tier 3" })).toHaveAttribute("aria-pressed", "true");
    expect(within(roles).getByRole("button", { name: "Attendee, tier 0" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
  });

  it("shows a password token field in live mode", () => {
    shell("board", false);
    expect(screen.getByLabelText("API token")).toHaveAttribute("type", "password");
  });

  it("strips the chrome on the projector route but keeps the live region", () => {
    shell("projector");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Viewing as")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("labels the mock controls including the check-in wave", () => {
    shell("board");
    expect(screen.getByText("Mock controls (rehearsal only)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate a check-in wave (mock)" })).toBeInTheDocument();
  });
});

describe("StatusView", () => {
  const status: PublicStatus = {
    rooms: [
      { room_id: "room-a", label: "Room A", status: "normal", accessibility_status: null },
      { room_id: "room-b", label: "Room B", status: "affected", accessibility_status: "Captions are being restored." },
    ],
    sessions: [{ session_id: "s1", room_id: "room-b", label: "Keynote", status: "recovering", accessibility_status: null }],
  };

  it("shows status as words with venue names and the privacy note", () => {
    render(<StatusView status={status} error={null} variant="attendee" />);
    expect(screen.getByText("Affected")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Recovering")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Room 255 BC" })).toBeInTheDocument();
    expect(screen.getByText("Captions are being restored.")).toBeInTheDocument();
    expect(screen.getByText(PRIVACY_NOTE)).toBeInTheDocument();
  });

  it("makes the most affected room the projector headline with event context and an aria-hidden ticker", () => {
    const { container } = render(<StatusView status={status} error={null} variant="projector" />);
    expect(screen.getByText("KubeCon + CloudNativeCon North America 2026")).toBeInTheDocument();
    const headline = screen.getByLabelText("Most affected room");
    expect(within(headline).getByText("Room 255 BC")).toBeInTheDocument();
    expect(within(headline).getByText("Affected")).toBeInTheDocument();
    expect(container.querySelector(".ticker")).toHaveAttribute("aria-hidden", "true");
  });

  it("states that all rooms are normal when nothing is affected", () => {
    render(
      <StatusView
        status={{ rooms: [{ room_id: "room-a", label: "Room A", status: "normal", accessibility_status: null }], sessions: [] }}
        error={null}
        variant="projector"
      />,
    );
    expect(screen.getByText("All rooms normal.")).toBeInTheDocument();
  });

  it("renders errors as alerts and the presence field only when provided", () => {
    const { rerender } = render(<StatusView status={null} error={{ code: "network", message: "No response." }} variant="projector" />);
    expect(screen.getByRole("alert")).toHaveTextContent("No response.");
    expect(screen.queryByText("Checked in")).not.toBeInTheDocument();
    rerender(
      <StatusView
        status={null}
        error={null}
        variant="attendee"
        presence={{ attendee: 5, speaker: 1, staff: 1, organizer: 1 }}
      />,
    );
    expect(screen.getByText("Checked in")).toBeInTheDocument();
  });
});
