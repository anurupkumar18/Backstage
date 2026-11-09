# Team updates

Each lane keeps a running record of its pushes. Read the log on the branch where the work was pushed. Once a PR merges, its entries are also in the log on `main`.

| Lane | Kickoff guide | Update log path |
| --- | --- | --- |
| Luke | [Backend, contracts, and integration](../../BACKSTAGE-team-agent-handoff.md#luke--elasticsearch-incident-api-agents-contracts) | [docs/handoffs/luke-log.md](luke-log.md) |
| Kunj | [Web, accessibility, and Dash0](kunj.md) | `docs/demo/handoff-log.md` |
| Ali | [Badge simulator, Radar, and Kubernetes](ali.md) | `docs/radar/handoff-log.md` |
| Edge | [Camera feed](../../BACKSTAGE-team-agent-handoff.md#edge-teammate--yolo-and-camera-feeds-once-assigned) | `services/cam-edge/handoff-log.md` once the lane is assigned |

Create your lane's log with its first update if the file is missing. The [original team handoff](../../BACKSTAGE-team-agent-handoff.md) gives the baseline scope and design.

## Read checklist

1. Fetch before starting or resuming a task. On any branch, you can read the current instructions and discover the pushed branches without switching checkouts.

   ```sh
   git fetch origin --prune
   git show origin/main:AGENTS.md
   git branch -r --list 'origin/luke/*' 'origin/kunj/*' 'origin/ali/*' 'origin/edge/*'
   ```

2. Check the lane logs on `origin/main` and on open feature branches. In GitHub, select the branch before opening its log. In Git, use `git show <remote-branch>:<log-path>`, for example `git show origin/main:docs/handoffs/luke-log.md`. Review entries since your last read. For older branches with no log, check their commit history and the lane's latest note on `main`.
3. Inspect referenced diffs when they affect your work, especially contract changes, new setup steps, or blockers. Record the refs and commit IDs you read. Tell the team which changes affect your task and which dependencies you need.

## Before each push

Append one entry that covers the full set of changes being pushed, including docs-only changes. Push the entry on the same branch and in the same push as the work. Include the branch or PR so readers can locate it. Use commit links for already-published work. The log file's Git history identifies the commit containing a new entry.

Put details another person needs to continue in the repo even if they were already discussed in a chat. Keep earlier entries and carry them through merge conflicts. Add a new entry when a decision changes. Store credentials outside Git and summarize any access issue without including tokens or private logs.

## Entry template

```md
## YYYY-MM-DD — Short description

- Branch or PR:
- Changes and why:
- Impact by lane, including setup or contract changes:
- Verified commands and results:
- Open issues and next owner or action:
- References and latest handoffs reviewed:
```
