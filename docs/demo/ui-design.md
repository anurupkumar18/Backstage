# Backstage UI: venue operations

The board repeated the same incident in a moving ticker and detail panel, while sticky search covered the action area on small screens. The approved direction keeps a light workspace, a dark projector and color concentrated in incident status and the checked-in crowd.

## Direction and passes

- Product: conference incident control for organizers and floor staff.
- Character: calm, direct, watchful.
- World: venue operations desks and room signage.
- Moments: incident progress and the checked-in crowd carry color.
- Signature: a consistent status marker follows the incident through verification.

Spacing now follows a four-pixel rhythm, with compact navigation and 44–48px interaction targets. Neutral surfaces replace the warm paper/purple projector combination; semantic color retains its meaning. Bouncing face icons become quiet, consistent line marks. Copy names the plan review and search actions directly. Interface weights stop at 600, section labels use sentence case and changing figures use tabular numbers. The phone inbox has less header chrome; desktop keeps the incident list beside the detail. Controls have smaller corners than panels, check-in becomes a light sheet with a confirmation check, and search stays in document flow. The moving board ticker is removed; the projector summary is static. Decorative bounce, drift and agent pulsing are removed. Presence remains the product's count visualization, with existing reduced-motion support.

## Verification

122 frontend tests and 30 Node server tests pass. TypeScript and production Vite build pass. Browser review covered desktop 1440px, phone 390px, dark projector and check-in. The phone inbox and check-in have no horizontal overflow. In the labelled mock, keyboard organizer approval reached Dispatched, keyboard staff acceptance reached Accepted, and anonymous check-in completed. Existing automated tests cover stale actions, role scoping and verification gates. This visual change does not establish a new live API or microphone integration.

## Source

Applied [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), at source revision 97daa3eb365670ea3f87ed85356cbfcee18105a5. The audit and approved direction informed this adaptation; no image generation or story video was used.

Open question: does the venue projector preserve the status contrast under stage lighting?
