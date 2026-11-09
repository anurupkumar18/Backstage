# Floor agents: a proactive agent for everyone on the conference floor

Personal agent apps (Meta Muse, Claude Duet, ChatGPT Dots) share one pattern: the agent works in the background, messages you first, and asks before anything sensitive. They serve one person's errands. Backstage serves many people in different roles around one live incident that only closes on verified recovery. The plan keeps that difference and borrows the pattern: every person on the floor gets one role-scoped agent that comes to them, and the console stops being the only place work is visible.

Build in the web lane, inside the phone page people reach from the QR code. No native app, no push service, no new backend. The browser needs only what the v1 API already returns.

## Principles

- Humans approve. An agent card only offers actions already in `incident.allowed_actions`; the server decides. Nothing here calls an endpoint a human did not tap.
- A role sees only what its token sees. The inbox is derived from `GET /incidents` and `GET /incidents/{id}/events` under the current identity. A speaker token is session-scoped, and Room B overflow has no session id, so a speaker's inbox shows status and preflight, not the overflow incident. Say so on screen.
- Default text is deterministic templates. OpenAI phrasing is optional and never changes what is shown or offered.
- Counts and states only. No names, frames, faces or caption text anywhere.
- Accessibility gate from `docs/handoffs/kunj.md` applies to every screen: keyboard operable, visible focus, one polite live region, text for priority and state.

## Roles and what each agent does

| Role (identity) | Agent behaviour | Source |
| --- | --- | --- |
| Organizer (demo-organizer) | Floor brief on open, a "needs you" card per plan awaiting approval, watches verification | incidents + events |
| Venue or IT staff (demo-staff, demo-it-staff) | Assignment card with accept, "you are on it" while accepted | incidents with `assignment` |
| Speaker (demo-session) | Preflight and session status, report-a-problem | status, report intake |
| Attendee (demo-attendee) | Room and accessibility status, report-a-problem, check-in blob | status, presence |

## Phases (build in this order, each one a PR)

### 1. Inbox route `#/me` (about 60 minutes)

- `apps/web/src/inbox/deriveInbox.ts`: pure function `(incidents, eventsById, identity, lastSeen) => InboxItem[]`. Kinds: `needs_you` (allowed_actions has approve or ack), `watching` (your assignment or your domain), `update` (state changed since lastSeen), `resolved` (verified). Sort needs_you first, then priority, then updated_at.
- Card text from templates in `inbox/copy.ts`, keyed by incident type and state, using `venueRoomLabel` from `src/venue/kubecon-na-2026.ts`. Example: "Room 255 BC is over capacity. The Venue agent proposes holding entry. Approve?"
- `apps/web/src/hooks/useInbox.ts` on top of `useBoard` (polling, announcements) and `useIncidentActions` (approve, ack with idempotency and 409 refresh).
- `apps/web/src/ui/InboxView.tsx`: phone first at 390px, one primary button per card, the verification line as text ("Waiting for evidence", "Verified"), a short "Why you" line. Not a chat box.
- Route: extend `Route` in `src/ui/types.ts` and `useHashRoute.ts`; add the nav entry in `AppShell`.
- Tests: `deriveInbox` table tests per role and state; keyboard approve from the inbox against the mock; stale 409 shows the refresh message.

### 2. Agent dots (about 40 minutes)

- Extend `PresenceField` hero variant with three labelled agent dots (Venue, AV, IT) beside the tier clusters. A dot pulses when an event whose `actor.kind === "agent"` arrives; legend text reads "Venue agent proposed a plan 12 s ago". Derive from events already fetched; no new API.
- Reduced motion: static dots, legend still updates. Do not imitate any vendor's logo or branding.

### 3. Floor brief and voice (about 45 minutes)

- On open and after 60 seconds away, show "While you were away" built from events newer than `lastSeen` (localStorage, try/catch). Template text first.
- Wire the OpenAI agent's `src/voice` hold-to-talk controller as "Ask Backstage". It is read-only: GET endpoints only, allowlist enforced in code and tests.
- Optional: rewrite the brief with gpt-5.4-mini through the local OpenAI server route. Failure falls back to the template silently.

### 4. Installable web app (about 30 minutes)

- `public/manifest.webmanifest`, an SVG icon, `theme_color` from the paper token, `display: standalone`.
- A minimal service worker that caches the app shell only and never caches `/api/v1` or `/presence`.
- `navigator.vibrate` and the Notification API for new `needs_you` cards while the page is open. Web Push is out of scope.

### 5. Report a problem with triage (about 45 minutes, depends on Luke)

- Form for attendee and speaker. Text goes to `POST /openai/triage` (Decisions API, advisory: team, accessibility impact, urgency, probabilities). The UI shows the suggestion and lets the human change it, below 0.6 confidence it asks instead of guessing.
- Submit as a `human_report` signal (`category`, `summary`). Luke's intake endpoint is not built yet; until it is, post to the mock and label it.

## Acceptance

1. An organizer, a venue staff member and an attendee on three phones each see only their own inbox and nothing more.
2. Overflow demo: organizer inbox shows the plan card within 2 seconds of the incident opening; one tap approves; the staff phone then shows the assignment; accepting moves the organizer card to "Verifying: waiting for evidence"; it turns "Verified" only when the API says resolved.
3. `npm run build`, `npx tsc --noEmit`, `npx vitest run` pass; the keyboard-only path works; contrast checks pass at 390px.
4. No credentials, tokens or caption text in the bundle, logs or telemetry.

## Not now

Native apps, Web Push, an LLM that chooses assignments, multi-day scheduling, free-form agent chat.

## Risks

- The inbox is only as rich as the events Luke's API returns. Overflow and badge incidents have them; stage AV does not exist in the API yet.
- Mock and live incident ids differ (live ids are generated). Never hard-code an id.
- Phones need a public HTTPS URL for the QR. Anurup is hosting; never expose the dev server or prefilled demo tokens (see `docs/demo/local-demo.md` once the launcher lands).

Open question: should the organizer's brief be spoken by default, or only when asked?
