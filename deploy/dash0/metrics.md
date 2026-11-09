# Incident timing metrics and the high-priority SLO

Four histograms cannot answer "acknowledged within 60 s and resolved within 5 min" for the same incident, and they never see an incident that is still open. So the SLO uses one outcome counter. incident-api records each outcome exactly once, and it uses deadline timers so overdue incidents count as misses. Luke owns emitting these metrics. This file is the contract.

## Metric contract (emitted by `incident-api`)

All attributes use underscores, so PromQL can match them without UTF-8 quoting. Each metric carries exactly two attributes: `incident_type` (`overflow`, `stage_av`, `badge_stall`, `reported_problem`) and `incident_priority` (`normal`, `high`). The SLO counter adds the two `slo_*` attributes. Incident IDs, event IDs, staff IDs and room IDs never appear as attributes. They go on spans as `incident.id` and `event.id`.

| OTel name | Type, unit | Recorded when | Value |
| --- | --- | --- | --- |
| `backstage.incident.detection.delay` | histogram, `s` | `raise` commits | detection time minus `occurred_at` of the first qualifying signal |
| `backstage.incident.dispatch.delay` | histogram, `s` | first `dispatch` commits | first dispatch minus detection |
| `backstage.incident.acceptance.delay` | histogram, `s` | first `ack` with `decision=accepted` commits | first acceptance minus first dispatch |
| `backstage.incident.resolution.duration` | histogram, `s` | `close` commits (verified) | resolution minus detection |
| `backstage.incident.slo.outcomes` | counter, `{incident}` | see below, high priority only | 1 |

Histogram bucket boundaries, in seconds: `1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 300, 450, 600, 900`. Boundaries at 60 and 300 keep both deadlines exact.

### `backstage.incident.slo.outcomes`

Extra attributes are `slo_objective` (`ack_60s`, `resolve_300s`, `joint`) and `slo_outcome` (`met`, `missed`). For every high-priority incident, each objective is recorded once:

- `ack_60s`: `met` if the first human acceptance commits within 60 s of detection. `missed` when the 60 s timer fires first. A late acceptance records nothing more.
- `resolve_300s`: `met` if verified `close` commits within 300 s of detection. `missed` when the 300 s timer fires first. An escalated or still-open incident is caught by the timer.
- `joint`: `met` only when `resolve_300s` is met and `ack_60s` was met. `missed` as soon as either objective misses.

The timers must survive an API restart. Recompute them from the persisted detection time on startup, and dedupe by `(incident_id, objective)` in the incident document so a retry never double counts.

## Queries (PromQL as Dash0 runs it)

Dash0 selects OTel metrics by `otel_metric_name` because dotted names are not valid Prometheus metric names.

```promql
# Joint SLO, % met over 1 h (target 90). Swap slo_objective for ack_60s or resolve_300s.
100 * sum(increase({otel_metric_name="backstage.incident.slo.outcomes", incident_priority="high", slo_objective="joint", slo_outcome="met"}[1h]))
  / sum(increase({otel_metric_name="backstage.incident.slo.outcomes", incident_priority="high", slo_objective="joint"}[1h]))

# Misses so far, by objective
sum by (slo_objective) (increase({otel_metric_name="backstage.incident.slo.outcomes", incident_priority="high", slo_outcome="missed"}[1h]))

# p90 per stage, by type and priority. Repeat for dispatch.delay, acceptance.delay, resolution.duration.
histogram_quantile(0.9, sum by (incident_type, incident_priority) (rate({otel_metric_name="backstage.incident.detection.delay", otel_metric_type="histogram"}[5m])))
```

`slo-check-rules.yaml` and `dashboard-incident-timing.yaml` use these exact expressions.

## Verification status

- The formats are Dash0's own: `PrometheusRule` with `dash0-threshold-degraded` and `dash0-threshold-critical` plus `$__threshold`, and `PersesDashboard` `perses.dev/v1alpha1` with `PrometheusDataSource`, `TimeSeriesChart` and `PrometheusTimeSeriesQuery`. Both were checked against dash0.com docs on 2026-11-09. Neither has been applied to a Dash0 org.
- Unverified: whether `sum by (...)` without `le` is right for these histograms in Dash0. Dash0 says `histogram_quantile` works directly on `otel_metric_name` selectors, but if the panels come back empty, try `sum by (le, incident_type, incident_priority)`. Also unverified: whether `increase()` over a 1 h window gives a meaningful ratio for a demo with a handful of incidents.

Open question: should a high-priority incident downgraded to normal mid-flight keep its recorded outcomes?
