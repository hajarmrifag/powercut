# PowerCut

A Fire TV (Vega) app that helps a household plan which appliances to run on
battery backup during a power outage. Built for the Amazon Build, Ship, Shape
2026 Hackathon, Fire TV track.

PowerCut shows a household's current appliance requirements and battery
capacity on one screen, lets you change any of them with the D-pad, and
recomputes feasibility against a real constraint solver after every change.
When a configuration doesn't fit, it explains exactly why and generates up
to two independently-verified repair alternatives, computed fresh for
whatever you changed, not pulled from a fixed pair, and clearly marked by
whether they protect the household's essential services (fridge, router)
or require compromising one. Everything shown on screen is computed live by
a real constraint solver and independent verifier running **inside the app
itself** (`src/engine/`, TypeScript): no backend process, no network call,
no client-side shortcut math. A standalone Python implementation of the
same engine (`engine/`, `backend/server.py`) still exists as the reference
implementation and the oracle for the differential test suite that proves
the two match; see `docs/ENGINE_PORT.md`.

## What it does

1. **Shows a live household energy overview.** Six appliances (fridge,
   router, lamp, phone, laptop, fan) and the battery's capacity/output
   limit, each as a D-pad-navigable card, with an energy bar and a
   FEASIBLE/INFEASIBLE status that reflect the actual current backend
   calculation. Fridge and router are marked **essential** by default, with
   a warning if the household has itself reduced one below full.
2. **Lets you edit any appliance's required runtime, and the battery's
   capacity and output limit, with the remote.** Every change is recomputed
   and redisplayed immediately by the in-app engine. There is no
   client-side approximation, and nothing to wait on over a network.
3. **Explains infeasibility in plain language**, tailored to whatever you
   changed: the minimum set of services that alone breaks the energy
   budget when the limit is energy, or which appliance needs more hours
   than its outage-window has available, or that overlapping appliances
   exceed the battery's output limit even though total energy is fine.
4. **Generates up to two independently-verified repair alternatives**,
   each clearly labeled as either protecting the household's essential
   services or requiring an explicit compromise on one: the automatic
   search (`engine/repairs.py`) only touches fridge/router when no repair
   exists that leaves them alone. Every repair is the proven
   minimum-sacrifice choice for the appliances it changes, not just *a*
   feasible one (see its adversarial brute-force tests), and is
   re-verified by a solver-independent checker before ever being shown.
   Each card states what stays powered, what gets reduced, and the
   trade-off in plain language, side by side so two people can compare and
   pick one together.
5. **Navigates entirely with the D-pad**, as a Fire TV app must: a compact
   two-row overview, per-appliance and battery edit screens with stepper
   buttons, and a side-by-side alternatives screen, all built on the
   standard Vega/Kepler remote-input APIs (`TVFocusGuideView`,
   `useKeplerBackHandler`), Back always returns to the overview. Every
   button that changes data ignores further presses while a request is in
   flight (shown as "Saving…") rather than racing or silently dropping
   input, and any recalculation error is shown on whichever screen you're
   actually on, not just the overview.

## Architecture

