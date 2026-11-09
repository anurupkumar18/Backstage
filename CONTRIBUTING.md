# Working on Backstage

Branch from the bootstrap on `main` and use `luke/<feature>`, `kunj/<feature>`, or `ali/<feature>`. Open a focused PR with the tested commands, evidence, dependencies, and the contract revision from `git log -1 --format=%H -- contracts/`. Coordinate shared contract edits with consumers and keep v1 additive after the team agrees to freeze it.

Read the [team updates](docs/handoffs/README.md) before starting or resuming work. Append a lane handoff and include it in every push so another person or agent can pick up the work from Git.

The [owner map](.github/owners.json) is the source of truth for changed paths. The PR check reads it from the base revision and checks both sides of renames. Root files and unmatched paths belong to Luke. Bootstrap reviews route to Luke until verified collaborator handles are added to the map and CODEOWNERS. Confirm each contributor has write access before enabling their lane. The edge lane is reserved until an owner is assigned.

| Lane | Paths |
| --- | --- |
| Luke | Root, GitHub and Gitar config, shared contracts and fixtures, scripts, integration tests, incident API, agent workers, Elasticsearch, incident deployment |
| Kunj | `apps/web/`, `observability/`, `deploy/web/`, `deploy/dash0/`, `docs/demo/` |
| Ali | `services/badge-simulator/`, `deploy/platform/`, `deploy/badge/`, `docs/radar/` |
| Edge | `services/cam-edge/` |

Use linked PRs for cross-lane changes. Keep each service's dependencies, lockfile, local tests, environment example, and run commands within its lane. Keep credentials in ignored environment files or platform secrets.

After collaborator setup, configure GitHub to require the `scaffold-check` and `changed-paths` jobs and a review on `main`. Connect Gitar and verify the repository guidance is picked up on a feature PR.
