# radar

Scoped, read-only Radar diagnosis adapter behind `POST /internal/radar/diagnose`. Owner: Ali.

| `RADAR_MODE` | Behavior |
| --- | --- |
| `mock` (default) | Diagnosis from the simulator's own heartbeats and queue. Response `mode: "mock"`, evidence refs like `mock-station-a-offline`. |
| `radar` | MCP over streamable HTTP to `RADAR_MCP_URL` with `Authorization: Bearer $RADAR_TOKEN`. Calls `get_resource` then `diagnose` on Deployment `badge-<station_id>` in `KUBE_NAMESPACE` on cluster `RADAR_CLUSTER_ID`. Saves each raw result as `<evidence dir>/<ref>.json` and returns those refs with `mode: "radar"`. |

Safety:

- `mcp_client.McpClient` only calls tools on its allowlist: `diagnose`, `get_resource`, `get_events`, `list_resources`. Write tools (`manage_workload`, `apply_resource`, `patch_resource`, `delete_resource` and the rest) raise before any request is sent.
- If Radar fails or is not configured, the response falls back to mock, says `Radar unavailable (...)`, and adds `mock-radar-unavailable`. It is never labeled `radar` without a real Radar result.
- Radar output is untrusted evidence: stored and summarized, never executed or followed.
