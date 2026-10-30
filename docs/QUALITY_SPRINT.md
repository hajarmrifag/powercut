# Engineering quality sprint

This report records the October 2026 host-side audit. It does not replace the
historical Vega Virtual Device evidence in `ENGINE_BENCHMARKS.md` and does not
claim a new on-device performance result.

## Baseline and implemented changes

The clean `main` baseline passed 295 checks: 253 Jest, 12 reference-server,
16 solver/verifier, and 14 repair-search checks. TypeScript passed and ESLint
reported 0 errors with 34 existing warnings.

This sprint adds:

- host-only GitHub Actions jobs for locked Node installation, TypeScript,
  ESLint, Jest, all three Python suites, oracle regeneration, and fixture-drift
  detection;
- one focused Jest regression that reproduces the forced-compromise plan,
  verifies its repair, and fixes the execution budget at 629 `solve()` calls;
- current-vs-historical count reconciliation; and
- a consolidated README using captured Vega screenshots and explicit runtime
  boundaries.

The Python oracle, generator behavior, solver, verifier, repair algorithm, and
production execution path are unchanged.

## Expensive repair-search investigation

### Reproduction

The expensive case uses a 1300Wh/200W battery and the maximum permitted hours
for all six appliances. Flexible-only changes cannot make it feasible, so the
search exhausts the first tier and then examines pairs containing fridge or
router.

`test/repair-search-cost.spec.ts` runs this through `buildPlan`, not a reduced
helper. It checks the deterministic result (fridge 12h → 5h,
`requires_compromise`) and counts 629 solver calls. This turns the earlier
one-off instrumentation result into a regression boundary without asserting a
machine-dependent time.

Historical device evidence remains:

- before the duplicate-search optimization: 770 calls and 2056ms median on a
  release build in the Vega Virtual Device;
- after the optimization: 629 calls, an 18.3% deterministic reduction;
- follow-up wall-clock runs were too noisy to establish a speedup, so no
  before/after timing claim is made.

### Concurrency decision

The current `setTimeout(0)` boundary allows press feedback to commit before a
calculation starts. It does not yield during the calculation.

Three options were reviewed:

1. **Web Workers:** Amazon documents them for Vega web apps running in a
   WebView. That is not evidence that the `Worker` API is supported in a React
   Native for Vega JavaScript bundle, and the installed React Native/Vega
   packages expose no application-level worker API. This route was rejected.
2. **Turbo Module/native worker:** Amazon documents that Turbo Module methods
   enter on the JS thread and may create a non-JS native thread for expensive
   work. This is an officially supported route, but it would require a native
   module, native lifecycle/error handling, and device compatibility testing.
   It is disproportionate to the current engine and risks splitting the
   TypeScript/Python correctness boundary a third way.
3. **Cooperative TypeScript search:** restructuring the repair search as a
   resumable state machine could yield between deterministic chunks while
   keeping one implementation. This is the best candidate for a future sprint,
   but it must include stale-request cancellation, ordering equivalence tests,
   and release-build Vega evidence. Merely inserting a Promise or wrapping the
   existing synchronous function would not prevent JS-thread blocking.

No concurrency change was made because the available host environment cannot
validate Vega responsiveness or compatibility, and this sprint does not claim
a UI-blocking fix without that evidence.

Official platform references:

- [React Native for Vega performance](https://developer.amazon.com/docs/react-native-vega/0.83/performance)
- [Advanced Turbo Module topics: threading](https://developer.amazon.com/docs/vega/0.22/advanced-turbo-module-topics)
- [Web Worker best practices for Vega web apps](https://developer.amazon.com/docs/vega/0.21/webview-web-workers-best-practices)

## Test-count reconciliation

| Evidence point | Jest composition | Cross-stack total | Meaning |
|---|---:|---:|---|
| Phase A report | 15 UI + 164 differential = 179 | Not reported as one total | 163 oracle cases plus one sanity check |
| Phase B report | 19 UI + 231 differential = 250 | Not reported as one total | 230 oracle cases plus one sanity check |
| Pre-sprint `main` | 21 UI + 232 differential = 253 | 295 | 231 oracle cases plus one sanity check; adds later UI/mixed-tier coverage |
| Quality sprint | 21 UI + 232 differential + 1 cost = 254 | **296** | Adds the deterministic 629-call regression |

The original phase reports retain their measured values. Their counts are
historical milestones, not claims about the current tree.

## Validation boundary

GitHub Actions can validate everything listed above on Ubuntu. It cannot build,
launch, navigate, or benchmark the proprietary Vega runtime. A future execution
change must be verified in a release build on a Vega Virtual Device or target
hardware before making responsiveness or compatibility claims.
