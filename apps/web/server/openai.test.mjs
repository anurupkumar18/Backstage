import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BRIEFING_TOOLS, createOpenAIServer, parseTriage, redact, scrubReport } from "./openai.mjs";
import { createDemoServer } from "./index.mjs";

const FAKE_KEY = "sk-proj-TESTONLY0123456789abcdefABCDEF";
const MASKED = "sk-proj-****CDEF";

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(url, init);
  };
  return { impl, calls };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function start(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, path, body = {}, headers = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const MINT_OK = () => jsonResponse(200, { value: "ek_test_value", expires_at: 1_900_000_000, session: { type: "transcription" } });

describe("openai routes", () => {
  const logs = [];
  const responses = [];
  let base;
  let server;
  let upstream;
  const env = { OPENAI_API_KEY: FAKE_KEY };

  before(async () => {
    upstream = fakeFetch(MINT_OK);
    server = createOpenAIServer({ env, fetch: (...args) => upstream.impl(...args), log: (line) => logs.push(line), tokensPerMinute: 3 });
    base = await start(server);
  });
  after(() => {
    server.close();
    const everything = logs.join("\n") + responses.join("\n");
    assert.ok(!everything.includes(FAKE_KEY), "key leaked into a response or log line");
    assert.ok(!everything.includes(MASKED), "masked key fragment leaked");
    assert.ok(!everything.includes("ek_test_value") || !logs.join("\n").includes("ek_"), "ephemeral secret logged");
  });

  async function record(response) {
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text) };
  }

  it("healthz reports only whether a key is configured", async () => {
    const { status, json } = await record(await fetch(`${base}/openai/healthz`));
    assert.equal(status, 200);
    assert.equal(json.key_configured, true);
    assert.equal(json.models.transcription, "gpt-live-transcribe");
    assert.ok(!JSON.stringify(json).includes("sk-"));
  });

  it("mints a transcription secret with a fixed server-side session and short expiry", async () => {
    upstream = fakeFetch(MINT_OK);
    const { status, json } = await record(await post(base, "/openai/realtime/token", { session: { model: "gpt-5.5", tools: ["evil"] } }));
    assert.equal(status, 200);
    assert.deepEqual(json, { value: "ek_test_value", expires_at: 1_900_000_000, model: "gpt-live-transcribe", session_type: "transcription" });
    const [call] = upstream.calls;
    assert.equal(call.url, "https://api.openai.com/v1/realtime/client_secrets");
    assert.equal(call.init.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.deepEqual(call.body.expires_after, { anchor: "created_at", seconds: 60 });
    assert.equal(call.body.session.type, "transcription");
    assert.equal(call.body.session.audio.input.transcription.model, "gpt-live-transcribe");
    assert.equal(call.body.session.audio.input.turn_detection, null);
    assert.ok(!JSON.stringify(call.body).includes("evil"), "request body must not shape the session");
  });

  it("mints a briefing secret with exactly the read-only tools", async () => {
    upstream = fakeFetch(() => jsonResponse(200, { value: "ek_test_value", expires_at: 1_900_000_000 }));
    const { status, json } = await record(await post(base, "/openai/briefing/token"));
    assert.equal(status, 200);
    assert.equal(json.session_type, "realtime");
    const session = upstream.calls[0].body.session;
    assert.equal(session.model, "gpt-realtime-2.1");
    assert.deepEqual(session.tools.map((tool) => tool.name).sort(), ["get_incident_events", "get_status", "list_incidents"]);
    assert.equal(session.audio.input.turn_detection, null);
    assert.match(session.instructions, /Never invent numbers/);
    assert.match(session.instructions, /human pressing the Approve button/);
  });

  it("passes upstream errors as a safe message without echoing secrets", async () => {
    upstream = fakeFetch(() =>
      jsonResponse(401, { error: { code: "invalid_api_key", message: `Incorrect API key provided: ${MASKED}. Also ${FAKE_KEY}` } }),
    );
    const { status, json } = await record(await post(base, "/openai/briefing/token"));
    assert.equal(status, 502);
    assert.equal(json.error.code, "upstream_error");
    assert.equal(json.error.upstream_status, 401);
    assert.equal(json.error.upstream_code, "invalid_api_key");
    assert.equal(json.error.message, "OpenAI returned status 401.");
  });

  it("drops an upstream error code that is not a plain identifier", async () => {
    upstream = fakeFetch(() => jsonResponse(400, { error: { code: `bad ${FAKE_KEY}` } }));
    const { json } = await record(await post(base, "/openai/triage", { text: "Projector flickers in Room C." }));
    assert.equal(json.error.upstream_code, undefined);
  });

  it("reports an unreachable upstream", async () => {
    upstream = fakeFetch(() => {
      throw new TypeError(`connect failed with ${FAKE_KEY}`);
    });
    const { status, json } = await record(await post(base, "/openai/triage", { text: "Wi-Fi down." }));
    assert.equal(status, 502);
    assert.equal(json.error.code, "upstream_unreachable");
  });

  it("rejects non-JSON content types and oversized bodies", async () => {
    const text = await record(await post(base, "/openai/triage", "hi", { "Content-Type": "text/plain" }));
    assert.equal(text.status, 415);
    const big = await record(await post(base, "/openai/triage", { text: "x".repeat(5000) }));
    assert.equal(big.status, 413);
  });

  it("rejects callers forwarded from a non-loopback address", async () => {
    const { status, json } = await record(await post(base, "/openai/realtime/token", {}, { "X-Forwarded-For": "10.0.0.7" }));
    assert.equal(status, 403);
    assert.equal(json.error.code, "forbidden");
  });

  it("logs route and status only", () => {
    assert.ok(logs.length > 0);
    for (const line of logs) {
      assert.match(line, /^\[openai\] (GET|POST) \/openai\/[a-z/]+ \d{3} \d+ms$/);
    }
  });
});

