# Five-minute demo runbook

Each incident ends in a verification wait of up to 60 seconds. The run fills those waits with the trace and the approval history, so the judges never watch a spinner. Start on a green board. Live feeds are used where validated, and every fixture or manual trigger is labelled.

## Stations and roles (proposed, confirm at kickoff)

| Person | Screen | Identity and token |
| --- | --- | --- |
| Kunj (driver) | Organizer board on the projector, Dash0 in a second tab | Organizer, tier 3 |
| Luke | Staff view on a second laptop or phone. API terminal for replay. | Venue and AV staff, tier 2 |
| Ali | Cluster terminal with Radar | Platform credentials, never on the projector |
| Edge owner, if named | Laptop with the two count feeds | `CAM_SIGNAL_TOKEN` |
| Stage laptop (Kunj or Luke) | `http://localhost:8080/stage.html` through a port-forward, with the USB mic connected | Stage-scoped token |

Paste every token into a password field before the projector goes on. A token must never appear on screen.

## Minute by minute

| Time | What the audience sees | Who does what |
| --- | --- | --- |
| 0:00-0:30 | Green board. Kunj gives the pitch: 9,000+ attendees and 400+ sessions at the Salt Palace, and the two incidents everyone there knows, an overflowing session room and a stalled badge printer. He says "Room 255 BC is our assumed mapping for room-b". | Kunj talks. Nobody clicks. |
| 0:30-1:00 | Room B overflow opens from two count feeds. Plan and priority show as text. | Edge owner runs live feeds, or Luke replays `fixtures/shared/overflow.signals.jsonl`. If it is the replay, say "count replay" and keep the board's fixture label visible. |
| 1:00-1:20 | Organizer approves the Venue plan from the keyboard. | Kunj: Tab to Approve, press Enter. Do not use the mouse. |
| 1:20-1:30 | Staff accepts the assignment. The incident moves to verifying. | Luke: ack from the staff identity. |
| 1:30-2:30 | 60-second clearing window. Kunj opens the Dash0 trace for this incident (browser fetch to ingress, transition spans, dispatch, ack), then the approval history on the incident timeline. The board turns green only after verification. | Kunj switches tabs and narrates. Return to the board for the green. |
| 2:30-2:50 | Stage AV: the presenter unplugs the USB mic. The stage page shows "Microphone lost". The AV incident opens as high priority, and caption-stale evidence merges into it. | Stage laptop: unplug. If the page does not show the loss within 3 s, press "Report mic lost (manual trigger)" and say "manual trigger". |
| 2:50-3:20 | Stuck-to-reassignment. The first AV assignee declines, and the incident hands off to the next eligible staff member. | Luke: decline as the first assignee, then ack as the second. |
| 3:20-3:40 | Mic restored and a fresh caption line arrives. Verification passes. | Stage laptop: replug, or press the manual restore button. Then, under Rehearsal mode, press "Show next fixture caption line" and say "caption fixture" (live captions are P1). |
| 3:40-4:20 | Infrastructure: Station A stops on Kubernetes, Radar diagnosis shows, the organizer approves the reroute, and three badge PDFs complete on Station B. | Ali stops A and shows Radar. Kunj approves. Luke acks. **Cut first** (see below). |
| 4:20-4:40 | Dash0 SLO view: high-priority ack within 60 s, resolve within 5 min, and joint success against the 90% target. | Kunj opens the saved dashboard. |
| 4:40-5:00 | Gitar review history: one PR with the review, the fixable CI failure, and green checks. Close on the trace link. | Kunj shows the PR tab. |

## Cut order when time is tight

1. Cut the infrastructure segment (3:40-4:20). Say "recorded" and show the saved Radar and badge evidence for 10 seconds at most.
2. Shrink Gitar to one screenshot.
3. Show the SLO view as a screenshot instead of navigating to it live.
4. Never cut the verification wait, the keyboard approval or the fixture labels.

## If something breaks live

- **Stale 409 on approve.** The board refreshes. Say "someone else acted first, the API rejected the stale version". Approve again.
- **Mic event missing.** Use the manual fallback, already covered above.
- **Dash0 slow.** Use the saved trace screenshot in `evidence/`.
- **API down.** Switch to the backup video at the current minute mark.

Open question: does the stuck-to-reassignment path run on a decline, or does the demo have to wait out the 60-second ack timeout?
