# Optional local voice and advisory triage

Voice is disabled until `VITE_ENABLE_VOICE=true`. The floor inbox and deterministic “While you were away” brief work without OpenAI or microphone permission.

## Run privately

Export `OPENAI_API_KEY` in your terminal environment using your existing secret manager, then run `npm run presence` from `apps/web`. This starts `server/index.mjs` on loopback port 8787 with presence plus `/openai/*`; it never returns the standard key. Set `INCIDENT_API_BASE_URL` in the Node environment to the same API used by the browser (default `http://127.0.0.1:8000/api/v1`). Start Vite with `VITE_ENABLE_VOICE=true`. If the combined server uses another port, set `WEB_SERVER_PROXY_TARGET` and `PRESENCE_PROXY_TARGET` to that loopback origin.

In the inbox, choose a role and submit its bearer token with **Use token**. **Connect voice** explicitly enables the OpenAI connection and requests microphone permission. The microphone stays muted until **Hold to ask** is held (Space/Enter or pointer); release commits the turn. Blur/cancel drops that turn. Disconnect, leaving the route, hiding the page or a failed connection stops tracks. Connections stop after two minutes; holds stop after twenty seconds. The UI shows that audio and scoped metadata go to OpenAI. Backstage stores neither audio nor transcripts.

## Authority and data boundary

Before minting a briefing session, the Node server forwards the caller’s bearer token to the incident API to verify scope. A successful scoped incident read enables incident tools; a denied incident read plus an authorized public status read enables status only. Missing/invalid tokens and an unavailable scope check fail closed before any model mint. Submitted role/tier fields are ignored. Every subsequent incident/event read still uses that token against the authoritative API.

`src/voice/briefingTools.ts` exposes three fixed tools: `get_status`, `list_incidents`, `get_incident_events`. There is no write method or model-controlled URL. Incident reads use the currently selected bearer token; the server remains authoritative. Events require membership in that token’s current incident list. The model receives state/priority/room/verification/action metadata and event types/times, without plan prose, actor IDs, event payloads, trace IDs or staff assignments. Tier 0 is restricted to public status. Failed reads return error codes rather than invented answers.

The browser gets a short-lived ephemeral client secret and connects via WebRTC. The server fixes session configuration, model and verified tool declarations. The browser executor also checks the returned `allowed_tools`, and hold-to-talk is disabled while tool reads finish to avoid overlapping response creation. Default models recovered from the previous agent are `gpt-realtime-2.1`, `gpt-live-transcribe`, and `gpt-6-luna`; override only on the Node server. All routes default to loopback callers, enforce JSON/body limits and rate limits, and redact keys from errors/logs. The public attendee gateway must not forward `/openai`.

The recovered `/openai/realtime/token` endpoint is a foundation for future stage captions; no caption client is connected yet. `/openai/triage` returns advisory Decisions API values with domain confidence below 0.6 requiring human selection. It does not submit reports or assign staff. Report intake remains a backend dependency.

## Evidence and limits

`npm test` now includes all Node server tests. Voice tests simulate WebRTC/microphone lifecycles, late permission grants, cancellation and multi-tool continuation. Server tests mock OpenAI and verify fixed configuration, local callers, redaction, rates, triage uncertainty and missing-key failures. Browser missing-key fallback was verified without microphone access or vendor traffic. The live microphone and a real paid Realtime call remain unverified.

Checked current official references for [WebRTC and ephemeral authentication](https://developers.openai.com/api/docs/guides/voice-webrtc), [Realtime push-to-talk and function outputs](https://developers.openai.com/api/docs/guides/realtime-conversations), [live transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), and [Decisions](https://developers.openai.com/api/docs/guides/decisions).

Open question: does the demo laptop’s actual microphone and network sustain intelligible voice in the conference hall?