```
powercut-app/
├── src/                     React Native (Vega/Kepler) frontend
│   ├── App.tsx               Overview + appliance edit + battery edit + alternatives screens
│   ├── api.ts                 Calls the in-app engine (src/engine/), deferred one macrotask
│   ├── theme.ts               Colors, spacing, type scale, appliance icons
│   ├── types.ts               TypeScript types for the engine's Plan/Defaults responses
│   └── engine/                TypeScript port of engine/ below (shipped, production path)
│       ├── solver.ts solver.py's exact DP solver + energy-conflict finder, ported
│       ├── verifier.ts verifier.py's independent schedule checker, ported
│       ├── repairs.ts repairs.py's essentials-aware repair search, ported
│       ├── fixture.ts run_experiment.py's six-appliance fixture, ported
│       └── plan.ts    server.py's build_plan/default_config orchestration, ported
├── engine/                   Python constraint engine: reference implementation and
│   │                         differential-test oracle for src/engine/, no longer used
│   │                         by the shipped app (see docs/ENGINE_PORT.md)
│   ├── solver.py              Exact DP solver + minimum-cardinality energy-conflict finder
│   ├── verifier.py            Independent schedule checker + brute-force oracle
│   ├── run_experiment.py      The six-appliance/battery problem fixture + its own test suite
│   ├── repairs.py             Dynamic, essentials-aware, provably-minimal repair search
│   ├── test_repairs.py        Unit + adversarial brute-force tests for repairs.py
│   └── differential/generate_cases.py  Generates expected outputs for the TS differential suite
├── backend/                  Reference-implementation server, not used by the shipped app
│   ├── server.py              Local HTTP server: GET /health, GET /defaults, POST /plan
│   └── test_server.py         Malformed-input, impossible-constraint and tier-correctness tests
├── test/
│   ├── App.spec.tsx            Jest tests for the full interactive frontend
│   ├── engine-differential.spec.ts  TS engine vs Python engine, 163 scenarios
│   └── fixtures/               Real engine responses, captured live, used as test data
├── docs/
│   ├── USER_TEST_PROTOCOL.md         Shared-screen two-adult test script
│   ├── VEGA_SDK_FRICTION_LOG.md      Real SDK friction hit, with evidence
│   ├── DEVPOST_SUBMISSION_CHECKLIST.md  Pre-submission checklist
│   └── DEMO_VIDEO_STORYBOARD.md      Shot list for a sub-3-minute demo
└── evidence/
    └── screenshots/            Screenshots from the app running on the Vega Virtual Device
```

### Why the engine is vendored, not imported from elsewhere

`engine/solver.py`, `engine/verifier.py`, and `engine/run_experiment.py` are
unmodified copies of the same files developed and exhaustively tested during
this project's feasibility phase (60 fixed-seed solver-vs-brute-force-oracle
comparisons, independent verifier rejecting duplicated/unknown/missing/
overloaded schedules, minimum-cardinality conflict certificates checked
against all 41 smaller subsets). They were vendored here, rather than left
in their original location outside this repository, so that **a fresh clone
of `powercut-app` alone contains everything needed to build, test, and run
the product**, with no sibling directories required. `engine/repairs.py` is new
code built on top of them for Phase 2, using the same standard-library-only
approach.

These files import no GridFlex or other third-party code (see the module
docstrings). No third-party license obligations apply to them.

### Protecting essential services

The household picks which appliances are essential, right on the remote
(Phase B: `docs/PHASE_B.md` has the full design and on-device evidence).
Fridge and router start essential by default, but any of the six can be
marked or unmarked from its own edit screen, and that selection is sent
to the engine on every recompute. It isn't just a display label.

Given whatever set of ids the household currently has marked essential,
`findRepairs`/`find_repairs` searches for repairs in two tiers: first
restricted to the non-essential appliances only (tier
`protects_essentials`), and only if that search finds fewer than two
repairs does it widen to include the essential ones too (tier
`requires_compromise`, with `touches_critical` naming which ones). This
governs the *automatic search* only: a household's own direct edit to
an essential appliance's hours through the UI is never overridden, and is
itself surfaced back to the household via the `requested.critical_reduced`
field if they've knowingly reduced one below full.

Unmarking fridge or router stops the search from protecting it at all:
a repair that reduces fridge is only ever possible, and only ever tagged
`protects_essentials`, once fridge is not in the current selection. This
is a real change to what the search will find and offer, not a relabel
of the same fixed pair of repairs; see `docs/PHASE_B.md`'s "why this is a
real algorithm change" section for a live on-device example.

