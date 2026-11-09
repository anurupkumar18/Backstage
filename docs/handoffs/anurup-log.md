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
