# Rehearsal checklist

A rehearsal only counts if it ran on the demo browser, the demo network and the deployed stack. Tick each item with a time and initials. A pass in mock mode is not a pass.

## On site at the Salt Palace (before 4:00 PM)

- [ ] Walk to the rooms named in the demo. Confirm "Room 255 BC" and "Registration" against the posted venue map. If we use different rooms, edit only the labels in `apps/web/src/venue/kubecon-na-2026.ts`. Contract IDs stay unchanged.
- [ ] Confirm we have permission to point any camera at a space. The counts-only privacy notice must be visible on the projector view and printed at the camera position. If permission is unclear, use the count replay and label it.
- [ ] From the demo laptop on venue Wi-Fi, confirm the API is reachable (`curl -sf <web>/api/v1/status` with a tier-0 token) and that OTLP gets through (`POST /v1/traces` returns 200). Check both again on the phone hotspot as a fallback.
- [ ] Record what the event page did not tell us: room capacity, step-free routes and badge-pickup location. Leave the demo silent on anything still unconfirmed.

## Board and roles

- [ ] Keyboard only: Tab to the overflow plan and approve with Enter. Focus is visible the whole time and stays put through a poll refresh.
- [ ] Keyboard only: ack from the staff identity.
- [ ] Tier-0 denial: the attendee token tries to approve and gets a 403. The message appears on the card.
- [ ] Stale 409: two tabs approve the same version. The second gets `stale_version`, the board refreshes, and nothing retries on its own.
- [ ] The incident stays in verifying until the API reports resolved. It never turns green early.
- [ ] Priority and state show as text as well as color. The screen reader announces status changes politely.

## Stage page (demo browser, demo laptop)

- [ ] Open it through `kubectl port-forward svc/web 8080:80` at `http://localhost:8080/stage.html`, or over HTTPS. A plain-HTTP LAN address has no microphone access.
- [ ] Enter the stage token (password field) and confirm the text says "Stage token set".
- [ ] Press Start microphone and grant permission. The page shows "Listening: microphone live."
- [ ] Unplug the USB mic. Write down whether this browser fires `ended` and how long it takes. Confirm that `audio_input_lost` with trigger `device` reaches the API.
- [ ] With the laptop's built-in mic present, unplug the USB mic. No `audio_input_restored` may arrive until the USB mic is plugged back in. The page pins the first device it opened, so make the USB mic the system default before pressing Start microphone.
- [ ] Replug. Confirm `audio_input_restored` with trigger `device`. If it does not arrive, press Reconnect microphone.
- [ ] Manual fallback, using only Tab and Enter or Space: lost, then restored, both with trigger `manual`.
- [ ] Caption monitor: start it, let it go stale after the timeout, and confirm one `caption_stale`. Then enable Rehearsal mode, send a fixture line, and confirm `caption_line` carries only `line_seq`.
- [ ] Rerun twice end to end (4:00-5:00 window).

## Observability

- [ ] The collector is healthy (`/` on 13133) and Dash0 receives spans from `web` and `incident-api`.
- [ ] One incident trace shows browser fetch → ingress → transitions with `incident.id`. Save the link to `evidence/trace.md`.
- [ ] The Dash0 SLO dashboard renders all three ratios and four p90 panels. Note any panel that is empty and why.
- [ ] One real bug investigation is saved through Dash0 MCP or Agent0 (`evidence/dash0-investigation.md`).

## Infrastructure (Ali)

- [ ] Station A stops on Kubernetes, the Radar diagnosis comes back in `radar` mode, and B completes all three job IDs.
- [ ] The evidence is recorded separately in case this segment is cut.

Open question: which browser and OS will the stage laptop run, and has its `ended` behaviour on unplug been observed rather than assumed?
