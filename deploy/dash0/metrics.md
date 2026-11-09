# Measured incident evidence metrics

The backend implementation is the emitter contract. These instruments use resource
`service.name=incident-api`; `service.version` is the deployed Git SHA and
`deployment.environment.name=demo`. Metric attributes exclude incident, signal,
event and trace IDs, search terms, credentials, and room names.

| Instrument | Type / unit | Attributes |
| --- | --- | --- |
| `backstage.http.requests` | Counter / requests | method, route, status_code |
| `backstage.http.request.duration` | Histogram / seconds | method, route, status_code |
| `backstage.persistence.operations` | Counter / operations | operation, outcome |
| `backstage.elasticsearch.request.duration` | Histogram / seconds | operation, outcome |
| `backstage.evidence.documents` | Counter / documents | kind, outcome |
| `backstage.evidence.projection.duration` | Histogram / seconds | outcome |
| `backstage.evidence.search.duration` | Histogram / seconds | outcome |
| `backstage.evidence.projection.lag` | Observable gauge / revisions (`1`) | none |
| `backstage.incident.transitions` | Counter / transitions | event.type, state, storage.mode |

Persistence `operation` is `load`, `save`, `search`, or `project`; `outcome=error`
counts failed operations. Search error rate is the persistence-error panel's
`operation=search` series. HTTP 4xx includes expected RBAC/conflict failures and
must be investigated by status/route rather than called a service outage.
Projection lag is latest committed snapshot revision minus searchable indexed
revision, **not elapsed time**. Zero lag proves only projector catch-up. It does
not prove fresh sources, healthy capture, or Dash0 delivery.

The dashboard uses Dash0's native histogram selectors and `histogram_quantile`
without `le`; label names are Prometheus-normalized (`service_name`). Queries
remain empty when an instrument has no samples. Never add `or vector(0)` to
turn missing telemetry into a passing result. Low request counts make p95
noisy, so inspect traces and the operation count together.

This implementation does not emit the original incident timing/SLO contract.
`slo-check-rules.yaml` is retained as a historical, **inactive proposal** and is
not in kustomization; do not apply it or claim the 90% lifecycle SLO was measured.

References checked 2026-11-09:
- [Dash0 dashboard source format](https://www.dash0.com/docs/dash0/dashboards/reference-dashboard-source-format)
- [Dash0 native histogram queries](https://www.dash0.com/docs/dash0/telemetry/metrics/write-effective-promql-queries)
- [Dash0 metric names and labels](https://www.dash0.com/docs/dash0/telemetry/metrics/understand-otel-metric-names)

Validate final PromQL and imported panel output against the actual dataset during
cloud QA. YAML parsing alone cannot establish the provider accepted this resource.
