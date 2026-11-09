# Incident evidence delivery and QA — November 9, 2026

Backstage connects committed Elasticsearch incident evidence to scoped search, an accessible inspector, API telemetry and Dash0 browser monitoring. The checkpoint timeline remains authoritative; projection coverage advances only after acknowledged event writes, content-conflict checks and searchable refresh. The UI exposes persistence mode, unknown signal provenance and indexing freshness.

## Source and review boundaries

- Published integration: `f536b757fe510b3af8a4db76a09fd88d81ae6213`, including main `babe5d28410b2e6841ee39ed36c5dce8af50bd04` (calmer board, saved History and server-only voice deployment).
- Independent review passed `61d8f1b58e208262d2e822357877339e245b7598` with no Critical/Important findings. The independent follow-up passed `f536b757` with no new release blockers, including 45 focused UI tests, 30 server tests, TypeScript and changed-path authorization.
- The real cloud lifecycle and provider correlation below ran as `89a37e0-qa`, from `89a37e0a1adc1a22754904c32cac4cc30118afee`. They do not retrospectively verify the newer source.
- API/Vite were restarted at `f536b757`. Health/readiness returned 200; both persisted resolved incidents reloaded at version 8. Events, diagnostics and search returned 200 with eight events and current projection coverage. Browser search opened the matching close event and moved focus to its inspector. Dash0 returned three HTTP spans and an Elasticsearch search span labeled `f536b75-qa` for the read smoke trace `ef536b75000000000000000000000001`; this is final-revision read/export proof, separate from the earlier full lifecycle.
- [PR #21](https://github.com/lukeeskinner/Backstage/pull/21) merged the narrow responsive ownership prerequisite, not the evidence feature.

## Validation

| Area | Boundary | Observed result |
| --- | --- | --- |
| Automated suites | `f536b757` integration | 139 Vitest and 30 Node server tests passed; typecheck/build passed; API 40 passed/1 opt-in live smoke skipped; integration/contracts 8 passed. |
| History and responsive layout | `f536b757` integrated board/History | History exposed both resolved incidents and all eight timeline events. Board and History fit at 390/768/1440/1920 CSS pixels; `integrated-*.png` and History screenshots are in the delivered evidence bundle. |
| Proxy and sidecar | Integrated configuration | Native nginx reached the actual collector and combined Node sidecar; telemetry transport returned 200, invalid voice requests 401 and private paths 404. This is bounded local transport proof. |
| Browser lifecycle/failure recovery | `89a37e0-qa` | Organizer approval and staff acceptance preceded 60 seconds of fresh evidence; no early close. Search/drilldown, same-version timeline retry, denial recovery, credential replacement and delayed-response isolation passed. |
| Elasticsearch restart | Separate isolated rehearsal; artifact has no source SHA | Full checkpoint lifecycle survived restart. Projection stayed at eight events after cold restart; room/type/time filters, scoped denial and resolved diagnostics passed. |
| Dash0 provider correlation | `89a37e0-qa` | Incident/request spans, correlated committed logs, browser SQL and release-labeled metrics were observed. Nine dashboard panels were accepted/read back and their queries succeeded. |
| Accessibility | Earlier live browser QA plus integrated width checks | Keyboard approval/acceptance, event navigation/focus and reduced motion passed. The 200% check was reflow emulation; native browser-menu zoom remains untested. |

Evidence bundle: `playwright/QA-REPORT.md`, `cloud-lifecycle-evidence.json`, `final-release-smoke.json`, `final-layout-recheck.json`, `integrated-*.png`, `16-integrated-history.png`, `17-integrated-history-phone.png`, `live-restart.json`, `merged-web-smoke.json`, `cloud-verification-summary.json`, `cloud-browser-events-sql.json`, and `dash0-dashboard-evidence.md`, `final-runtime-smoke.json`, `final-cloud-read-trace.json` and `deployment-source-archive-check.json`. These sanitized artifacts are delivered separately; credentials are excluded. The original fixed-prefix opt-in test remained skipped in the suite; a separate random-prefix real Cloud rehearsal supplies bounded restart evidence.

## Recorded cloud demonstration

Synthetic incident: `inc-overflow-3d4b11e8ab2e42f49e211110efb14ba7`, resolved at version 8. On November 9 UTC, raise occurred at `21:18:05.165483Z`, staff acceptance at `21:19:02.346446Z`, verification start at `21:19:04.309949Z`, and close at `21:20:04.301631Z`. The browser was still verifying at 30/60 seconds; final projection/checkpoint revisions matched at `21/1`.

- [Incident trace](https://app.dash0.com/goto/traces/explorer?trace_id=d060bfd99f106c0caeca1e0e972d9921&org=de72ff53-9574-472a-8a5b-b00e4d5952e1&dataset=default&from=2026-11-09T21:17:00Z&to=2026-11-09T21:21:00Z).
- [Browser approval request trace](https://app.dash0.com/goto/traces/explorer?trace_id=d0420000727d0298d9c56ca432621ef2&org=de72ff53-9574-472a-8a5b-b00e4d5952e1&dataset=default&from=2026-11-09T21:17:00Z&to=2026-11-09T21:21:00Z).
- Dashboard: **Backstage measured API and evidence**, ID `api-9c3b3b01-71b8-411c-b01a-ec2dd38d6644`, organization `de72ff53-9574-472a-8a5b-b00e4d5952e1`, dataset `default`. Use the recorded time range and separate `service_version` series; low-volume quantiles are approximate.

Dash0 normalizes the browser parent span into `dash0.trace.origin.web.event.id`; the approval event ID `79783c4a4caa01bf` matches the browser SQL capture. This is documented in [span attributes, footnote 18](https://www.dash0.com/docs/dash0/opentelemetry/semconvs/attributes/span). An earlier empty generic browser-events query did not establish missing browser ingestion.

The Agent0 investigation **“Backstage incident-api load errors: outage vs not-found misclassification”** found older cumulative errors and no outage evidence in its available window. Original failed spans were unavailable. A local failing regression independently proved that expected empty-checkpoint `found:false` responses were incorrectly counted as load errors; `61d8f1b` fixes that telemetry boundary while preserving missing-index 503/error behavior. This does not prove the cause of every historical cloud error.

## Two-minute recorded demo

1. Sign in with the configured organizer identity; open History and the recorded resolved incident. Show all eight events and the approval/acceptance gates.
2. Open the inspector/evidence search on the board, search `Room B` with room `room-b` and event type `close`, and select the matching event.
3. Show 60/60 seconds of actual evidence, observation versus receipt times, durable storage, unknown provenance and projection freshness. Current revisions may have advanced since the capture.
4. Open the incident and approval trace links, then the measured dashboard with the recorded time range. A configured trace link alone is not ingestion proof; the provider captures above supply the observed correlation.

For a fresh synthetic rehearsal, keep one API writer and choose an isolated provisioned Elasticsearch prefix. Supply `CAM_SIGNAL_TOKEN` privately. With the configured API already running:

```sh
python services/incident-api/replay_overflow.py trigger --base-url http://127.0.0.1:8010/api/v1
# Organizer approves; assigned staff accepts. Await the acceptance HTTP 200.
python services/incident-api/replay_overflow.py clear --base-url http://127.0.0.1:8010/api/v1
```

The trigger takes 30 seconds; qualifying recovery samples must span 60 seconds after acceptance. Inspect the committed close event rather than assuming script completion proves recovery.

## Project and operator handoffs

- **Integrator/Anurup:** publish the reviewed feature PR/handoff. Application source and API deployment pins are `f536b757`; later changes only update the pins and delivery documentation.
- **Luke/backend:** preserve single-writer checkpoint semantics, idempotency, lifecycle/RBAC and attempted-versus-committed telemetry. Additive contracts are at `aec8576ba4aae08a9344b5d867d2db79d9f06863`.
- **Kunj/web/observability:** retain credential isolation, same-version event retries, inspector keyboard/focus behavior and privacy filtering while preserving the merged board, History and voice paths.
- **Ali/platform and edge owner:** coordinate cluster deployment and live-source rehearsals separately; prior team cluster reports are distinct from this contribution's independent evidence.

Operators should provision the evidence alias before `EVIDENCE_PROJECTION_ENABLED=true`, keep one writer, configure actual release labels, and preserve shared-cluster identities/Secrets. Backend OTLP exports to the collector with `OTEL_ENABLED=true`; the browser uses `/otel` and receives no vendor credential. Run Uvicorn with `--no-access-log`, keep collector credentials server-side, and update the existing dashboard by ID. See [API setup](../../services/incident-api/README.md), [web setup](../../apps/web/README.md), [collector operation](../../observability/README.md), and [Elasticsearch provisioning](../../data/elasticsearch/README.md).

## Limits

This is a synthetic isolated rehearsal. Shared-cluster deployment of this slice, live camera and real microphone/voice operation are unverified. Full SLO timers, semantic search and production readiness are outside the demonstrated scope. Signal provenance stays unknown. Search is bounded lexical event search; `total` counts returned authorized hits. Freshness describes indexing coverage, not source health; watermark coverage is rebuilt after projector restart. The final integration review and read/export smoke passed; a full second lifecycle was not repeated on the final source. Both upstream and fork archives for the pinned source returned 200 with identical checksums and matching inspected runtime files.
