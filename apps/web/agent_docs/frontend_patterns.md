# Frontend integration patterns

Role controls select a token; the API token decides permissions. Changing the role or token remounts route state in `src/App.tsx`, and clears its announcement, so previous incident cards and messages cannot linger in another role's view.

- `src/hooks/useBoard.ts` polls scoped incidents. Timelines open on demand; the inbox opens every returned incident. Failed timeline reads release their version marker so the next poll can retry. Aborted reads never update the event cache.
- `src/hooks/useIncidentActions.ts` owns action intents and idempotency. Reuse it for approval and acceptance; never post actions from a polling effect. Stale 409 refreshes and requires a new click.
- `src/inbox/deriveInbox.ts` consumes current-token results and actor-specific `allowed_actions`. Tier 0 bypasses incident hooks entirely in `App.tsx` and uses public status. Role labels cannot expand visibility.
- `src/ui/InboxView.tsx` uses the existing paper/ink palette, 48px action targets and text verification. It restores focus to the card after an action; AppShell owns the single polite live region.
- Anonymous `/presence/join` picks a display cluster only. It never sets a bearer token, changes the incident identity, or grants approval.

Run TypeScript, Vitest, the presence server tests and the production build. Node 22 at `/usr/local/bin/node` works on this Mac; the Homebrew Node 25 executable currently fails loading `libsimdjson.29.dylib`.

The live API browser flow still needs a local API instance; static fixture serving cannot exercise writes.
