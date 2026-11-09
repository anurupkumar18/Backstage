# web

React board, role actions, attendee/projector views, and browser signal producers. See the [Kunj handoff](../../docs/handoffs/kunj.md).

## Run

```sh
cd apps/web
npm install
npm run dev          # mock mode, http://localhost:5173
npm test             # vitest: mock store, client rules, schema validation, components
npm run build        # tsc --noEmit && vite build
```

Routes: `#/` organizer board, `#/status` attendee status, `#/projector` projector view.

## Modes

`VITE_MOCK_API` is `true` unless set to `false`. In mock mode the browser serves an in-memory incident API seeded from `fixtures/shared/` (read in place, never copied). It runs the overflow lifecycle: approve, dispatch, acknowledge, then a 60 second door-count clearing window replayed from `overflow.signals.jsonl` before the incident resolves. The "Mock controls" panel can force a stale 409, drop one response after commit to exercise the same-key retry, probe a denied approve, and reset.

Live mode (`VITE_MOCK_API=false`) proxies `/api/v1` to `http://127.0.0.1:8000` (override with `API_PROXY_TARGET`). Enter the bearer token for each identity in the header. Tokens live in `sessionStorage` only and never in a `VITE_` variable. Against `make dev` at the repo root, GETs render and POST actions return 404, because the fixture server is static.

## Client rules

- Each approve or ack intent gets one `Idempotency-Key`. A lost response retries with the same key and body. A new click after a changed version gets a fresh key.
- 409 `stale_version` refreshes the board and asks the user to act again. Nothing retries automatically with a new version.
- 403 shows the server message on the incident card.
- An incident stays in verification until the API reports `resolved`.
