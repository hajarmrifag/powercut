# PowerCut

A Fire TV (Vega) app that helps a household plan which appliances to run on
battery backup during a power outage. Built for the Amazon Build, Ship, Shape
2026 Hackathon, Fire TV track.

PowerCut shows a household's current appliance requirements and battery
capacity on one screen, lets you change any of them with the D-pad, and
recomputes feasibility against a real constraint solver after every change.
When a configuration doesn't fit, it explains exactly why and generates up
to two independently-verified repair alternatives — computed fresh for
whatever you changed, not pulled from a fixed pair, and clearly marked by
whether they protect the household's essential services (fridge, router)
or require compromising one. Everything shown on screen is computed live by
a local backend; the frontend never performs its own feasibility or energy
math.

## What it does

1. **Shows a live household energy overview.** Six appliances (fridge,
   router, lamp, phone, laptop, fan) and the battery's capacity/output
   limit, each as a D-pad-navigable card, with an energy bar and a
   FEASIBLE/INFEASIBLE status that reflect the actual current backend
   calculation. Fridge and router are marked **essential** by default, with
   a warning if the household has itself reduced one below full.
2. **Lets you edit any appliance's required runtime, and the battery's
   capacity and output limit, with the remote.** Every change is sent to
   the backend and the whole plan is recomputed and redisplayed immediately
   — there is no client-side approximation in between.
3. **Explains infeasibility in plain language**, tailored to whatever you
   changed: the minimum set of services that alone breaks the energy
   budget when the limit is energy, or which appliance needs more hours
   than its outage-window has available, or that overlapping appliances
   exceed the battery's output limit even though total energy is fine.
4. **Generates up to two independently-verified repair alternatives**,
   each clearly labeled as either protecting the household's essential
   services or requiring an explicit compromise on one — the automatic
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
   buttons, and a side-by-side alternatives screen — all built on the
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
│   ├── api.ts                Typed fetch wrappers for GET /defaults and POST /plan
│   ├── theme.ts               Colors, spacing, type scale, appliance icons
│   └── types.ts               TypeScript types for the backend's responses
├── engine/                   Python constraint engine (vendored, see below)
│   ├── solver.py              Exact DP solver + minimum-cardinality energy-conflict finder
│   ├── verifier.py            Independent schedule checker + brute-force oracle
│   ├── run_experiment.py      The six-appliance/battery problem fixture + its own test suite
│   ├── repairs.py             Dynamic, essentials-aware, provably-minimal repair search
│   └── test_repairs.py        Unit + adversarial brute-force tests for repairs.py
├── backend/
│   ├── server.py              Local HTTP server: GET /health, GET /defaults, POST /plan
│   └── test_server.py         Malformed-input, impossible-constraint and tier-correctness tests
├── test/
│   ├── App.spec.tsx           Jest tests for the full interactive frontend
│   └── fixtures/               Real backend responses, captured live, used as test data
├── docs/
│   └── USER_TEST_PROTOCOL.md  Five-minute two-adult shared-screen test script
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
the product** — no sibling directories required. `engine/repairs.py` is new
code built on top of them for Phase 2, using the same standard-library-only
approach.

These files import no GridFlex or other third-party code (see the module
docstrings). No third-party license obligations apply to them.

### Protecting essential services

`engine/repairs.py` treats `fridge` and `router` as critical by default
(`CRITICAL_IDS`) and searches for repairs in two tiers: first restricted to
the four flexible appliances only (tier `protects_essentials`), and only if
that search finds fewer than two repairs does it widen to include
fridge/router too (tier `requires_compromise`, with `touches_critical`
naming which one). This governs the *automatic search* only — a household's
own direct edit to fridge or router's hours through the UI is never
overridden, and is itself surfaced back to the household via the
`requested.critical_reduced` field if they've knowingly reduced one below
full.

The critical/flexible split is a fixed backend default for this phase, not
a user-facing setting — the household can still freely edit any appliance
including fridge/router themselves, this only decides what the *automatic*
repair search is willing to touch on its own. A per-household "mark this as
essential" control is a reasonable next step but was left out to keep this
phase's scope to what was asked.

Every repair's sacrifice is proven minimal within its search scope, not
just *a* feasible answer: the single-appliance case is exact by binary
search (feasibility is monotonic in required_hours), and the two-appliance
case scans the full frontier from both appliances' sides and keeps
whichever tied-minimum point touches fewer appliances — necessary because
scanning only one direction can land on an arbitrary tied point depending
on iteration order (found and fixed during Phase 3; see the "adversarial"
tests in `engine/test_repairs.py`, which compare every claim against an
independent brute-force oracle). **Optimality is claimed only within this
one-or-two-appliance search scope** — a configuration that genuinely needs
three or more simultaneous changes is reported as infeasible with no
automatic repair, not guessed at.

### Backend (`backend/server.py`)

A dependency-free `http.server` based service (Python 3 standard library
only) that:

