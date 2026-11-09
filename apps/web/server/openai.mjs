import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/**
 * OpenAI routes under /openai. The standard API key is read from process env on every call and never
 * leaves this process: the browser receives only short-lived ephemeral client secrets (ek_...) whose
 * session config is fixed here, or advisory triage numbers. Request bodies never choose models or tools.
 */

const OPENAI_BASE = "https://api.openai.com/v1";
const MAX_BODY_BYTES = 4096;
const MAX_REPORT_CHARS = 600;
const UPSTREAM_TIMEOUT_MS = 10_000;
const DOMAIN_CONFIDENCE_FLOOR = 0.6;
const SAFE_CODE = /^[a-z0-9_.]{1,64}$/;

export const DEFAULT_MODELS = {
  transcription: "gpt-live-transcribe",
  briefing: "gpt-realtime-2.1",
  decisions: "gpt-6-luna",
};

/** Read-only incident API tools. The browser executor enforces the same allowlist (src/voice/briefingTools.ts). */
export const BRIEFING_TOOLS = [
  {
    type: "function",
    name: "list_incidents",
    description: "List incidents in the organizer's scope with state, priority, room and family.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_incident_events",
    description: "Read the protocol events of one incident in sequence order: raise, propose, approve, dispatch, ack, verify.",
    parameters: {
      type: "object",
      properties: { incident_id: { type: "string", description: "Incident id exactly as returned by list_incidents." } },
      required: ["incident_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_status",
    description: "Read the sanitized public status shown on the projector.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const BRIEFING_INSTRUCTIONS = [
  "You are Backstage, a read-only voice briefing for the conference organizer.",
  "Before answering, call list_incidents, and get_incident_events for any incident you describe. Use get_status for the public view.",
  "Speak in short plain sentences. Lead with the highest priority incident: its room, state, verification status, and the one thing a human must do next.",
  "Only state facts present in tool results. Never invent numbers, names, times, or counts. If data is missing or a tool fails, say so plainly.",
  "You cannot approve, acknowledge, hand off, or change anything. Approval is a human pressing the Approve button on the board; say so when approval is pending.",
  "Do not give generic advice. If nothing is active, say the board is green in one sentence.",
].join(" ");

const DOMAIN_CHOICES = [
  { value: "venue", description: "Rooms and floor: crowding, overflow, doors, seating, elevators, ramps, step-free access, signage, temperature." },
  { value: "av", description: "Audio and video: microphones, speakers, captions, projectors, screens, stage equipment, streaming." },
  { value: "it", description: "IT: Wi-Fi, network, badge printing, check-in kiosks, registration systems, laptops." },
];

const URGENCY_LEVELS = [
  { label: "routine", description: "Can wait for the next break; no attendee is blocked." },
  { label: "elevated", description: "Degrades the experience for some attendees; fix within about 15 minutes." },
  { label: "urgent", description: "Blocks a session, a room, or a group of attendees now." },
  { label: "immediate", description: "Safety risk or an attendee who cannot participate at all right now, including accessibility loss." },
];

export const TRIAGE_QUESTIONS = [
  {
    type: "choice",
    name: "domain",
    instructions: "Which staff domain should handle this conference floor report?",
    choices: DOMAIN_CHOICES,
  },
  {
    type: "predicate",
    name: "accessibility_impact",
    instructions:
      "The problem prevents or degrades access for attendees with disabilities, for example lost captions, a broken elevator, or a blocked step-free route.",
  },
  {
    type: "score",
    name: "urgency",
    instructions: "How urgently does a human need to act on this report?",
    levels: URGENCY_LEVELS,
  },
];

function transcriptionSession(model) {
  return {
    type: "transcription",
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: { model },
        turn_detection: null,
      },
    },
  };
}

function briefingSession(model) {
  return {
    type: "realtime",
    model,
    instructions: BRIEFING_INSTRUCTIONS,
    output_modalities: ["audio"],
    max_output_tokens: 600,
    tools: BRIEFING_TOOLS,
    tool_choice: "auto",
    audio: {
      input: { noise_reduction: { type: "near_field" }, turn_detection: null },
      output: { voice: "marin" },
    },
  };
}

function isLoopback(address) {
  const value = (address ?? "").trim();
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

/** Local means a loopback socket and, when a proxy forwarded the request, only loopback hops. */
export function isLocalRequest(request) {
  if (!isLoopback(request.socket?.remoteAddress)) {
    return false;
  }
  const forwarded = request.headers["x-forwarded-for"];
  if (!forwarded) {
    return true;
  }
  return String(forwarded)
    .split(",")
    .every((hop) => isLoopback(hop));
}

function clientId(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return (forwarded ? String(forwarded).split(",")[0]?.trim() : "") || request.socket?.remoteAddress || "unknown";
}

function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (failed) {
        return;
      }
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error("too_large"), { code: "too_large" }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (failed) {
        return;
      }
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("bad_json"), { code: "bad_json" }));
      }
    });
    request.on("error", reject);
  });
}

