import { describe, expect, it, vi } from "vitest";
import { incident } from "../test/incident";
import { createBriefingTools } from "./briefingTools";

function setup(tier = 3) {
  const client = {
    getStatus: vi.fn(async () => ({ ok: true as const, data: { rooms: [], sessions: [] } })),
    listIncidents: vi.fn(async () => ({ ok: true as const, data: { items: [incident()], next_cursor: null } })),
    listEvents: vi.fn(async () => ({ ok: true as const, data: { items: [], next_cursor: null } })),
    applyAction: vi.fn(),
  };
  return { client, run: createBriefingTools(client, tier) };
}

describe("voice tool boundary", () => {
  it.each(["approve", "ack", "handoff", "applyAction", "POST", "__proto__", "/api/v1/incidents/x/actions"])("rejects %s without executing anything", async (name) => {
    const { client, run } = setup();
    expect(await run(name, "{}")).toEqual({ error: "tool_not_allowed" });
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });
  it("limits attendee tools to public status", async () => {
    const { client, run } = setup(0);
    expect(await run("list_incidents", "{}")).toEqual({ error: "tool_not_allowed" });
    expect(await run("get_status", "{}")).toEqual({ rooms: [], sessions: [] });
    expect(client.listIncidents).not.toHaveBeenCalled();
  });
  it("does not send plan text, summaries, staff identities or trace ids to the model", async () => {
    const { run } = setup();
    const result = await run("list_incidents", "{}");
    expect(result).toMatchObject({ items: [{ id: "opaque-live-id-123", state: "plan_proposed" }] });
    expect(JSON.stringify(result)).not.toMatch(/summary|trace_id|assignment|Hold entry/);
  });
  it("requires the incident to be in the current token's list before reading events", async () => {
    const { client, run } = setup();
    expect(await run("get_incident_events", '{"incident_id":"private"}')).toEqual({ error: "not_found" });
    expect(client.listEvents).not.toHaveBeenCalled();
    await run("get_incident_events", '{"incident_id":"opaque-live-id-123"}');
    expect(client.listEvents).toHaveBeenCalledExactlyOnceWith("opaque-live-id-123");
  });
  it.each(["null", "[]", "invalid", '{"url":"/actions"}'])("rejects malformed or extra arguments %s", async (args) => {
    const { client, run } = setup();
    await run("get_status", args);
    expect(client.getStatus).not.toHaveBeenCalled();
  });
});
