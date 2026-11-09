import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createPresence, createPresenceServer } from "./presence.mjs";

describe("presence store", () => {
  it("counts one person per device and moves them when the tier changes", () => {
    const presence = createPresence();
    presence.join("a", "device-0001", "attendee");
    presence.join("a", "device-0001", "attendee");
    presence.join("b", "device-0002", "speaker");
    assert.deepEqual(presence.counts(), { attendee: 1, speaker: 1, staff: 0, organizer: 0 });
    presence.join("a", "device-0001", "staff");
    assert.deepEqual(presence.counts(), { attendee: 0, speaker: 1, staff: 1, organizer: 0 });
  });

  it("rejects unknown tiers and malformed device ids", () => {
    const presence = createPresence();
    assert.equal(presence.join("a", "device-0001", "admin").status, 422);
    assert.equal(presence.join("a", "short", "attendee").status, 422);
    assert.equal(presence.join("a", undefined, "attendee").status, 422);
  });

  it("rate limits per client and recovers after a minute", () => {
    let clock = 0;
    const presence = createPresence({ joinsPerMinute: 2, now: () => clock });
    assert.equal(presence.join("a", "device-0001", "attendee").status, 200);
    assert.equal(presence.join("a", "device-0002", "attendee").status, 200);
    assert.equal(presence.join("a", "device-0003", "attendee").status, 429);
    assert.equal(presence.join("b", "device-0004", "attendee").status, 200);
    clock = 61_000;
    assert.equal(presence.join("a", "device-0003", "attendee").status, 200);
  });

  it("caps the floor but still lets known devices change tier", () => {
    const presence = createPresence({ maxPeople: 1 });
    assert.equal(presence.join("a", "device-0001", "attendee").status, 200);
    assert.equal(presence.join("b", "device-0002", "attendee").status, 503);
    assert.equal(presence.join("a", "device-0001", "speaker").status, 200);
  });

  it("removes a person on leave", () => {
    const presence = createPresence();
    presence.join("a", "device-0001", "attendee");
    assert.equal(presence.leave("device-0001").body.counts.attendee, 0);
  });
});

describe("presence http", () => {
  let server;
  let base;

  before(async () => {
    server = createPresenceServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it("joins, reads counts and stores nothing but counts", async () => {
    const joined = await fetch(`${base}/presence/join`, {
      method: "POST",
      body: JSON.stringify({ device_id: "device-abcdef", tier: "speaker" }),
    });
    assert.equal(joined.status, 200);
    const read = await (await fetch(`${base}/presence`)).json();
    assert.deepEqual(read, { counts: { attendee: 0, speaker: 1, staff: 0, organizer: 0 } });
  });

  it("refuses oversized and invalid bodies", async () => {
    const big = await fetch(`${base}/presence/join`, { method: "POST", body: "x".repeat(5000) }).catch(() => null);
    assert.ok(big === null || big.status === 422);
    const bad = await fetch(`${base}/presence/join`, { method: "POST", body: "not json" });
    assert.equal(bad.status, 422);
  });

  it("allows reset only without a forwarding header", async () => {
    const forwarded = await fetch(`${base}/presence/reset`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal(forwarded.status, 403);
    const local = await fetch(`${base}/presence/reset`, { method: "POST" });
    assert.equal(local.status, 200);
    assert.deepEqual((await local.json()).counts, { attendee: 0, speaker: 0, staff: 0, organizer: 0 });
  });
});