describe("rate limiting", () => {
  it("limits token mints per client per minute", async () => {
    let clock = 0;
    const upstream = fakeFetch(MINT_OK);
    const server = createOpenAIServer({ env: { OPENAI_API_KEY: FAKE_KEY }, fetch: upstream.impl, log: () => {}, tokensPerMinute: 2, now: () => clock });
    const base = await start(server);
    try {
      const statuses = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await post(base, "/openai/realtime/token")).status);
      }
      assert.deepEqual(statuses, [200, 200, 429]);
      assert.equal(upstream.calls.length, 2);
      assert.equal((await post(base, "/openai/briefing/token")).status, 200, "limits are per route");
      clock += 61_000;
      assert.equal((await post(base, "/openai/realtime/token")).status, 200, "window slides");
    } finally {
      server.close();
    }
  });
});

describe("no key configured", () => {
  it("returns a clear 503 and never calls upstream", async () => {
    const upstream = fakeFetch(MINT_OK);
    const server = createOpenAIServer({ env: {}, fetch: upstream.impl, log: () => {} });
    const base = await start(server);
    try {
      for (const path of ["/openai/realtime/token", "/openai/briefing/token", "/openai/triage"]) {
        const response = await post(base, path, { text: "Elevator out." });
        const json = await response.json();
        assert.equal(response.status, 503);
        assert.equal(json.error.code, "openai_not_configured");
      }
      const health = await (await fetch(`${base}/openai/healthz`)).json();
      assert.equal(health.key_configured, false);
      assert.equal(upstream.calls.length, 0);
    } finally {
      server.close();
    }
  });
});

