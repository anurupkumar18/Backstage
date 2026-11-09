# Codex continuation: 2026-11-09

The personal floor experience merged in [PR #17](https://github.com/lukeeskinner/Backstage/pull/17). Its review follow-up on `kunj/voice-scope-fix` verifies voice authority through the incident API before minting tools and prevents overlapping responses during tool reads. It includes the inbox and agent activity that were previously merged into closed feature branches, plus the return brief, optional voice and reviewed polling fixes. The earlier inventory in codex-handoff.md remains useful for finding the original local files; this document supersedes its implementation/test status.

## Completed and verified

- `#/join`: anonymous check-in and projector QR connected; check-in grants no permissions. Mock edits move one dot.
- `#/me`: scoped organizer approvals and staff acceptance, deterministic cards, priority ordering, read timestamps, explicit verification and session-scope copy. Attendees read public status without incident requests.
- Venue/AV/IT activity: fetched agent events only, labelled dots, relative-time legend, reduced-motion support; public views do not fetch privileged history.
- “While you were away”: deterministic event-derived summary on open and after a minute away; timestamp-only persistence; failed/loading views do not mark history seen.
- Optional voice: disabled by default; fixed read-only tools, ephemeral WebRTC session, hold-to-talk microphone gating and cleanup, missing-key fallback. OpenAI server routes recovered from the stopped agent. See openai.md for setup and the precise boundary.
- Live tokens commit on Enter/Use token. Denied reads clear data and version markers; stale/in-flight timelines cannot repopulate an invalidated cache.

Validation at PR #17: 122 Vitest tests, 30 Node server tests, TypeScript and production build pass. Contract checks (3) and incident API tests (16, two opt-in tests skipped) passed before the latest main merge. The browser drove a real FastAPI instance with in-memory storage through the canonical 30-second trigger, keyboard approval and acceptance, and all 60 seconds of clearing evidence. The inbox became Verified; the session-scoped speaker saw no overflow; attendee rooms became Normal. Layout checked at 390 × 844. Real voice audio and paid model traffic were not exercised; browser missing-key fallback and simulated WebRTC lifecycle tests passed.

## Original local work recovered and checked

- Original checkout: `~/Backstage`, branch kunj/overflow-board, still stale and dirty. Do not reset it or assume its untracked files are new relative to main.
- Camera: `services/cam-edge/.venv/bin/python -m pytest -q -p no:cacheprovider` passed all 73 tests in the original checkout. No physical camera or live YOLO crowd run was performed here. The original README is still the reserved-lane stub and no dependency manifest is present; finish those before shipping the camera code once ownership is assigned.
- Gateway: `node --test server/gateway.test.mjs` passed all 10 tests in the original checkout. Gateway source/tests remain local and are not in #17. The one-command `demo-up.sh` and `local-demo.md` planned by the stopped launcher agent were never written.
- OpenAI: server files were present despite the older handoff saying none existed. They are now included with tests and the browser voice client in #17. Stage transcription and the report form are not connected to those server endpoints yet.

## Remaining work and owners

1. Review the `kunj/voice-scope-fix` follow-up directly against main; #17 is already merged. PR #13 targeted phone-join after #12 closed; #15 targeted personal-inbox after #13 closed. Avoid targeting closed feature branches again. No force push was used.
2. Luke: assign the edge lane in `.github/owners.json` before a camera PR. Kunj/assigned edge owner: finish README/dependencies, inspect the detector/control-page boundary, then run the clip and webcam against the real API. Tests alone do not establish detection quality.
3. Kunj: complete the local launcher and integrate the gateway into a deliberately attendee-only public build. Keep everything loopback unless Kunj explicitly authorizes exposure. Current private app supports runtime role tokens; the gateway must not forward incident actions, stage writes or `/openai`.
4. Kunj + Luke: live stage transcription, stage-scoped token and actual stage signal intake. The recovered `/openai/realtime/token` is only a foundation; no live caption claim is justified.
5. Kunj: installable shell (floor-agent-plan phase 4). Kunj + Luke: report form and advisory triage, then real report intake (phase 5). Human decisions must remain explicit; below 0.6 domain confidence, ask the human.
6. Anurup: Dash0/evidence work, with the now-merged ownership prerequisite PR #16 (`98aa8dd`). Ali's merged `cf3fcbd` documents the successful badge cluster rehearsal in `team-backstage`; web/dash0 overlays and the Dash0 Secret remain dependencies. Radar diagnosis is still mock, and badge-control queue storage is still in memory.

## Workspace and environment

The active isolated checkout is under this Codex chat's `work/Backstage` directory on `kunj/voice-scope-fix`. Review worktrees contain PR #12 and PR #13 fixes. No co-author trailers were added. No credentials, public tunnel or cluster mutation were introduced.

Homebrew Node 25 fails loading `libsimdjson.29.dylib`; `/usr/local/bin/node` is working Node 22.18.0. The original root Python venv lacked API dependencies; the continuation used its own `work/api-venv` installed from the repository requirements. Prefer the documented dependency files over assuming an old venv is complete.

Open question: which teammate will own the camera lane and its live-feed rehearsal?