Every repair's sacrifice is proven minimal within its search scope, not
just *a* feasible answer: the single-appliance case is exact by binary
search (feasibility is monotonic in required_hours), and the two-appliance
case scans the full frontier from both appliances' sides and keeps
whichever tied-minimum point touches fewer appliances (necessary because
scanning only one direction can land on an arbitrary tied point depending
on iteration order; found and fixed during Phase 3, see the "adversarial"
tests in `engine/test_repairs.py`, which compare every claim against an
independent brute-force oracle). A second, separate ordering bug was found
in the same pass: `_rank`'s sort key had no final tiebreaker, so when two
*different* repairs genuinely tied on cost and appliance count, which one
ranked first (which one the household sees as "Alternative A") depended on
Python's per-process hash-seed-randomized set iteration order, confirmed
non-deterministic across `PYTHONHASHSEED` values on a constructed tied
scenario before the fix, and deterministic after adding a sorted-ids
tiebreaker; `test_repairs.py` now runs the real module in subprocesses
across ten hash seeds on that scenario as a permanent regression check.
**Optimality is claimed only within this one-or-two-appliance search
scope**: a configuration that genuinely needs three or more simultaneous
changes is reported as infeasible with no
automatic repair, not guessed at.

### Engine (`src/engine/`)

The shipped, production path. A TypeScript port of the solver, verifier,
and repair search below, running in-process inside the app: `src/api.ts`
calls it directly, deferred one macrotask so the button press's own
visual feedback commits before the calculation starts. That deferral
does not make the calculation itself fast or prevent the JS thread from
blocking for its duration once it begins. Most calls finish in well
under one frame, but a rare worst case (repair search forced through
both tiers) measures ~2 seconds; see `docs/ENGINE_BENCHMARKS.md` for the
real numbers. There is no server and no network call either way. The
engine itself is proven identical to the Python reference across 163
differential-tested scenarios (164 Jest cases). See `docs/ENGINE_PORT.md`
for the full methodology.

### Reference implementation and test oracle (`backend/server.py`)

A dependency-free `http.server` based service (Python 3 standard library
only), **no longer used by the shipped app**, kept as the reference
implementation the TypeScript engine is tested against and as a
standalone way to exercise the same logic from Python. It still runs
exactly as before if you want it (`python3 backend/server.py`), and does:

- `GET /health`: liveness probe with a fresh nonce.
- `GET /defaults`: the static appliance roster (ids, power ranges, allowed
  hours, which are `critical`) and default battery parameters, so the
  frontend can build its editable UI without duplicating that data.
- `POST /plan`: takes the household's current state (`usable_wh`, `max_w`,
  and a `required_hours` per appliance) and recomputes everything live, on
  every request, never cached: feasibility, a plain-English explanation
  when infeasible, whether the household has itself reduced an essential
  service (`critical_reduced`), and up to two independently-verified repair
  alternatives, each tagged with its tier, which critical services (if
  any) it touches, which appliances stay exactly as requested
  (`stays_powered`), and a plain-language trade-off summary. Malformed
  input (unknown appliance id, out-of-range or wrong-typed values,
  unexpected fields) is rejected with `422` and a clear message rather than
  crashing; well-typed but physically impossible input (e.g. an appliance
  asked to run more hours than its window allows) is solved normally and
  reported as infeasible, not rejected. Every response carries an instance
  ID and a fresh nonce.

### Frontend (`src/App.tsx`)

React Native for Vega using `@amazon-devices/react-native-kepler`:
`TVFocusGuideView` + `Pressable` for D-pad-navigable focus, and
`useKeplerBackHandler` for hardware Back button handling. The overview's
appliance and action cards are sized to fit entirely within one 1080p
screen without scrolling. The display renders at roughly 2x the React
Native dp scale, so card and type sizes were tuned against the actual
Virtual Device output, not just desktop assumptions.

## Tests

292 automated checks across the stack.

**Frontend + engine** (Jest + TypeScript + ESLint):
```
cd powercut-app
npm install
npm test        # 250 tests:
                 #  - 19 UI tests: load, edit an appliance, edit battery,
                 #    view/apply alternatives, honest "no repair found",
                 #    essential-service badges and the mark/unmark-essential
                 #    toggle (Phase B), repair tier display, rapid-input
                 #    reliability, per-screen error surfacing
                 #  - 231 differential tests: the TypeScript engine
                 #    (src/engine/) checked field-for-field against the
                 #    real Python engine's output across 230 scenarios
                 #    (20 fixed edge cases + 210 randomized, 67 of which
                 #    also vary the household's essentials selection); see
                 #    docs/ENGINE_PORT.md and docs/PHASE_B.md
npx tsc --noEmit
npm run lint
```

