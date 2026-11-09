# Sponsor depth

Every sponsor tool should be how we build or run Backstage, with evidence a judge can open. Status is as of 2026-11-09 12:50 and separates built from verified.

## Dash0

| Depth step | Status | Owner |
| --- | --- | --- |
| Collector config and Dash0 exporter | Built, validated offline. Token saved locally. OTLP endpoint still missing, so nothing has reached Dash0 | Kunj |
| Browser telemetry from web and stage page | Built, off until `VITE_BROWSER_OTLP_URL` is set | Kunj |
| One trace from camera signal to verified close | Needs Luke's API and cam-edge to emit spans with W3C context | Luke, edge |
| GenAI spans for agent, LLM and tool calls | Open | Luke |
| SLO rules and dashboard | Written, unverified against a real org | Kunj |
| Dash0 MCP in the coding agent, one real bug found through it | Blocked: MCP not connected in this session | Kunj |
| Agent0 root-cause on the staged slow incident | Open, needs live traces | Kunj |
| Synthetic monitoring of the web app and kiosk | Open, cheap once the app is deployed | Kunj |

## Radar

| Depth step | Status | Owner |
| --- | --- | --- |
| Radar MCP in the coding agent | Added to local config, needs sign-in via `/mcp` | Kunj |
| Services run on the provided cluster and namespace | Manifests written, namespace unknown | Ali, Kunj |
| Ship through Radar's MCP and Argo CD sync | Open | Ali |
| IT Agent calls Radar MCP for the badge-station outage | Ali's adapter on `ali/badge-simulator` | Ali, Luke |
| AI investigation of a real build bug, separate from the staged failure | Open | Kunj, Ali |
| Radar Checks and Issues clean before the demo | Open | Ali |

## Elasticsearch

| Depth step | Status | Owner |
| --- | --- | --- |
| Incident state in Elasticsearch with optimistic concurrency | Built and smoke-tested by Luke | Luke |
| Roster, equipment and runbook indices | Open | Luke |
| Hybrid search and `semantic_text` (Jina embeddings) for runbooks and equipment | Open | Luke |
| kNN over past incidents, shown in the web as "similar past incidents" | Open, web side waits for an index | Luke, Kunj |
| Presence and camera counts as time series with aggregations | Proposed on the board | Luke, Kunj |
| Agent Builder or MCP over the data, one Elastic Workflow | Open | Luke |

## Sonar and Gitar

| Depth step | Status | Owner |
| --- | --- | --- |
| Gitar installed on the repo, review rules in `.gitar/review/` | Rules exist. Install and pickup unverified | Luke |
| Every feature through a Gitar-reviewed PR | Kunj lane is one large local tree. Split into focused PRs: board, stage page, telemetry, observability, deploy, demo docs | Kunj |
| Web rules for Gitar: accessible names on controls, no secrets in `VITE_` variables, no caption text in signals | Proposed | Luke, Kunj |
| SonarQube Cloud scan in CI with a quality gate | Open, CI is Luke's lane | Luke |
| A seeded CI failure that Gitar auto-fixes live | Open | Luke |

## Merge Forward

Captions-down is a priority incident, so the stage page's caption heartbeat and the accessibility-first UI are the hooks. Decide at 2:30 whether to add step-free routing.

## Order of work

1. Get the Dash0 endpoint and Radar sign-in working, since both unblock real evidence.
2. Split Kunj's tree into focused PRs once Luke assigns the lane owners, so Gitar reviews each.
3. Ask Luke for the Elasticsearch search indices and SonarQube step in CI.
4. Save one trace link, one Dash0 investigation and one Radar investigation as demo evidence.