- `GET /health` — liveness probe with a fresh nonce.
- `GET /defaults` — the static appliance roster (ids, power ranges, allowed
  hours, which are `critical`) and default battery parameters, so the
  frontend can build its editable UI without duplicating that data.
- `POST /plan` — takes the household's current state (`usable_wh`, `max_w`,
  and a `required_hours` per appliance) and recomputes everything live, on
  every request, never cached: feasibility, a plain-English explanation
  when infeasible, whether the household has itself reduced an essential
  service (`critical_reduced`), and up to two independently-verified repair
  alternatives — each tagged with its tier, which critical services (if
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
screen without scrolling — the display renders at roughly 2x the React
Native dp scale, so card and type sizes were tuned against the actual
Virtual Device output, not just desktop assumptions.

## Tests

52 automated checks across the stack.

**Frontend** (Jest + TypeScript + ESLint):
```
cd powercut-app
npm install
npm test        # 15 tests: load, edit an appliance, edit battery, view/apply
                 # alternatives, honest "no repair found", essential-service
                 # badges, repair tier display, rapid-input reliability, and
                 # per-screen error surfacing
npx tsc --noEmit
npm run lint
```

**Backend** (Python standard library only, no dependencies):
```
cd powercut-app/backend
python3 test_server.py   # 11 checks: malformed input rejected, impossible-but-
                          # valid input solved not rejected, default scenario
                          # explained with 2 verified ranked repairs, feasible
                          # edits need no repair, extreme capacity honestly
                          # reports zero repairs rather than fabricating one,
                          # critical-service tagging and compromise explanations
```

**Solver / verifier / repair search** (Python standard library only):
```
cd powercut-app/engine
python3 run_experiment.py   # 16 checks: exhaustive oracle comparisons,
                             # mutation-rejection, timing
python3 test_repairs.py     # 10 checks, including two adversarial brute-force
                             # comparisons: single- and two-appliance search
                             # results are compared against an independent
                             # exhaustive oracle across multiple constructed
                             # scenarios, not just spot-checked by hand
```

## Running it on Vega

### Prerequisites

- Node.js >= 20, npm
- Python 3 (standard library only — no pip dependencies)
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
# Terminal 1: start the backend
cd powercut-app/backend
python3 server.py        # listens on http://127.0.0.1:8766

# Terminal 2: start the Virtual Device and install the app
vega virtual-device start --timeout 120
vega run-app build/aarch64-release/powercut_aarch64.vpkg com.hajar.powercut.main -d VirtualDevice
```

The app connects to the backend at `http://10.0.2.2:8766` — the Virtual
Device's gateway address for the host's loopback interface. D-pad
(Up/Down/Left/Right), Select, and Back all work through the standard Vega
remote input path (physical remote, or `vega exec vda shell inputd-cli
button_press KEY_*` for scripted testing).

### Reliability notes (Phase 3 audit)

During Phase 2 testing, one scripted rapid-fire button sequence (apply an
alternative, then immediately navigate) once landed on an unexpected
screen. Phase 3 investigated this directly rather than assuming it away:

- Every button that changes backend state now goes through a single guard
  that ignores further presses while a request is in flight (visible as a
  "Saving…" indicator on whichever screen you're on), instead of letting a
  second request race the first or silently vanishing with no feedback.
  Jest proves this holds even when a request is deliberately held open and
  multiple presses are fired before it resolves — no request is ever
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
  original cause is identified and eliminated — two clean repeats of a
  previously-rare event isn't strong evidence either way — but it is a
  genuine attempt at reproduction with the fixes in place, not a dismissal.
  A real remote's natural pacing was never observed to trigger it.

## User testing

`docs/USER_TEST_PROTOCOL.md` is a five-minute script for two adults sharing
one screen and remote: a stable demo scenario (the shipped default), a
minute-by-minute facilitator script, and what to record — whether they find
and understand the conflict explanation unprompted, how they compare the
two repair alternatives, and whether the shared screen visibly changes how
they negotiate versus one person on a phone. It has not yet been run with
real participants; this phase delivers the instrument, not results.

## Scope and limitations

This is a Phase 3 demonstration of the full edit → recompute → explain →
protect-essentials-aware-repair → apply loop, not a finished consumer
product. In particular:

- Appliance power figures are synthetic estimates (hourly-average constant
  watts), not measured hardware profiles.
- Startup surges, battery aging, wiring losses, and solar/charging are not
  modeled.
- The outage duration (12 hours) and the appliance roster (these six ids)
  are fixed; you can change how much of each you need, not add new
  appliances or change the outage length, in this phase.
- Which two appliances are "essential" (fridge, router) is a fixed backend
  default, not a per-household setting — see "Protecting essential
  services" above for why, and what a next step would look like.
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

This project was built with AI-assisted development (Claude Code). A prior
feasibility assessment (Vega SDK environment checks, constraint-solver
correctness testing, and a separate usability scoping exercise) preceded
this implementation and is referenced above but is not part of this
repository.
