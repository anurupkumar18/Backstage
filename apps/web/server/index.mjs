import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createOpenAIRoutes } from "./openai.mjs";
import { createPresenceServer } from "./presence.mjs";

/**
 * One local process for the demo laptop: /openai/* from openai.mjs and everything else from presence.mjs.
 * presence.mjs stays untouched; its request listener is reused as the fallback handler.
 */
export function createDemoServer({ presence = {}, openai = {} } = {}) {
  const routes = createOpenAIRoutes(openai);
  const [presenceHandler] = createPresenceServer(presence).listeners("request");
  return createServer(async (request, response) => {
    if (await routes.handle(request, response)) {
      return;
    }
    presenceHandler(request, response);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PRESENCE_PORT ?? 8787);
  const host = process.env.PRESENCE_HOST ?? "127.0.0.1";
  const server = createDemoServer({ presence: { maxPeople: Number(process.env.PRESENCE_MAX ?? 2000) } });
  server.listen(port, host, () => {
    const key = (process.env.OPENAI_API_KEY ?? "").trim() ? "configured" : "missing";
    console.log(`backstage web server on ${host}:${port} (presence, openai; OpenAI key ${key})`);
  });
}
