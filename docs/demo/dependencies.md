# Open dependencies

The Kunj lane builds against contracts. These items, owned by other lanes, decide whether each demo segment is live, replayed or cut.

| Owner | Needed | Blocks | Status |
| --- | --- | --- | --- |
| Luke | `POST /api/v1/signals` accepting `stage-b` signals, and a stage-scoped token in `AUTH_TOKENS_JSON` limited to source `stage-b` and the four stage kinds | Stage AV live segment | Open |
| Luke | Organizer, staff (venue and AV, at least two AV staff for the handoff) and tier-0 demo tokens | Keyboard approve and ack, tier-0 denial | Open |
| Luke | `POST /incidents/{id}/actions` with idempotency and stale 409. The `trace_id` on the incident. | Overflow segment, trace link | Open |
| Luke | Emit the timing histograms and `backstage.incident.slo.outcomes` per `deploy/dash0/metrics.md`, plus spans with `incident.id` and `event.id` | Dash0 SLO view | Open |
| Luke | OTel SDK in `incident-api` and `agent-workers` exporting to `otel-collector:4317` (gRPC) | Correlated trace | Open |
| Luke | Decline handled as handoff to the next candidate (no 60 s wait) | Stuck-to-reassignment segment | Unconfirmed |
| Ali | Namespace name, plus applying `deploy/web` and `deploy/dash0` in the platform overlay, with Services first | Everything deployed | Asked on the board, no answer yet |
| Ali | Secret `dash0-credentials` created in the namespace | Dash0 export | Open |
| Ali | Whether the Dash0 operator and a `Dash0Monitoring` resource exist (for `PrometheusRule` and `PersesDashboard` sync) | SLO check rules as code | Open |
| Ali | A network path from the demo laptop to `web` (TLS Ingress, or port-forward), and from the stage laptop to `localhost` | Stage mic, which needs a secure context | Open |
| Ali | Station A stop, Radar diagnosis, B completes three jobs, evidence saved | Infrastructure segment | Open |
| Edge owner | Two live count feeds for Room B, and camera permission on site | Live overflow, otherwise a labelled replay | Lane unassigned |

Open question: if the edge lane stays vacant, who says "count replay" during the overflow segment, and is that acceptable to the judges?