function error(status, code, message) {
  return { status, body: { error: { code, message } } };
}

/** Strips anything shaped like a secret. Applied to every log line and every outgoing error message. */
export function redact(text, key) {
  let out = String(text);
  if (key) {
    out = out.split(key).join("[redacted]");
  }
  return out.replace(/\b(sk|ek|rk)[-_][A-Za-z0-9_*-]{6,}/g, "[redacted]");
}

/** Drops obvious identifiers before a report leaves for OpenAI. The report text itself is all we send. */
export function scrubReport(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
}

function probabilityMap(answer) {
  const map = {};
  for (const entry of answer?.probabilities ?? []) {
    if (typeof entry?.value === "string" && typeof entry.probability === "number") {
      map[entry.value] = entry.probability;
    }
  }
  return map;
}

/** Maps a Decisions API response to the advisory triage shape. Refusals and low confidence yield nulls. */
export function parseTriage(json, model) {
  const answers = Array.isArray(json?.answers) ? json.answers : [];
  const byName = new Map(answers.map((answer) => [answer?.name, answer]));
  const refused = answers.filter((answer) => answer?.type === "refusal").map((answer) => String(answer.name));

  const domainAnswer = byName.get("domain");
  const domainOk = domainAnswer?.type === "choice";
  const confidence = domainOk && typeof domainAnswer.confidence === "number" ? domainAnswer.confidence : null;
  const domainProbabilities = domainOk ? probabilityMap(domainAnswer) : {};
  const chosen = domainOk && DOMAIN_CHOICES.some((choice) => choice.value === domainAnswer.choice) ? domainAnswer.choice : null;
  const domain = chosen && confidence !== null && confidence >= DOMAIN_CONFIDENCE_FLOOR ? chosen : null;

  const access = byName.get("accessibility_impact");
  const accessibility = access?.type === "predicate" && typeof access.probability === "number" ? access.probability : null;

  const urgency = byName.get("urgency");
  let urgencyScore = null;
  let urgencyLabel = null;
  const urgencyProbabilities = {};
  if (urgency?.type === "score" && typeof urgency.score === "number") {
    urgencyScore = urgency.score;
    let best = -1;
    for (const entry of urgency.probabilities ?? []) {
      if (typeof entry?.label === "string" && typeof entry.probability === "number") {
        urgencyProbabilities[entry.label] = entry.probability;
        if (entry.probability > best) {
          best = entry.probability;
          urgencyLabel = entry.label;
        }
      }
    }
  }

  return {
    domain,
    domain_probabilities: domainProbabilities,
    accessibility_impact: accessibility,
    urgency_score: urgencyScore,
    urgency_label: urgencyLabel,
    urgency_probabilities: urgencyProbabilities,
    confidence,
    needs_human: domain === null,
    refused,
    advisory: true,
    model,
  };
}

function rateLimiter(perMinute, now) {
  const log = new Map();
  return (client) => {
    const cutoff = now() - 60_000;
    const recent = (log.get(client) ?? []).filter((time) => time > cutoff);
    const limited = recent.length >= perMinute;
    if (!limited) {
      recent.push(now());
    }
    log.set(client, recent);
    return limited;
  };
}

