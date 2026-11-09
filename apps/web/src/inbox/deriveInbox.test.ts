import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../api/types";
import { deriveInbox } from "./deriveInbox";
import { inboxVerification } from "./copy";

import { incident } from "../test/incident";

const seen = Date.parse("2026-11-09T19:01:00Z");

describe("role-scoped inbox derivation", () => {
  it.each([0, 1, 2, 3] as const)("uses only current-token actions for tier %i", (tier) => {
    const items = deriveInbox([incident({ allowed_actions: [] })], {}, { tier }, seen);
    expect(items).toHaveLength(tier === 0 ? 0 : 1);
    expect(items.every((item) => item.action === null)).toBe(true);
  });

  it("puts actionable cards before priority and then sorts by recency", () => {
    const items = deriveInbox([
      incident({ id: "high-watching", allowed_actions: [] }),
      incident({ id: "normal-needs-you", priority: "normal" }),
      incident({ id: "high-new", updated_at: "2026-11-09T19:03:00Z" }),
      incident({ id: "high-old" }),
    ], {}, { tier: 3 }, seen);
    expect(items.map((item) => item.incident.id)).toEqual(["high-new", "high-old", "normal-needs-you", "high-watching"]);
  });

  it("offers staff accept only when the API permits the assigned action", () => {
    const assigned = incident({ state: "dispatched", assignment: { id: "a", assignee_id: "staff", domain: "venue" }, allowed_actions: ["ack"] });
    expect(deriveInbox([assigned], {}, { tier: 2 }, seen)[0]).toMatchObject({ kind: "needs_you", action: "ack" });
    expect(deriveInbox([{ ...assigned, allowed_actions: [] }], {}, { tier: 2 }, seen)[0]?.action).toBeNull();
    expect(deriveInbox([{ ...assigned, assignment: null }], {}, { tier: 2 }, seen)[0]?.action).toBeNull();
  });

  it.each(["accepted", "verifying", "escalated", "resolved"] as const)("never approves a %s incident with a stale allowlist", (state) => {
    expect(deriveInbox([incident({ state })], {}, { tier: 3 }, seen)[0]?.action).toBeNull();
  });

  it("uses state transitions newer than lastSeen for an update", () => {
    const current = incident({ allowed_actions: [] });
    const event = { incident_id: current.id, occurred_at: "2026-11-09T19:02:00Z", state_from: "approved", state_to: "dispatched" } as ProtocolEvent;
    expect(deriveInbox([current], { [current.id]: [event] }, { tier: 2 }, seen)[0]?.kind).toBe("update");
    expect(deriveInbox([current], { [current.id]: [{ ...event, incident_id: "another" }] }, { tier: 2 }, seen)[0]?.kind).toBe("watching");
  });

  it("marks verified only after resolved plus passed evidence", () => {
    const pending = incident({ state: "verifying", allowed_actions: [], verification: { status: "passed", summary: "Evidence received" } });
    expect(deriveInbox([pending], {}, { tier: 3 }, seen)[0]?.kind).not.toBe("resolved");
    expect(inboxVerification(pending)).toBe("Verifying: waiting for evidence");
    const closed = { ...pending, state: "resolved" as const };
    expect(deriveInbox([closed], {}, { tier: 3 }, seen)[0]?.kind).toBe("resolved");
    expect(inboxVerification(closed)).toBe("Verified");
    expect(inboxVerification({ ...closed, verification: { status: "pending", summary: null } })).not.toBe("Verified");
  });
});
