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

## 2026-11-09 — Permit the verified phone navigation correction

- Branch: `anurup/responsive-ownership`; prerequisite for the evidence feature PR.
- Change: add exactly `apps/web/src/styles.css` to Anurup's contributor grant. No owner is replaced and no workflow/check bypass is included.
- Reason: after integrating Kunj's four-link navigation from main5465ebc, Playwright measured a390px viewport with454px document width. A single `grid-template-columns: minmax(0, 1fr)` on `.shell__header` restores390/390 and allows existing flex wrapping. The feature branch contains the tested correction; this grant must land on its base first.
- Verified: evidence branch full136 Vitest +30 Node tests, typecheck/build; browser390/768/1440/1920 all fit. Ownership checker regression suite is unchanged.
- Next owner: Luke lands this narrow addendum, as with PR16. Feature delivery continues independently.
- Reviewed: main5465ebc including Kunj's briefing/voice scope fixes; all lane logs through the previous integration.