export function createOpenAIRoutes({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  log = (line) => console.log(line),
  allowRemote = env.OPENAI_ALLOW_REMOTE === "1",
  tokensPerMinute = 6,
  triagePerMinute = 20,
  ttlSeconds = 60,
} = {}) {
  const models = {
    transcription: env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_MODELS.transcription,
    briefing: env.OPENAI_BRIEFING_MODEL || DEFAULT_MODELS.briefing,
    decisions: env.OPENAI_DECISIONS_MODEL || DEFAULT_MODELS.decisions,
  };
  const limiters = {
    "/openai/realtime/token": rateLimiter(tokensPerMinute, now),
    "/openai/briefing/token": rateLimiter(tokensPerMinute, now),
    "/openai/triage": rateLimiter(triagePerMinute, now),
  };
  const apiKey = () => (typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY.trim() : "");

  async function callOpenAI(path, body) {
    const key = apiKey();
    let response;
    try {
      response = await fetchImpl(`${OPENAI_BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return { failure: error(502, "upstream_unreachable", "Could not reach OpenAI.") };
    }
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.status < 200 || response.status >= 300) {
      const upstreamCode = typeof json?.error?.code === "string" && SAFE_CODE.test(json.error.code) ? json.error.code : null;
      const failure = error(502, "upstream_error", `OpenAI returned status ${response.status}.`);
      failure.body.error.upstream_status = response.status;
      if (upstreamCode) {
        failure.body.error.upstream_code = upstreamCode;
      }
      return { failure };
    }
    return { json };
  }

  async function mint(session, model) {
    const { json, failure } = await callOpenAI("/realtime/client_secrets", {
      expires_after: { anchor: "created_at", seconds: ttlSeconds },
      session,
    });
    if (failure) {
      return failure;
    }
    if (typeof json?.value !== "string" || typeof json?.expires_at !== "number") {
      return error(502, "upstream_invalid", "OpenAI returned an unexpected client secret shape.");
    }
    return { status: 200, body: { value: json.value, expires_at: json.expires_at, model, session_type: session.type } };
  }

  async function triage(body) {
    const text = typeof body?.text === "string" ? scrubReport(body.text) : "";
    if (!text || text.length > MAX_REPORT_CHARS) {
      return error(422, "invalid_payload", `text must be 1 to ${MAX_REPORT_CHARS} characters.`);
    }
    const { json, failure } = await callOpenAI("/decisions", { model: models.decisions, input: text, questions: TRIAGE_QUESTIONS });
    if (failure) {
      return failure;
    }
    return { status: 200, body: parseTriage(json, models.decisions) };
  }

  async function route(request, path) {
    if (path === "/openai/healthz") {
      if (request.method !== "GET") {
        return error(405, "method_not_allowed", "Use GET.");
      }
      return { status: 200, body: { status: "ok", key_configured: apiKey().length > 0, models } };
    }
    if (!(path in limiters)) {
      return error(404, "not_found", "Route not found.");
    }
    if (request.method !== "POST") {
      return error(405, "method_not_allowed", "Use POST.");
    }
    if (!allowRemote && !isLocalRequest(request)) {
      return error(403, "forbidden", "OpenAI routes are local only. Set OPENAI_ALLOW_REMOTE=1 behind an authenticated proxy.");
    }
    if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
      return error(415, "unsupported_media_type", "Send Content-Type: application/json.");
    }
    let body;
    try {
      body = await readJson(request, MAX_BODY_BYTES);
    } catch (failure) {
      return failure?.code === "too_large"
        ? error(413, "too_large", `Body must be at most ${MAX_BODY_BYTES} bytes.`)
        : error(422, "invalid_payload", "Body must be valid JSON.");
    }
    if (limiters[path](clientId(request))) {
      return error(429, "rate_limited", "Too many requests. Try again in a minute.");
    }
    if (!apiKey()) {
      return error(503, "openai_not_configured", "OPENAI_API_KEY is not set on the server. Source the local secrets file and restart.");
    }
    if (path === "/openai/realtime/token") {
      return mint(transcriptionSession(models.transcription), models.transcription);
    }
    if (path === "/openai/briefing/token") {
      return mint(briefingSession(models.briefing), models.briefing);
    }
    return triage(body);
  }

  /** Returns false when the path is not under /openai so the caller can try other routes. */
  async function handle(request, response) {
    const path = (request.url ?? "").split("?")[0];
    if (path !== "/openai" && !path.startsWith("/openai/")) {
      return false;
    }
    const started = now();
    let result;
    try {
      result = await route(request, path);
    } catch {
      result = error(500, "internal", "Unexpected server error.");
    }
    if (result.body?.error?.message) {
      result.body.error.message = redact(result.body.error.message, apiKey());
    }
    const payload = JSON.stringify(result.body);
    response.writeHead(result.status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(payload);
    log(redact(`[openai] ${request.method} ${path} ${result.status} ${now() - started}ms`, apiKey()));
    return true;
  }

  return { handle, models };
}

export function createOpenAIServer(options = {}) {
  const routes = createOpenAIRoutes(options);
  return createServer(async (request, response) => {
    if (!(await routes.handle(request, response))) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "not_found", message: "Route not found." } }));
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.OPENAI_PORT ?? 8788);
  createOpenAIServer().listen(port, process.env.OPENAI_HOST ?? "127.0.0.1", () => {
    console.log(`openai routes on port ${port}`);
  });
}
