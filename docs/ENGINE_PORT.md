# Phase A: the solver/repair engine runs in-app (TypeScript), not on a Python server

## What changed

`src/engine/` is a line-for-line TypeScript port of `engine/solver.py`,
`engine/verifier.py`, `engine/repairs.py`, `engine/run_experiment.py`'s
`fixture()`, and `backend/server.py`'s orchestration logic
(`build_plan`, `default_config`, request validation). `src/api.ts` no
longer calls `fetch()` against `http://10.0.2.2:8766` — it calls the new
engine directly, in-process, wrapped in a one-macrotask `setTimeout`
deferral so a calculation never runs synchronously inside the same frame
as the button press that triggered it. `App.tsx` was not changed beyond
one wording fix ("Backend error" → "Calculation error"): `api.ts` kept
the exact same two exported function signatures
(`fetchDefaults(): Promise<Defaults>`, `fetchPlan(usableWh, maxW,
appliances): Promise<Plan>`), so the UI layer needed no other changes.

**The Python engine and backend are untouched and still work exactly as
before** (`python3 backend/server.py`, same endpoints, same responses) —
they remain the reference implementation and the differential test
oracle. Nothing about them was modified in this phase.

## Why

Every prior build of this app required a judge or user to run a second
terminal (`python3 backend/server.py`) alongside the Vega Virtual Device
for the app to show anything beyond a loading/error state. That's a real
submission risk independent of the product idea — the TS port removes it
entirely. A build from this branch shows a working, fully interactive app
with the Python server never started, proven below.

## Correctness: how we know the port is right, not just "looks right"

Not by inspection. `engine/differential/generate_cases.py` calls the
**real, unmodified Python engine** (via `backend.server.build_plan` /
`default_config`, exactly as the old backend did) across 163 scenarios:

- 13 hand-picked fixed cases — the shipped default (infeasible), both
  known single-appliance repairs (laptop→1h, fan→1h), the tied-repair
  scenario that caught a real ranking-determinism bug earlier in this
  project, the exact demo sequence (laptop=1h, fan=5h), all-appliances-
  at-zero, all-appliances-at-max, extreme-low-capacity (no repair
  possible), a household directly reducing fridge/router (exercises
  `critical_reduced`), a scenario engineered to force the
  `requires_compromise` fallback tier, and a pure power/window conflict.
- 150 scenarios randomized under a fixed seed (`20261016`) across
  `usable_wh`, `max_w`, and every appliance's `required_hours`.

`test/engine-differential.spec.ts` runs every one of those 163 inputs
through the **TypeScript** engine and asserts the result is `toEqual`
the Python output, field for field — including the full nested
`problem`/`result`/`independent_verification` objects and every
alternative's `changed`/`summary`/`tier`/`touches_critical` — after
stripping only the fields that cannot and need not match across
languages (`nonce`, `instance`, `time_utc`, `elapsed_ms`,
`states_visited`).

**Result: 164/164 pass** (163 cases + 1 sanity check on case count).
This caught one real bug during development: the TS `fixture()` port
initially omitted the `synthetic`/`assumptions` metadata fields the
Python original includes on every `problem` object — fixed, reverified.

Re-run anytime with:
```
python3 engine/differential/generate_cases.py   # regenerate expected outputs from Python
npx jest test/engine-differential.spec.ts        # compare TS against them
```

`test/App.spec.tsx`'s 15 UI tests were updated to mock `src/api.ts`'s two
functions directly instead of `global.fetch` (there is no network call
left to intercept) — same fixtures, same assertions, same intent
(sequencing, the in-flight-press guard, error surfacing on the right
screen).

## Proof it runs with the Python backend completely stopped

1. Killed the running `backend/server.py` process; confirmed
   `curl http://127.0.0.1:8766/health` returns connection-refused.
2. Built the release package and launched it on the Virtual Device.
3. Ran the full real workflow — launch (default INFEASIBLE,
   1908/1800 Wh), reduce laptop to 1h (live FEASIBLE, 1778/1800 Wh),
   increase fan to 5h (live INFEASIBLE again, exact conflict
   explanation: "...needs 1803 Wh... shortfall of 3 Wh"), open
   alternatives (both repair cards, correct numbers), apply Alternative A
   (back to FEASIBLE, 1778/1800 Wh, fan restored to 4h) — all recomputed
   live, in-app, with zero network activity.
4. Every number at every step matched the differential-tested Python
   values exactly. Screenshots: `evidence/screenshots/phase-a/` (local
   only, see that directory's own note on what's committed).

## Performance: real on-device numbers, not estimates

Measured with a temporary benchmark harness (`src/BenchmarkScreen.tsx`,
not wired into `index.js` — swapped in only for this measurement, then
reverted) on the actual Vega Virtual Device, release build, Hermes
runtime (no JIT, unlike the Python/Node environments used for
development):

| Scenario | median | p95 | max | n |
|---|---|---|---|---|
| `defaultConfig()` | 0ms | 0ms | 0ms | 10 |
| Feasible plan (laptop=1h) | 1ms | 2ms | 2ms | 10 |
| Default infeasible, single repair tier | 43ms | 182ms | 182ms | 10 |
| **Worst case: both repair tiers forced** | **2056ms** | **2104ms** | **2104ms** | 10 |

The worst-case row only triggers when the `protects_essentials` tier
search (4 flexible appliances) finds fewer than 2 repairs and the full
`requires_compromise` tier (all 6 appliances, including fridge/router
with their larger 12-hour ceilings) re-runs its own complete single- and
two-appliance search on top. That ~2-second case is **not the shipped
demo scenario** (the actual default-scenario repair search measured
43–182ms) — it requires a household edit that leaves no essentials-
preserving fix at all. See "Known limitation" below.

**Real finding during benchmarking, not assumed:** an early version of
this harness ran each category as one tight synchronous loop (no
yielding between individual iterations) and was silently killed by the
platform partway through the worst-case category — almost certainly an
ANR-style watchdog on a blocked JS thread, since it reproduced exactly at
that category and nowhere else. This is direct, on-device evidence for
why `src/api.ts` defers each *individual* engine call rather than
assuming any single call is automatically safe: a real button press
triggers exactly one `buildPlan()` call, and that call needs to either
be fast or itself be interruptible — never assume "it's just JS, it'll
be fine." The final harness yields between every iteration and the
numbers above are from that version, which completed cleanly.

## Known limitation: worst-case repair search latency

The ~2-second worst case is real and currently unoptimized. It does not
block the UI thread (deferred execution + the "Saving…" indicator cover
it, same as any other in-flight request), and it is rare — it only
occurs when a household's edits leave literally no essentials-preserving
repair, forcing the full fallback search. The likely fix, not yet done:
the `requires_compromise` tier currently redoes the single- and two-
appliance search for the 4 flexible appliances from scratch instead of
reusing the `protects_essentials` tier's already-computed results for
that subset, and only computing the new work introduced by fridge/router
joining the pool. That would roughly halve the worst-case cost. Flagged
to the project owner as a decision point before further work, per the
instruction to stop and explain trade-offs rather than rush a fix into
already-proven-correct code on a deadline.
