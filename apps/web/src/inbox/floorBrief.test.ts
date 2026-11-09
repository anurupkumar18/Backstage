import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../api/types";
import { incident } from "../test/incident";
import { deriveFloorBrief } from "./floorBrief";

const row = incident();
const cutoff = Date.parse("2026-11-09T19:00:00Z");
const event = { incident_id: row.id, occurred_at: "2026-11-09T19:00:30Z", payload: { private: "Jane" } } as unknown as ProtocolEvent;

describe("floor brief", () => {
  it("summarizes a changed incident once and asks for the current human step", () => {
    const lines = deriveFloorBrief([row], { [row.id]: [event, event] }, cutoff);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Your approval is needed");
    expect(lines[0]).not.toContain("Jane");
  });
  it("excludes history already seen and events outside the current scope", () => {
    expect(deriveFloorBrief([row], { [row.id]: [event] }, cutoff + 60_000)).toEqual([]);
    expect(deriveFloorBrief([], { [row.id]: [event] }, 0)).toEqual([]);
    expect(deriveFloorBrief([row], { [row.id]: [{ ...event, incident_id: "foreign" }] }, 0)).toEqual([]);
  });
  it("does not call incomplete evidence verified", () => {
    const lines = deriveFloorBrief([{ ...row, state: "verifying", allowed_actions: [] }], { [row.id]: [event] }, 0);
    expect(lines[0]).toContain("waiting for evidence");
    expect(lines[0]).not.toContain("Your approval");
  });
});
