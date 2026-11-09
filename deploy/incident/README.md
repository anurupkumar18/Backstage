# Incident API deployment

Owner Luke. Deploys one API writer in `team-backstage`, with Elasticsearch persistence and the existing badge-control service. The API is internal at `http://incident-api:8000/api/v1`.

The init container fetches API code and contracts from pinned commit `8e61ac90ada0469e3d12c817656a166f80222ef1` and installs its requirements into a shared volume. This follows the badge deployment's registry-free setup. It needs outbound access to GitHub and PyPI at startup. Recreate deployment and one Uvicorn worker preserve the current single-writer constraint.

## Prerequisites

- A working `kubectl` context for the backstage cluster and namespace access.
- Ali's existing `badge-secrets`, including its nonempty `BADGE_INTERNAL_TOKEN`. The API references this same secret directly.
- A dedicated demo Elasticsearch alias provisioned using [the storage instructions](../../data/elasticsearch/README.md). Do not use the isolated smoke alias for this rehearsal.
- An `incident-secrets` Secret with `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX_PREFIX`, `AUTH_TOKENS_JSON`, and `CORS_ALLOWED_ORIGINS`. Use an ignored `.env.cluster` file with unquoted `KEY=value` lines, then create the Secret with `kubectl --context CONTEXT -n team-backstage create secret generic incident-secrets --from-env-file=services/incident-api/.env.cluster`. Do not commit that file or print its contents.

`AUTH_TOKENS_JSON` must include organizer (tier 3), IT staff (`id: it-staff-01`, tier 2, `domain: it`), and one badge producer. Give the producer only `source_ids: [station-a, station-b]`, `room_ids: [room-c]`, and `signal_kinds: [badge_health, badge_job_complete]`, with no human tier. Generate private tokens for the shared deployment. Preserve any existing identities required by Kunj's board.

## Connect

From the repository root, substitute the actual context name. First check prerequisites, then apply.

```sh
python3 deploy/incident/connect.py --context CONTEXT
python3 deploy/incident/connect.py --context CONTEXT --apply
```

The command deploys the API and waits for storage readiness before connecting badges. It copies only the scoped signal token into the existing badge Secret, preserves the internal and Radar tokens, sets the badge API URL, and restarts badge-control and both stations. Run between rehearsals because restarting badge-control clears its current in-memory queue and PDFs. A failure stops the command; inspect the cluster and rerun after fixing it. Secret values are never printed.

Ali must persist `INCIDENT_API_BASE_URL: http://incident-api:8000/api/v1` in `deploy/badge/badge-config.yaml` and add `../incident` to `deploy/platform/kustomization.yaml` in his lane. Until that lands, reapplying the old platform config clears the connection URL. This deployment does not change Radar's mock setting or add persistence to the badge queue.

## Verify the combined rehearsal

Forward the API to the local board with `kubectl --context CONTEXT -n team-backstage port-forward service/incident-api 8000:8000`. Set Kunj's API URL to `http://127.0.0.1:8000/api/v1` and configure the private organizer and IT identities outside Git.

1. Scale Station A to zero and wait for its pod to disappear, as in [Ali's drill](../badge/README.md#staged-outage-drill).
2. Reset and seed the three synthetic jobs through badge-control's authenticated admin routes. Do not run Ali's existing drill Job for this test, because that Job calls reroute itself and bypasses the API's approval flow.
3. Wait for a Room C badge incident to reach `plan_proposed`. Approve as organizer, then accept as the assigned IT staff member.
4. Confirm all three jobs finish on Station B, each has a PDF, and the API timeline ends in `verify`, `close` with three completion evidence IDs.
5. Restore Station A to one replica, including if the rehearsal fails.

Record the cluster context, deployed SHAs, incident ID, timeline, job/PDF checks, and restored Station A health in the lane handoff. Deployment readiness alone does not prove this rehearsal passed.

The local HTTP equivalent can be rerun without cluster access using `BADGE_SMOKE_SOURCE="$PWD/services/badge-simulator" make check-api`. It tests the actual simulator against the API, organizer and staff gates, three PDFs, and the closing timeline.

For a Radar-only deployment without kubeconfig, follow [Ali's connection handoff](../../docs/handoffs/ali-connect-cluster.md). `render.py` emits the same resources as standalone YAML. After changing bootstrap.py with this render path, restart the API explicitly because the ConfigMap name stays fixed.

## Telemetry and evidence release

See [the operations runbook](../../observability/README.md). The deployment enables
HTTP/protobuf OTLP to the internal collector and adds service/environment/release
resources. Update **both** `CODE_SHA` pins before rollout; they must name the same
published revision containing the telemetry/evidence code. Existing pinned code
is not upgraded by merely enabling OTEL. Evidence index bootstrap, isolated QA
prefix and live provider proof remain integration prerequisites. Keep one writer.

`EVIDENCE_PROJECTION_ENABLED` defaults to `false` in this manifest. Provision
`${ELASTICSEARCH_INDEX_PREFIX}-incident-evidence` from the isolated evidence mapping
and give the runtime identity scoped `read`, `create_doc`, `view_index_metadata`,
and `maintenance` refresh privileges before changing it to `true` and rolling out.
Optional `DASH0_TRACE_URL_TEMPLATE` is a server-only HTTPS Dash0 `{trace_id}` URL.
