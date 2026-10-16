# TypeScript engine: on-device benchmark methodology and raw results

Companion to `docs/ENGINE_PORT.md`: that document has the summary table
and the headline finding; this one has the methodology, the raw
evidence, and the full story of getting a trustworthy number, including
a dead end that was itself informative.

## Method

A temporary screen, `src/BenchmarkScreen.tsx`, was swapped in as the
app's root component (one-line change to `index.js`, reverted
immediately after) for this measurement only. It is not part of the
shipped app and `index.js` does not reference it. It calls the real
engine functions (`buildPlan`, `defaultConfig`) from `src/engine/`
directly, timing each call with `Date.now()`, on a release build running
on the actual Vega Virtual Device (not Node, not Jest; Hermes, the
RN JS engine actually used on-device, which interprets rather than
JIT-compiles).

Four categories, chosen to span the real cost range:

1. `defaultConfig()`: the roster fetch, no solving.
2. A feasible edit (laptop → 1h): one `solve()` call, no repair search.
3. The default scenario, infeasible: one `solve()` call plus a repair
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
platform partway through, every time, at the same point: partway into
category 4, the expensive one. No crash log was available (`logcat`/
`dumpsys` aren't present on this Virtual Device image; see
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
last index are the same for a 10-element sorted sample; expected, not a
measurement error.)

## What this means in practice

- The scenario actually used in the shipped demo (default scenario,
  single repair tier) is 43ms median, 182ms worst-of-10, fast enough on
  its own to feel instant for a button press. The one-macrotask deferral
  in `src/api.ts` doesn't make this faster; it only ensures the press's
  own visual feedback commits before the calculation starts. The JS
  thread is still blocked for the calculation's own duration once it
  begins, whatever that duration turns out to be. See the worst case
  below.
- The ~2-second worst case is real but is a narrow edge case: it only
  happens when a household's own edits leave literally no
  essentials-preserving repair available. It does not crash or freeze
  the app (the deferred-call architecture means the existing "Saving…"
  indicator covers it, same as any other in-flight calculation), but 2
  seconds is a noticeably long wait if a judge or user happens to hit it
  live.

## Update: the worst-case fallback tier was optimized

See `docs/ENGINE_PORT.md`'s "Optimizing the fallback tier" section for
the full before/after design. Summary of the verification done here:

**Confirmed, not assumed, that duplicate work across tiers was a real
cost.** Instrumented `solve()` with a call counter and profiled the
worst-case scenario (`forces_compromise_tier`) before optimizing:

```
tier 1 (protects_essentials, flexible appliances only): 141 solve() calls
tier 2 (requires_compromise, re-searches ALL appliances from scratch): 627 more calls
total: 770 calls
```

Per-pair profiling confirmed the mechanism precisely: this specific
scenario is tight enough (1300 Wh) that *no* flexible-only combination
(not even zeroing every flexible appliance at once) reaches feasibility,
so tier 1's entire 141-call search finds nothing, and tier 2 then re-runs
that exact same doomed search a second time (same problem, same inputs,
provably the same result) before doing the genuinely new work of
searching pairs that include fridge or router.

**After the optimization** (tier 2 now only searches the combinations
tier 1 didn't already cover; see `ENGINE_PORT.md`): **629 solve() calls,
down from 770, an 18.3% reduction**, measured identically (same
instrumentation, same scenario, same machine) immediately before and
after the code change. This number is deterministic: it counts actual
function calls, not wall-clock time, so it isn't subject to the noise
discussed below.

## On-device wall-clock re-benchmark: an honest result, including a dead end

Re-ran the same benchmark harness on the Virtual Device after the
optimization, expecting to see the worst-case category drop by roughly
the same ~18%. It didn't: two runs came back *slower* (medians 2312ms
and 2279ms) than the original pre-optimization number (2056ms).

Rather than report that at face value in either direction, it was
checked properly: the host machine's load average had climbed from
baseline to 4.5–5.0 over the course of this session (concurrent Chrome
tabs, an editor, another local dev server, the VVD's own QEMU process all
competing for the same CPU; `uptime` and `ps` output captured at the
time). To separate "the optimization is slower" from "the shared machine
got busier," the *original, unoptimized* code was rebuilt and
re-benchmarked on the same device under the same current load, back to
back with the optimized runs. Its worst-case median came back at
**2242ms**, statistically indistinguishable from the optimized code's
2279–2312ms, and itself nearly 200ms slower than ITS OWN earlier
baseline.

**Conclusion: the slowdown across all three same-session runs is
environmental (host contention), not a regression from the optimization.**
The deterministic call-count evidence (629 vs 770, measured by counting,
not timing) is the trustworthy signal here; the wall-clock numbers from
this specific noisy session are not precise enough to cleanly show an
~18% delta when background jitter on a shared machine is itself in a
similar range. Screenshots of all three on-device runs (two optimized,
one same-conditions control) are in
`evidence/screenshots/phase-a/benchmark-optimized/`.

No crashes, freezes, or ANR-style kills occurred in any of the three
runs: the per-iteration-yielding harness and the deferred-call
architecture in `src/api.ts` continue to hold up regardless of the
host-noise issue above.

## What's still true, and what to watch for

- The optimization reduces actual engine work in the worst case by
  ~18%, proven by direct call-count measurement, with zero behavior
  change (164/164 differential tests, including this exact scenario,
  still pass byte-for-byte against the untouched Python reference).
- A clean, low-noise wall-clock confirmation of that ~18% was not
  obtained in this session due to shared-machine load, and is flagged
  here rather than papered over. Re-running this benchmark on a quieter
  machine (or this one at a quieter time) would be the way to get a
  tighter wall-clock number; it isn't necessary to trust the correctness
  or the reduced-work result, both of which rest on the differential
  suite and the call counts, not on timing.
- The remaining cost (629 calls, ~2 seconds on this device) is inherent
  to exhaustively searching pairs that include fridge or router (ceiling
  12 vs. 1–4 for the flexible appliances), not redundancy, and not
  something this optimization was meant to address further.
