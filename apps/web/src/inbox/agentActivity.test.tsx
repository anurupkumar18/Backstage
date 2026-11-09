import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../api/types";
import { incident } from "../test/incident";
import { deriveAgentActivity } from "./agentActivity";
import { AgentActivity } from "../ui/AgentActivity";

function event(overrides: Partial<ProtocolEvent> = {}): ProtocolEvent {
  return { schema_version: 1, event_id: "e", incident_id: "i", sequence: 1, type: "propose", occurred_at: new Date().toISOString(), actor: { id: "internal-id", kind: "agent", tier: 2 }, state_from: "triaged", state_to: "plan_proposed", payload: { private: "never show this" }, trace_id: null, ...overrides };
}

describe("agent activity", () => {
  it("ignores human events and event caches outside the current incident scope", () => {
    expect(deriveAgentActivity([incident({ id: "i" })], { i: [event({ actor: { id: "organizer", kind: "human", tier: 3 } }), event({ incident_id: "private" })], private: [event()] }).every((item) => item.event === null)).toBe(true);
  });
  it("uses the newest event per domain across incidents", () => {
    const older = event({ occurred_at: "2026-11-09T19:00:00Z", sequence: 100 });
    const newer = event({ incident_id: "j", occurred_at: "2026-11-09T19:01:00Z", sequence: 1 });
    const activity = deriveAgentActivity([incident({ id: "i" }), incident({ id: "j" })], { i: [older], j: [newer] });
    expect(activity[0]?.event).toBe(newer);
    expect(activity.map((item) => item.domain)).toEqual(["venue", "av", "it"]);
  });
  it("renders labelled dots and real text without actor ids, payloads, or another live region", () => {
    const { container } = render(<AgentActivity activity={deriveAgentActivity([incident({ id: "i" })], { i: [event()] })} />);
    expect(screen.getByText("Venue agent")).toBeInTheDocument();
    expect(screen.getByText(/proposed a plan just now/)).toBeInTheDocument();
    expect(container.querySelector('[data-active="true"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(container).not.toHaveTextContent("internal-id");
    expect(container).not.toHaveTextContent("never show this");
  });
});
