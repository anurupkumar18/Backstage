# web

React board, role actions, attendee/projector views, and browser signal producers. See the [Kunj handoff](../../docs/handoffs/kunj.md).

## Run

```sh
cd apps/web
npm ci
npm run dev          # mock mode, http://localhost:5173
npm test             # vitest: mock store, client rules, schema validation, components
npm run build        # tsc --noEmit && vite build
```

Routes: `#/` organizer board, `#/status` attendee status, `#/projector` projector view, `#/join` anonymous phone check-in. The projector QR uses the current origin; run behind the host’s HTTPS proxy for phones. Check-in only moves a dot and never selects an API identity or grants permissions. Live mode offers venue, IT, backup, speaker and attendee identities with runtime-entered tokens.

## Modes

`VITE_MOCK_API` is `true` unless set to `false`. In mock mode the browser serves an in-memory incident API seeded from `fixtures/shared/` (read in place, never copied). It runs the overflow lifecycle: approve, dispatch, acknowledge, then a 60 second door-count clearing window replayed from `overflow.signals.jsonl` before the incident resolves. The "Mock controls" panel can force a stale 409, drop one response after commit to exercise the same-key retry, probe a denied approve, and reset.

Live mode (`VITE_MOCK_API=false`) proxies `/api/v1` to `http://127.0.0.1:8000` (override with `API_PROXY_TARGET`). Enter the bearer token for each identity in the header. Tokens live in `sessionStorage` only and never in a `VITE_` variable. Against `make dev` at the repo root, GETs render and POST actions return 404, because the fixture server is static.

## Client rules

- Each approve or ack intent gets one `Idempotency-Key`. A lost response retries with the same key and body. A new click after a changed version gets a fresh key.
- 409 `stale_version` refreshes the board and asks the user to act again. Nothing retries automatically with a new version.
- 403 shows the server message on the incident card.
- An incident stays in verification until the API reports `resolved`.

## Incident evidence

The selected incident's inspector shows the actual committed event sequence, actor and state transition, payload and signal references, source timestamps and count facts when available. Recovery progress comes from qualifying evidence, not a browser countdown. Storage/source/freshness details disclose memory versus Elasticsearch, durability, unknown origin, and the checkpoint/indexed revision pair. Search reads projected Elasticsearch event documents; it can lag the authoritative timeline. Results open the authorized incident and selected event, including historical incidents. An unavailable selected event is explicit and never replaced with another event.

The live API must implement `GET /api/v1/incidents/{id}/diagnostics` and `GET /api/v1/evidence/search`, and enable its evidence projection. Search supports text, room, event type and time filters with at most 20 displayed results. The browser does not build Elasticsearch DSL or receive Elasticsearch credentials. In-browser mock mode shows a labeled unavailable response for storage diagnostics/search rather than simulated search evidence.

## Dash0 browser monitoring

The single pinned `@dash0/sdk-web` SDK replaces the previous browser OpenTelemetry provider. Set `VITE_BROWSER_OTLP_URL=/otel` to enable navigation, Core Web Vitals, fetch tracing and privacy-filtered error monitoring. Empty configuration disables monitoring. `VITE_SERVICE_VERSION` (default `development`) and `VITE_DEPLOYMENT_ENVIRONMENT` (default `demo`) set non-secret resource metadata.

The SDK appends `/v1/traces` and `/v1/logs` to its endpoint. The browser therefore posts to `/otel/v1/traces` and `/otel/v1/logs`; Vite rewrites `/otel` to the collector at `OTEL_PROXY_TARGET` (default `http://127.0.0.1:4318`). Deployment proxies must use the same rewrite. Legacy `VITE_BROWSER_OTLP_URL=/v1/traces` is translated to `/otel`. Cross-origin collector URLs and other endpoint bases are rejected. The dedicated prefix matters: SDK 0.30.0 ignores every URL starting with the telemetry endpoint, so configuring the origin itself would suppress API and page monitoring.

No provider token is configured in the browser. The collector supplies Dash0 credentials server-side. URL credentials, query strings and fragments are scrubbed, HTTP headers and page titles are not captured, and browser exceptions become a static message plus an allowlisted source (`window` or `promise`), without arbitrary error text or stack traces. No session replay, identification, interaction labels, profiling or console capture is enabled. SDK-generated anonymous session IDs still support RUM correlation. Configured monitoring and trace IDs do not prove provider ingestion; confirm traces and web events in Dash0 before making a cloud-delivery claim.

Official SDK references: [configuration](https://www.dash0.com/docs/dash0/miscellaneous/tooling/web-sdk/configuration), [source](https://github.com/dash0hq/dash0-sdk-web). `src/telemetry/sdk-runtime.test.ts` exercises the installed SDK to verify API trace propagation and export, navigation logs, transport exclusion and URL scrubbing.