**Backend** (Python standard library only, no dependencies):
```
cd powercut-app/backend
python3 test_server.py   # 12 checks: malformed input rejected, impossible-but-
                          # valid input solved not rejected, default scenario
                          # explained with 2 verified ranked repairs, feasible
                          # edits need no repair, extreme capacity honestly
                          # reports zero repairs rather than fabricating one,
                          # critical-service tagging and compromise explanations,
                          # custom critical_ids validated and genuinely applied
```

**Solver / verifier / repair search** (Python standard library only):
```
cd powercut-app/engine
python3 run_experiment.py   # 16 checks: exhaustive oracle comparisons,
                             # mutation-rejection, timing
python3 test_repairs.py     # 14 checks, including three adversarial checks:
                             # single- and two-appliance search results are
                             # compared against an independent exhaustive
                             # oracle across multiple constructed scenarios
                             # (not just spot-checked by hand), repair
                             # ranking is confirmed deterministic across ten
                             # PYTHONHASHSEED values on a genuine tie
```

## Running it on Vega

### Prerequisites

- Node.js >= 20, npm
- Python 3 (standard library only, no pip dependencies)
- The [Vega SDK](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk)
  (`vega` CLI) with a Virtual Device image installed
- **Clone to a path with no spaces.** The Vega native build toolchain
  invokes an unquoted shell path internally; a path containing a space
  (e.g. `~/Desktop/My Projects/powercut-app`) will fail the release build.
  Clone to something like `~/dev/powercut-app` instead.

### Install and build

```bash
cd powercut-app
npm install
npm run build:app        # produces build/aarch64-release/powercut_aarch64.vpkg
                          # (also armv7 and x86_64 variants)
```

### Run

```bash
vega virtual-device start --timeout 120
vega run-app build/aarch64-release/powercut_aarch64.vpkg com.hajar.powercut.main -d VirtualDevice
```

One command, one terminal: the app's solver runs in-process, so there is
no backend to start first and nothing to keep running alongside it. D-pad
(Up/Down/Left/Right), Select, and Back all work through the standard Vega
remote input path (physical remote, or `vega exec vda shell inputd-cli
button_press KEY_*` for scripted testing).

(The standalone Python backend from `backend/server.py` still works if you
want to exercise the reference implementation directly. Run `python3
backend/server.py` and it listens on `http://127.0.0.1:8766`, but the
shipped app does not call it.)

### Reliability notes (Phase 3 audit)

During Phase 2 testing, one scripted rapid-fire button sequence (apply an
alternative, then immediately navigate) once landed on an unexpected
screen. Phase 3 investigated this directly rather than assuming it away:

