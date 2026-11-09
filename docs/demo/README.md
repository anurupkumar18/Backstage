# demo

The judges get five minutes, and three incidents with real verification waits run past that. So the run is cut so every wait doubles as an explanation, and anything not proven live is labelled on screen. Owner: Kunj.

| File | Use |
| --- | --- |
| [runbook.md](runbook.md) | Minute-by-minute run, who clicks what, cut order |
| [rehearsal-checklist.md](rehearsal-checklist.md) | Pre-demo checks and on-site venue tasks |
| [recording-plan.md](recording-plan.md) | Backup video |
| [dependencies.md](dependencies.md) | Open dependencies on Luke, Ali and the edge owner |
| `evidence/` | Trace link, Dash0 investigation, Radar and Gitar captures (see `deploy/dash0/README.md`) |

## Setting: KubeCon + CloudNativeCon North America 2026

These facts come from the public event page, as recorded in `apps/web/src/venue/kubecon-na-2026.ts`:

- Dates: November 9-12, 2026.
- Venue: Salt Palace Convention Center, 90 South West Temple, Salt Lake City. The Hyatt Regency Salt Lake City is the secondary venue.
- Scale: 9,000+ attendees, 2,100+ organizations and 400+ sessions.
- Named areas used here: Hall DE, Grand Ballroom GI, Rooms 251 A-C, 254, 255 A and 255 BC, and the Solutions Showcase halls.

At that size, a session room overflowing into the hallway and a badge printer stalling at registration are incidents every attendee has seen. The pitch starts there.

Display labels are a demo assumption, not venue data. `room-b` is shown as "Room 255 BC" and `room-c` as "Registration". Contract IDs on the wire (`room-b`, `room-c`, `stage-b`, `station-a`, `station-b`) do not change. Say "assumed mapping" out loud the first time a room name appears.

This project is not affiliated with the Linux Foundation, CNCF or KubeCon, and does not use their logos. Do not put event logos in slides, the board or the video.

## Open questions to confirm on site

The event page does not publish these, so nothing in the demo states them:

- Seating capacity of Room 255 BC, and of any other room we name. The overflow threshold in fixtures is a demo number, not the room's capacity.
- Step-free and accessible routes between Level 2 rooms and registration.
- Where badge pickup and registration are located.
