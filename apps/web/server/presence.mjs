import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const TIERS = ["attendee", "speaker", "staff", "organizer"];
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY_BYTES = 1024;

function emptyCounts() {
  return Object.fromEntries(TIERS.map((tier) => [tier, 0]));
}

/**
 * Anonymous presence counts per tier. Stores one opaque device id per person and nothing else.
 * Interim service until the incident API publishes presence; in-memory, resets on restart.
 */
export function createPresence({ maxPeople = 2000, joinsPerMinute = 30, now = () => Date.now() } = {}) {
  const devices = new Map();
  const joinLog = new Map();

  function counts() {
    const result = emptyCounts();
    for (const tier of devices.values()) {
      result[tier] += 1;
    }
    return result;
  }

  function limited(client) {
    const cutoff = now() - 60_000;
    const recent = (joinLog.get(client) ?? []).filter((time) => time > cutoff);
    if (recent.length >= joinsPerMinute) {
      joinLog.set(client, recent);
      return true;
    }
    recent.push(now());
    joinLog.set(client, recent);
    return false;
  }

  return {
    counts,
    join(client, deviceId, tier) {
      if (!TIERS.includes(tier) || !DEVICE_ID.test(deviceId ?? "")) {
        return { status: 422, body: { error: { code: "invalid_payload", message: "tier or device_id is invalid." } } };
      }
      if (limited(client)) {
        return { status: 429, body: { error: { code: "rate_limited", message: "Too many joins. Try again in a minute." } } };
      }
      if (!devices.has(deviceId) && devices.size >= maxPeople) {
        return { status: 503, body: { error: { code: "unavailable", message: "The floor is full." } } };
      }
      devices.set(deviceId, tier);
      return { status: 200, body: { tier, counts: counts() } };
    },
    leave(deviceId) {
      devices.delete(deviceId);
      return { status: 200, body: { counts: counts() } };
    },
    reset() {
      devices.clear();
      joinLog.clear();
      return { status: 200, body: { counts: counts() } };
    },
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("bad_json"));
      }
    });
    request.on("error", reject);
  });
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function createPresenceServer(options = {}) {
  const presence = createPresence(options);
  return createServer(async (request, response) => {
    const send = ({ status, body }) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const path = (request.url ?? "").split("?")[0];
    const client = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";

    if (request.method === "GET" && path === "/presence") {
      return send({ status: 200, body: { counts: presence.counts() } });
    }
    if (request.method === "GET" && path === "/presence/healthz") {
      return send({ status: 200, body: { status: "ok" } });
    }
    if (request.method === "POST" && path === "/presence/reset") {
      if (!isLoopback(request.socket.remoteAddress ?? "") || request.headers["x-forwarded-for"]) {
        return send({ status: 403, body: { error: { code: "forbidden", message: "Reset is local only." } } });
      }
      return send(presence.reset());
    }
    if ((request.method === "POST" || request.method === "DELETE") && path === "/presence/join") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        return send({ status: 422, body: { error: { code: "invalid_payload", message: "Body must be small valid JSON." } } });
      }
      return send(request.method === "POST" ? presence.join(client, body.device_id, body.tier) : presence.leave(body.device_id));
    }
    return send({ status: 404, body: { error: { code: "not_found", message: "Route not found." } } });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PRESENCE_PORT ?? 8787);
  createPresenceServer({ maxPeople: Number(process.env.PRESENCE_MAX ?? 2000) }).listen(port, process.env.PRESENCE_HOST ?? "127.0.0.1", () => {
    console.log(`presence relay on port ${port}`);
  });
}
