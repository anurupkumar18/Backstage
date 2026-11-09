import examples from "@fixtures/http.examples.json";
import openapiRaw from "@contracts/openapi.yaml?raw";
import protocolSchema from "@contracts/protocol.v1.schema.json";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createClient, newIntent, type ActionIntent } from "../api/client";
import type { Incident } from "../api/types";
import { MockIncidentApi } from "./store";
import { createMockTransport, MOCK_PRINCIPALS } from "./transport";

const INCIDENT = "inc-overflow-room-b";
const TICK_MS = 1000;

interface Example {
  scenario: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
}

function fixtureResponse(method: string, path: string, status: number): Record<string, unknown> {
  const found = (examples as unknown as Example[]).find(
    (example) =>
      example.scenario === "overflow" && example.method === method && example.path === path && example.status === status,
  );
  if (!found) {
    throw new Error("fixture missing");
  }
  return found.response as Record<string, unknown>;
}

function withoutTime(incident: unknown): Record<string, unknown> {
  const { updated_at: _updatedAt, ...rest } = incident as Record<string, unknown>;
  return rest;
}

function setup(token = "mock-organizer") {
  const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS, dispatchDelayMs: 500, tickMs: TICK_MS });
  const session = { token };
  const client = createClient({ transport: createMockTransport(api), getToken: () => session.token });
  return { api, client, session };
}

function approveIntent(version: number): ActionIntent {
  return newIntent(INCIDENT, { action: "approve", expected_version: version, payload: { plan_id: "plan-overflow-1" } });
}

function ackIntent(version: number): ActionIntent {
  return newIntent(INCIDENT, {
    action: "ack",
    expected_version: version,
    payload: { assignment_id: "assignment-overflow-1", decision: "accepted" },
  });
}

async function approveAndDispatch(ctx: ReturnType<typeof setup>): Promise<void> {
  const approved = await ctx.client.applyAction(approveIntent(3));
  expect(approved.ok).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  ctx.session.token = "mock-venue-staff-01";
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mock matches shared fixtures", () => {
  it("serves the plan_proposed incident for the organizer", async () => {
    const { client } = setup();
    const result = await client.getIncident(INCIDENT);
    expect(result.ok && withoutTime(result.data)).toEqual(
      withoutTime(fixtureResponse("GET", `/api/v1/incidents/${INCIDENT}`, 200)),
    );
  });

  it("returns the fixture approve and ack responses", async () => {
    const ctx = setup();
    const approved = await ctx.client.applyAction(approveIntent(3));
    expect(approved.ok && withoutTime(approved.data)).toEqual(
      withoutTime(fixtureResponse("POST", `/api/v1/incidents/${INCIDENT}/actions`, 200)),
    );
    await vi.advanceTimersByTimeAsync(600);
    ctx.session.token = "mock-venue-staff-01";
    const dispatched = await ctx.client.getIncident(INCIDENT);
    expect(dispatched.ok && dispatched.data.state).toBe("dispatched");
    expect(dispatched.ok && dispatched.data.version).toBe(5);
    expect(dispatched.ok && dispatched.data.allowed_actions).toContain("ack");
    const accepted = await ctx.client.applyAction(ackIntent(5));
    const ackFixture = (examples as unknown as Example[]).find(
      (example) => example.scenario === "overflow" && example.method === "POST" && example.status === 200 && JSON.stringify(example.response).includes('"accepted"'),
    );
    expect(accepted.ok && withoutTime(accepted.data)).toEqual(withoutTime(ackFixture?.response));
  });
});

describe("role and conflict handling", () => {
  it("rejects approve from a tier-2 identity with 403 and the fixture message", async () => {
    const { client } = setup("mock-venue-staff-01");
    const result = await client.applyAction(approveIntent(3));
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "forbidden",
      message: (fixtureResponse("POST", `/api/v1/incidents/${INCIDENT}/actions`, 403) as { error: { message: string } }).error.message,
    });
  });

  it("denies incident reads to a tier-0 identity but serves public status", async () => {
    const { client } = setup("mock-attendee");
    expect(await client.listIncidents()).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect((await client.getStatus()).ok).toBe(true);
  });

  it("returns 401 for an unknown token", async () => {
    const { client } = setup("not-a-token");
    expect(await client.listIncidents()).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
  });

  it("returns 409 stale_version after a concurrent update and applies nothing", async () => {
    const { api, client } = setup();
    api.bumpVersion();
    const stale = await client.applyAction(approveIntent(3));
    expect(stale).toMatchObject({ ok: false, status: 409, code: "stale_version" });
    const current = await client.getIncident(INCIDENT);
    expect(current.ok && current.data.state).toBe("plan_proposed");
    const fresh = await client.applyAction(approveIntent(4));
    expect(fresh.ok && fresh.data.state).toBe("approved");
  });
});

