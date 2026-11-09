# radar

Radar setup and investigation notes. Owner: Ali.

## Access

- Radar Cloud MCP is configured for coding agents in the repo's `.mcp.json` (`https://api.radarhq.io/mcp`). Each person signs in once with `/mcp` → radar → Authenticate.
- Org: Cloud Native Hackathon. Our cluster is `backstage`, id `Wa7aYihloY4`.
- Namespace `team-backstage` exists. On 2026-11-09 it held a Deployment `app` (2 pods, `node:22-alpine`). Argo CD and Argo Rollouts are installed in the cluster.

## Service access (open dependency)

`badge-control` in `RADAR_MODE=radar` needs a bearer token it can use without a browser (`RADAR_TOKEN`). The coding-agent login is an interactive OAuth sign-in stored on the laptop and must not be copied into the cluster. Confirm with the Radar team whether Radar Cloud issues service or API tokens scoped to one cluster and read-only tools. Until then badge-control runs in `RADAR_MODE=mock`, and real Radar evidence comes from the coding agent's investigation.

## Evidence to capture

1. **Staged outage:** stop `badge-station-a` in `team-backstage`, then save the Radar `diagnose` and `get_events` results that show the stopped workload.
2. **Real build issue:** a separate investigation of a genuine failure (image pull, crash loop, readiness). Keep it apart from the staged outage.
