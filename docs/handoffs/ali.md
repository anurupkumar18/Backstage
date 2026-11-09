# Ali · Badge simulator, Radar, and Kubernetes

Read the [full team handoff](../../BACKSTAGE-team-agent-handoff.md), then branch from `main` with `git switch -c ali/badge-simulator`. Own `services/badge-simulator/`, `deploy/platform/`, `deploy/badge/`, and `docs/radar/`. Keep the Radar adapter under `services/badge-simulator/radar/`.

1. Run `make smoke SCENARIO=badge_stall` and review the [badge contract](../../contracts/badge.v1.schema.json), [badge replay](../../fixtures/shared/badge_stall.signals.jsonl), and [HTTP examples](../../fixtures/shared/http.examples.json). Seed `badge-job-001`, `badge-job-002`, and `badge-job-003`.
2. Build local seed, fault, and reset commands. Keep `badge-control` on port 8090 reachable after Station A fails. Station B or a surviving monitor emits A's health event. Make reroute idempotent by logical job ID, then emit each completion after its stable PDF reference is available.
3. Wire the read-only Radar diagnostic behind the service credential. Include evidence references and label mock mode. Coordinate with Luke on replay into the incident API and on reroute gates after approval and acceptance.
4. Compose the namespace overlay from the independently owned manifests. Demonstrate an actual Station A workload stop and capture real Radar investigation evidence separately once cluster and Radar access are available.

First PR acceptance is a local A-to-B failover with all three stable job IDs completed, a smoke command Luke can run, and the mock or real diagnostic mode visible. Include the contract revision, run commands, and access dependencies.
