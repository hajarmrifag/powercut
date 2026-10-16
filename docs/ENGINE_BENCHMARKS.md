# TypeScript engine: on-device benchmark methodology and raw results

Companion to `docs/ENGINE_PORT.md` — that document has the summary table
and the headline finding; this one has the methodology, the raw
evidence, and the full story of getting a trustworthy number, including
a dead end that was itself informative.

## Method

A temporary screen, `src/BenchmarkScreen.tsx`, was swapped in as the
app's root component (one-line change to `index.js`, reverted
immediately after) for this measurement only — it is not part of the
shipped app and `index.js` does not reference it. It calls the real
engine functions (`buildPlan`, `defaultConfig`) from `src/engine/`
directly, timing each call with `Date.now()`, on a release build running
on the actual Vega Virtual Device (not Node, not Jest — Hermes, the
RN JS engine actually used on-device, which interprets rather than
JIT-compiles).

Four categories, chosen to span the real cost range:

1. `defaultConfig()` — the roster fetch, no solving.
2. A feasible edit (laptop → 1h) — one `solve()` call, no repair search.
3. The default scenario, infeasible — one `solve()` call plus a repair
   search that succeeds in the first (`protects_essentials`) tier. This
   is the actual shipped demo scenario.
4. A scenario engineered so the `protects_essentials` tier search (4
   flexible appliances) finds no repair, forcing the full
   `requires_compromise` tier (all 6 appliances, including fridge/router
   whose 12-hour ceiling makes their pair-search axis far more expensive
   than the 1–4 hour ceilings of lamp/phone/laptop/fan) to also run its
   complete single- and two-appliance search. Same scenario as the
   `forces_compromise_tier` differential test case: `usable_wh=1300`,
   every appliance at its maximum hours.

## A dead end that was itself a real finding

The first version of the harness ran each category as 200/200/100/100
back-to-back calls inside one tight synchronous loop, yielding to the
event loop only *between* categories. It was silently killed by the
platform partway through — every time, at the same point: partway into
category 4, the expensive one. No crash log was available (`logcat`/
`dumpsys` aren't present on this Virtual Device image — see
`docs/VEGA_SDK_FRICTION_LOG.md`), but the signature (clean up through the
cheap categories, silent death only once the blocked-thread duration
crossed into the ~2+ second range on the expensive one) is the classic
pattern of an ANR-style watchdog on a blocked JS thread, not a code
exception.

This was treated as a real result, not a bug to route around quietly: it
is direct, on-device evidence that a long synchronous run of engine
calls can get an app killed on this platform, which is exactly the
failure mode `src/api.ts`'s per-call `setTimeout` deferral exists to
avoid. The harness was rewritten to `await` a `setTimeout(0)` yield after
*every single* iteration (not just between categories) and reduced to
10 iterations per category for a faster, still-statistically-useful
sample. That version completed cleanly end to end, twice, and produced
the numbers below.

## Raw results (final, clean run)

Screenshot: `evidence/screenshots/phase-a/benchmark/final-results.png`.

```
defaultConfig() x10
  median 0ms / p95 0ms / max 0ms

feasible plan (laptop=1h) x10
  median 1ms / p95 2ms / max 2ms

default infeasible, 1 repair tier x10
  median 43ms / p95 182ms / max 182ms

worst-case repair search (both tiers) x10
  median 2056ms / p95 2104ms / max 2104ms
```

(p95 and max coincide at n=10 because the 95th percentile index and the
last index are the same for a 10-element sorted sample — expected, not a
measurement error.)

## What this means in practice

- The scenario actually used in the shipped demo (default scenario,
  single repair tier) is 43ms median, 182ms worst-of-10 — well within
  what feels instant for a button press, especially deferred one
  macrotask as it already is.
- The ~2-second worst case is real but is a narrow edge case: it only
  happens when a household's own edits leave literally no
  essentials-preserving repair available. It does not crash or freeze
  the app (the deferred-call architecture means the existing "Saving…"
  indicator covers it, same as any other in-flight calculation), but 2
  seconds is a noticeably long wait if a judge or user happens to hit it
  live.
- A real, scoped optimization exists (described in `ENGINE_PORT.md`'s
  "Known limitation" section: stop redoing the flexible-appliance search
  twice across the two tiers) but was not implemented in this phase —
  flagged to the project owner as a trade-off decision rather than
  rushed into already-differential-tested code against a deadline.
