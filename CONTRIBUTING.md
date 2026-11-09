# Working on Backstage

Branch from the bootstrap on `main` and use `luke/<feature>`, `kunj/<feature>`, or `ali/<feature>`. Open a focused PR with the tested commands, evidence, dependencies, and the contract revision from `git log -1 --format=%H -- contracts/`. Coordinate shared contract edits with consumers and keep v1 additive after the team agrees to freeze it.

Read the [team updates](docs/handoffs/README.md) before starting or resuming work. Append a lane handoff and include it in every push so another person or agent can pick up the work from Git.

The [owner map](.github/owners.json) is the source of truth for changed paths. The PR check reads it from the base revision and checks both sides of renames. Root files and unmatched paths belong to Luke. Luke, Ali, and Kunj share GitHub review ownership through [.github/CODEOWNERS](.github/CODEOWNERS). Each contributor's branch and changed paths are checked against their assigned lane. The edge lane is reserved until an owner is assigned.

| Lane | Paths |
| --- | --- |
| Luke | Root, GitHub and Gitar config, shared contracts and fixtures, scripts, integration tests, incident API, agent workers, Elasticsearch, incident deployment |
| Kunj | `apps/web/`, `observability/`, `deploy/web/`, `deploy/dash0/`, `docs/demo/` |
| Ali | `services/badge-simulator/`, `deploy/platform/`, `deploy/badge/`, `docs/radar/` |
| Edge | `services/cam-edge/` |

Use linked PRs for cross-lane changes. Keep each service's dependencies, lockfile, local tests, environment example, and run commands within its lane. Keep credentials in ignored environment files or platform secrets.

## Scoped contributors

The owner map may also grant a named contributor explicit paths under a separate branch prefix. These grants supplement the existing lanes; they do not transfer ownership or change CODEOWNERS reviews. Directory grants end in `/`; all other entries match one exact file. The check still validates the PR author, branch prefix, and both sides of renames using the base revision. Ownership-map changes therefore need an existing maintainer to land them before dependent contributor PRs can pass.

Anurup (`anurupkumar18`, branches `anurup/<feature>`) owns the Dash0/evidence contribution, with explicitly listed integration paths for the incident API, Elasticsearch, and web inspector. Its handoff log is `docs/handoffs/anurup-log.md`.

After collaborator setup, configure GitHub to require the `scaffold-check` and `changed-paths` jobs and a review on `main`. Connect Gitar and verify the repository guidance is picked up on a feature PR.
