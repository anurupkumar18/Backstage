# Anurup's Dash0 and evidence updates

## 2026-11-09 — Scoped contribution ownership prerequisite

- Branch or PR: `anurup/ownership-bootstrap`; dependent work on `anurup/incident-evidence`.
- Changes and why: add explicit contributor grants without replacing existing Luke/Kunj/Ali ownership. Exact-file grants do not match filename prefixes; both sides of a rename remain checked.
- Impact by lane: Luke must land this prerequisite through an existing authorized lane before the dependent PR can pass the base-revision check. No bypass or workflow permission change. Kunj retains the UI and pending phone/inbox work; inspector integration is additive.
- Verified commands and results: `python3 -m unittest discover -s tests/integration -p test_changed_paths.py -v`; five tests covering allowed sharing, exact-file bounds, wrong author/branch/path rejection, rename rejection, and existing owner behavior.
- Open issues and next owner or action: Luke integrates the prerequisite. Feature implementation and cloud verification continue independently; no live deployment claim.
- References and latest handoffs reviewed: `main@ab2798a`, `kunj/phone-join@4d2d5c6` (PR12), `ali/connect-incident-api` published cluster rehearsal, Kunj codex handoff and all lane logs on base main.

## 2026-11-09 — Complete the concrete frontend integration grants

- Branch or PR: ownership prerequisite PR #16.
- Changes and why: include the existing presence-copy regression file and mock transport adapter in the exact-file allowlist. The contribution makes mock evidence explicitly unavailable and reuses Kunj's corrected privacy-copy assertion.
- Verified commands and results: ownership tests remain 5/5; no ownership grants outside the implemented evidence integration.
- Next action: Luke lands this prerequisite using the existing authorized maintainer flow. Feature runtime proof continues separately.

## 2026-11-09 — Implement live observability and searchable incident evidence

- Branch: `anurup/incident-evidence`, dependent on ownership prerequisite PR #16.
- Changes and why: configured API OTLP traces/logs/metrics; attempted-versus-committed transition semantics; immutable committed evidence projection and scoped search/diagnostics; isolated interactive inspector; actual Dash0 SDK browser monitoring and dedicated same-origin `/otel` proxy; measured dashboard and rollout instructions. Checkpoint remains authoritative and single-writer. No SLO or live-sensor claim.
- Impact: provision a separate evidence alias and enable projection explicitly. Backend exports HTTP/protobuf to the collector. Browser SDK posts traces/logs under `/otel`; collector keeps vendor credentials server-side. New additive search/diagnostics contracts and success examples included. Historical provenance stays unknown; mock evidence is explicitly unavailable.
- Verified: API suite 38 tests (37 pass, opt-in live Elastic restart skipped), contract/integration 8 pass; frontend typecheck/build, Vitest 85 pass and relay 8 pass; actual installed SDK regression verifies API traceparent, navigation export and URL scrubbing. Native collector0.164.0 configs validate and synthetic trace/log ingestion works. Independent ops review caught and verified fixes for transport-prefix suppression, release metadata and false-zero projection lag.
- Open: parent is performing real Elastic/browser/Dash0 QA, final independent branch review, latest-main reconciliation and release pins. No cluster or provider ingestion success is claimed by this entry.
- Reviewed: main through `e9078ed` (phone join and Ali cluster connection), PR17 floor briefing is still separate work. Preserve those features on integration.
## 2026-11-09 — Permit the verified phone navigation correction

- Branch: `anurup/responsive-ownership`; prerequisite for the evidence feature PR.
- Change: add exactly `apps/web/src/styles.css` to Anurup's contributor grant. No owner is replaced and no workflow/check bypass is included.
- Reason: after integrating Kunj's four-link navigation from main5465ebc, Playwright measured a390px viewport with454px document width. A single `grid-template-columns: minmax(0, 1fr)` on `.shell__header` restores390/390 and allows existing flex wrapping. The feature branch contains the tested correction; this grant must land on its base first.
- Verified: evidence branch full136 Vitest +30 Node tests, typecheck/build; browser390/768/1440/1920 all fit. Ownership checker regression suite is unchanged.
- Next owner: Luke lands this narrow addendum, as with PR16. Feature delivery continues independently.
- Reviewed: main5465ebc including Kunj's briefing/voice scope fixes; all lane logs through the previous integration.

## 2026-11-09 — Incident evidence delivery and final integration handoff

- **Branch or PR:** `anurup/incident-evidence`; [PR #21](https://github.com/lukeeskinner/Backstage/pull/21) merged only the narrow responsive ownership prerequisite at `7fe7c40`.
- **Changes and why:** shipped committed Elasticsearch event projection/search, scoped diagnostics and inspector, API/browser Dash0 telemetry, measured dashboard, privacy controls and additive contracts. Resolved this log by retaining both historical entry blocks. Detailed delivery/demo evidence is included in the separately delivered `backstage-evidence/DELIVERY.md` artifact.
- **Reviewed boundary:** independent review passed source `61d8f1b58e208262d2e822357877339e245b7598` with no Critical/Important findings. The real cloud rehearsal ran as `89a37e0-qa`, not that later final source. Its incident `inc-overflow-3d4b11e8ab2e42f49e211110efb14ba7` resolved at version 8 after 60 seconds of fresh recovery evidence; incident trace `d060bfd99f106c0caeca1e0e972d9921` and approval trace `d0420000727d0298d9c56ca432621ef2` were observed in Dash0. Browser SQL matches the approval event; Dash0 stores its normalized browser parent in `dash0.trace.origin.web.event.id`.
- **Latest integration checks:** integrator reports merged main `babe5d2` working tree passes 139 UI tests, 30 server tests, typecheck/build, API 40 passed/1 opt-in skipped and integration 8 passed. History displayed two resolved incidents with all eight events. Native nginx reached the actual collector and sidecar with transport 200; invalid voice requests returned 401 and private paths 404. These checks precede the final merge commit/source pin and its runtime restart.
- **Other verified evidence:** isolated real Elastic checkpoint restart and projection replay remained at eight event documents; room/type/time filters and scoped denial passed. Collector/proxy checks, timeline retry, credential isolation, keyboard navigation and responsive widths are documented in the delivered artifact bundle. Agent0's load-error investigation found old cumulative errors and no outage evidence; the local empty-checkpoint 404 metric regression was fixed at `61d8f1b`. Original failed cloud spans were unavailable, so causation of every historical error remains unproven.
- **Project handoff:** integrator commits the reconciled main, pins the actual source SHA, performs the final runtime smoke and publishes the focused feature PR. Luke retains the checkpoint/lifecycle/contracts; Kunj retains board/history/voice integration and inspector privacy/retry behavior; Ali and the edge owner coordinate separate cluster/live-source rehearsals.
- **Operator handoff and limits:** provision evidence aliases before enabling projection, keep one writer, supply private credentials outside Git, use `/otel` for browser export and collector-only Dash0 credentials, and preserve per-release dashboard series. Dashboard `api-9c3b3b01-71b8-411c-b01a-ec2dd38d6644`, organization `de72ff53-9574-472a-8a5b-b00e4d5952e1`, dataset `default`. Native browser zoom remains untested (reflow emulation only); shared-cluster deployment of this slice, live camera/voice, full SLOs and semantic search are not established. Signal provenance remains unknown.
- **References reviewed:** AGENTS, CONTRIBUTING, base ownership grants, both sides of this handoff merge, Kunj's updates through main `babe5d2`, contract revision `aec8576ba4aae08a9344b5d867d2db79d9f06863`, and saved cloud/browser/operations artifacts. No application source changes or credential-file reads in this documentation task.