describe("idempotency", () => {
  it("replays the identical response for the same key and body without a second transition", async () => {
    const { client } = setup();
    const intent = approveIntent(3);
    const first = await client.applyAction(intent);
    const second = await client.applyAction(intent);
    expect(second).toEqual(first);
    const events = await client.listEvents(INCIDENT);
    expect(events.ok && events.data.items.filter((event) => event.type === "approve")).toHaveLength(1);
    const current = await client.getIncident(INCIDENT);
    expect(current.ok && current.data.version).toBe(4);
  });

  it("rejects a reused key with a different body", async () => {
    const { client } = setup();
    const intent = approveIntent(3);
    await client.applyAction(intent);
    const reused = await client.applyAction({ ...intent, body: { ...intent.body, expected_version: 4 } });
    expect(reused).toMatchObject({ ok: false, status: 409, code: "idempotency_conflict" });
  });

  it("retries a lost response with the same key and commits once", async () => {
    const { api, client } = setup();
    api.dropNextResponse();
    const result = await client.applyAction(approveIntent(3));
    expect(result.ok && result.data.state).toBe("approved");
    const events = await client.listEvents(INCIDENT);
    expect(events.ok && events.data.items.filter((event) => event.type === "approve")).toHaveLength(1);
  });

  it("reports a network error once retries are exhausted", async () => {
    const client = createClient({
      transport: () => Promise.reject(new TypeError("offline")),
      getToken: () => "x",
      maxRetries: 1,
    });
    expect(await client.applyAction(approveIntent(3))).toMatchObject({ ok: false, status: 0, code: "network" });
  });
});

describe("verification gating", () => {
  it("stays in verifying until the full 60 second clearing window is observed", async () => {
    const ctx = setup();
    await approveAndDispatch(ctx);
    const accepted = await ctx.client.applyAction(ackIntent(5));
    expect(accepted.ok && accepted.data.state).toBe("accepted");
    expect(accepted.ok && accepted.data.verification.status).toBe("pending");

    const states: string[] = [];
    for (let tick = 0; tick < 5; tick += 1) {
      await vi.advanceTimersByTimeAsync(TICK_MS);
      const current = await ctx.client.getIncident(INCIDENT);
      if (current.ok) {
        states.push(current.data.state);
      }
    }
    expect(states).toEqual(["verifying", "verifying", "verifying", "verifying", "resolved"]);

    const final = await ctx.client.getIncident(INCIDENT);
    expect(final.ok && final.data.verification.status).toBe("passed");
    const events = await ctx.client.listEvents(INCIDENT);
    const close = events.ok ? events.data.items.find((event) => event.type === "close") : undefined;
    expect(close?.payload.evidence_signal_ids).toHaveLength(5);
  });

  it("never resolves if the approve and ack steps are skipped", async () => {
    const { client } = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    const current = await client.getIncident(INCIDENT);
    expect(current.ok && current.data.state).toBe("plan_proposed");
  });
});

describe("contract validation", () => {
  const spec = parse(openapiRaw) as { components: { schemas: Record<string, object> } };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validateIncident = ajv.compile(spec.components.schemas.Incident as object);
  const validateEvent = ajv.compile(protocolSchema);
  const validateAction = ajv.compile(spec.components.schemas.Action as object);
  const validateStatus = ajv.compile(spec.components.schemas.PublicStatus as object);

  it("emits schema-valid incidents, events and status across the whole lifecycle", async () => {
    const ctx = setup();
    const incidents: Incident[] = [];
    const snapshot = async () => {
      const result = await ctx.client.getIncident(INCIDENT);
      if (result.ok) {
        incidents.push(result.data);
      }
    };
    await snapshot();
    await approveAndDispatch(ctx);
    await snapshot();
    await ctx.client.applyAction(ackIntent(5));
    await snapshot();
    for (let tick = 0; tick < 5; tick += 1) {
      await vi.advanceTimersByTimeAsync(TICK_MS);
      await snapshot();
    }
    for (const incident of incidents) {
      expect(validateIncident(incident), JSON.stringify(validateIncident.errors)).toBe(true);
    }
    const events = await ctx.client.listEvents(INCIDENT);
    expect(events.ok).toBe(true);
    for (const event of events.ok ? events.data.items : []) {
      expect(validateEvent(event), JSON.stringify([event.type, validateEvent.errors])).toBe(true);
    }
    const status = await ctx.client.getStatus();
    expect(validateStatus(status.ok && status.data)).toBe(true);
  });

  it("builds action bodies that satisfy the Action schema", () => {
    for (const intent of [approveIntent(3), ackIntent(5)]) {
      expect(validateAction(intent.body), JSON.stringify(validateAction.errors)).toBe(true);
    }
  });
});