describe("triage", () => {
  const decisions = (domain) => ({
    model: "gpt-6-luna",
    answers: [
      domain,
      { type: "predicate", name: "accessibility_impact", probability: 0.97 },
      {
        type: "score",
        name: "urgency",
        score: 2.58,
        confidence: 0.6,
        probabilities: [
          { value: 0, label: "routine", probability: 0 },
          { value: 1, label: "elevated", probability: 0 },
          { value: 2, label: "urgent", probability: 0.42 },
          { value: 3, label: "immediate", probability: 0.58 },
        ],
      },
    ],
  });
  const confident = {
    type: "choice",
    name: "domain",
    choice: "av",
    confidence: 0.94,
    probabilities: [
      { value: "venue", probability: 0.03 },
      { value: "av", probability: 0.94 },
      { value: "it", probability: 0.03 },
    ],
  };

  it("parses a confident answer into the advisory shape", () => {
    const result = parseTriage(decisions(confident), "gpt-6-luna");
    assert.equal(result.domain, "av");
    assert.deepEqual(result.domain_probabilities, { venue: 0.03, av: 0.94, it: 0.03 });
    assert.equal(result.accessibility_impact, 0.97);
    assert.equal(result.urgency_score, 2.58);
    assert.equal(result.urgency_label, "immediate");
    assert.equal(result.confidence, 0.94);
    assert.equal(result.advisory, true);
    assert.equal(result.needs_human, false);
  });

  it("returns domain null with probabilities when confidence is below 0.6", () => {
    const result = parseTriage(decisions({ ...confident, choice: "it", confidence: 0.45 }), "gpt-6-luna");
    assert.equal(result.domain, null);
    assert.equal(result.needs_human, true);
    assert.equal(result.domain_probabilities.av, 0.94);
  });

  it("handles a refusal answer without guessing", () => {
    const result = parseTriage(decisions({ type: "refusal", name: "domain" }), "gpt-6-luna");
    assert.equal(result.domain, null);
    assert.equal(result.confidence, null);
    assert.deepEqual(result.refused, ["domain"]);
    assert.equal(result.urgency_label, "immediate");
  });

  it("sends only the scrubbed report text with the fixed questions", async () => {
    const upstream = fakeFetch(() => jsonResponse(200, decisions(confident)));
    const server = createOpenAIServer({ env: { OPENAI_API_KEY: FAKE_KEY }, fetch: upstream.impl, log: () => {} });
    const base = await start(server);
    try {
      const response = await post(base, "/openai/triage", {
        text: "Mic died in Room B, call me at +1 801 555 0199 or jane@example.com",
        reporter: "Jane Doe",
      });
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.equal(json.domain, "av");
      const body = upstream.calls[0].body;
      assert.equal(upstream.calls[0].url, "https://api.openai.com/v1/decisions");
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.input, "Mic died in Room B, call me at [number] or [email]");
      assert.ok(!JSON.stringify(body).includes("Jane"));
      assert.deepEqual(body.questions.map((question) => question.name), ["domain", "accessibility_impact", "urgency"]);
      assert.equal(body.questions[2].levels.length, 4);
      assert.ok(body.questions[2].levels.every((level) => typeof level.label === "string"));
      const empty = await post(base, "/openai/triage", { text: "   " });
      assert.equal(empty.status, 422);
      const long = await post(base, "/openai/triage", { text: "a ".repeat(400) });
      assert.equal(long.status, 422);
    } finally {
      server.close();
    }
  });
});

describe("helpers and mounting", () => {
  it("redacts key-shaped strings", () => {
    assert.equal(redact(`x ${FAKE_KEY} y`, FAKE_KEY), "x [redacted] y");
    assert.equal(redact(`masked ${MASKED}`, ""), "masked [redacted]");
    assert.equal(redact("ek_68af296e8e40 issued", ""), "[redacted] issued");
  });

  it("scrubs emails and phone numbers from reports", () => {
    assert.equal(scrubReport("Badge printer jam, ping a@b.co or 801-555-0100"), "Badge printer jam, ping [email] or [number]");
  });

  it("declares only read tools", () => {
    for (const tool of BRIEFING_TOOLS) {
      assert.match(tool.name, /^(list_|get_)/);
    }
  });

  it("serves presence and openai from one server", async () => {
    const server = createDemoServer({ openai: { env: {}, log: () => {} } });
    const base = await start(server);
    try {
      assert.equal((await fetch(`${base}/presence/healthz`)).status, 200);
      assert.equal((await fetch(`${base}/openai/healthz`)).status, 200);
      assert.equal((await fetch(`${base}/nope`)).status, 404);
    } finally {
      server.close();
    }
  });
});