- Every button that changes backend state now goes through a single guard
  that ignores further presses while a request is in flight (visible as a
  "Saving…" indicator on whichever screen you're on), instead of letting a
  second request race the first or silently vanishing with no feedback.
  Jest proves this holds even when a request is deliberately held open and
  multiple presses are fired before it resolves: no request is ever
  dropped *without* the "Saving…" indicator explaining why, and no second
  request is ever sent while one is outstanding, so responses cannot
  arrive out of order by construction (there is never more than one in
  flight to begin with).
- Recalculation errors are now shown on every screen that can trigger one
  (appliance edit, battery edit, alternatives), not only the overview,
  confirmed by a dedicated test that fails a request mid-edit and checks
  the error appears on that same screen.
- The exact original rapid-fire sequence (navigate to alternatives, apply
  one, all as back-to-back scripted presses with no pause) was repeated
  twice more on the Virtual Device after these changes and produced the
  correct result both times (screenshots in
  `evidence/screenshots/phase3/04-*` and `05-*`). This is not proof the
  original cause is identified and eliminated (two clean repeats of a
  previously-rare event isn't strong evidence either way), but it is a
  genuine attempt at reproduction with the fixes in place, not a dismissal.
  A real remote's natural pacing was never observed to trigger it.

## User testing

`docs/USER_TEST_PROTOCOL.md` is a six-minute script for two adults sharing
one screen and remote: a stable demo scenario (the shipped default), a
minute-by-minute facilitator script, including one participant-directed
appliance edit and a direct check on whether they distinguish energy (Wh)
from power (W), and what to record: whether they find and understand the
conflict explanation unprompted, how they compare the two repair
alternatives, and whether the shared screen visibly changes how they
negotiate versus one person on a phone. It has not yet been run with real
participants; this phase delivers the instrument, not results.

## Submission readiness

Three more documents under `docs/` prepare for, but do not perform,
submission: `VEGA_SDK_FRICTION_LOG.md` (real friction hit while building on
Vega, with evidence, for anyone continuing this project or asked for SDK
feedback), `DEVPOST_SUBMISSION_CHECKLIST.md` (what's left before
submitting, including the still-open license and repo-visibility
decisions), and `DEMO_VIDEO_STORYBOARD.md` (a shot-by-shot script for a
sub-three-minute demo of the real running product). The repository remains
private and nothing has been submitted.

## Scope and limitations

This is a demonstration of the full edit → recompute → explain →
protect-essentials-aware-repair → apply loop, with the essentials
selection itself now household-controlled (Phase B), not a finished
consumer product. In particular:

- Appliance power figures are synthetic estimates (hourly-average constant
  watts), not measured hardware profiles.
- Startup surges, battery aging, wiring losses, and solar/charging are not
  modeled.
- The outage duration (12 hours) and the appliance roster (these six ids)
  are fixed; you can change how much of each you need, not add new
  appliances or change the outage length, in this phase.
- Which appliances are "essential" is now a per-household setting (fridge
  and router are just the starting default). See "Protecting essential
  services" above.
- The repair search considers reducing one or two appliances at a time; a
  configuration that genuinely needs three or more simultaneous reductions
  is reported as infeasible with no automatic repair, honestly, rather than
  guessing.
- No phone handoff, persistence across app restarts, or multi-user
  negotiation flow yet.
- The user test protocol has been written and the app verified to support
  it, but not yet run with real participants.

See the project's feasibility assessment (outside this repository) for the
full scope of what was tested and what remains open.

## Development process

A feasibility assessment preceded this implementation and is referenced
throughout this README, though it is not part of this repository: Vega SDK
environment checks, constraint-solver correctness testing against an
independent brute-force oracle, and a separate usability scoping exercise.
That work set the scope and the correctness bar for everything below.

The solver, verifier, and repair search were built and proven correct in
Python first (`engine/`), with every optimality claim checked against an
independent brute-force oracle rather than spot-checked by hand
(`engine/test_repairs.py`, `engine/run_experiment.py`). That engine was
then ported to TypeScript to run in-process inside the Vega app
(`src/engine/`), with a 230-scenario differential test suite
(`test/engine-differential.spec.ts`) proving the port matches the Python
reference field for field. The port caught two real bugs along the way: a
redundant repair-search re-scan, and a tied-repair ranking order that was
nondeterministic across Python hash seeds (see `docs/ENGINE_PORT.md`).

Household-defined essential services (Phase B) extended the repair search
itself, not just its display: marking or unmarking fridge or router on the
remote changes which repairs the solver is willing to offer. That claim was
verified on-device with the Python backend stopped, confirming the
TypeScript engine alone drives the result (see `docs/PHASE_B.md`).

Every phase was validated against the actual Vega Virtual Device rather
than assumptions about it: D-pad focus and navigation, on-screen layout at
the device's real 1080p/2x scale, rapid-input button-press races, and
reinstall-and-relaunch checks with the reference backend confirmed stopped
so the "no server" claim is demonstrated, not just asserted (see
"Reliability notes" above and `docs/VEGA_SDK_FRICTION_LOG.md`).
