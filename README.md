# PowerCut

A Fire TV (Vega) app that helps a household plan which appliances to run on
battery backup during a power outage. Built for the Amazon Build, Ship, Shape
2026 Hackathon, Fire TV track.

PowerCut shows a household's current appliance requirements and battery
capacity on one screen, lets you change any of them with the D-pad, and
recomputes feasibility against a real constraint solver after every change.
When a configuration doesn't fit, it explains exactly why and generates up
to two independently-verified, minimal-sacrifice repair alternatives —
computed fresh for whatever you changed, not pulled from a fixed pair.
Everything shown on screen is computed live by a local backend; the
frontend never performs its own feasibility or energy math.

## What it does

1. **Shows a live household energy overview.** Six appliances (fridge,
   router, lamp, phone, laptop, fan) and the battery's capacity/output
   limit, each as a D-pad-navigable card, with an energy bar and a
   FEASIBLE/INFEASIBLE status that reflect the actual current backend
   calculation.
2. **Lets you edit any appliance's required runtime, and the battery's
   capacity and output limit, with the remote.** Every change is sent to
   the backend and the whole plan is recomputed and redisplayed immediately
   — there is no client-side approximation in between.
3. **Explains infeasibility in plain language**, tailored to whatever you
   changed: the minimum set of services that alone breaks the energy
   budget when the limit is energy, or which appliance needs more hours
   than its outage-window has available, or that overlapping appliances
   exceed the battery's output limit even though total energy is fine.
4. **Generates up to two independently-verified repair alternatives** for
   whatever the current infeasible configuration actually is — a dynamic
   search (`engine/repairs.py`) that finds the smallest-sacrifice one- or
   two-appliance reduction that restores feasibility, then re-verifies the
   result with a solver-independent checker before ever showing it. Side by
   side, so you can compare and pick one.
5. **Navigates entirely with the D-pad**, as a Fire TV app must: a compact
   two-row overview, per-appliance and battery edit screens with stepper
   buttons, and a side-by-side alternatives screen — all built on the
   standard Vega/Kepler remote-input APIs (`TVFocusGuideView`,
   `useKeplerBackHandler`), Back always returns to the overview.

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
│   ├── repairs.py             Dynamic minimal-sacrifice repair search (new in Phase 2)
│   └── test_repairs.py        Unit tests for repairs.py
├── backend/
│   ├── server.py              Local HTTP server: GET /health, GET /defaults, POST /plan
│   └── test_server.py         Malformed-input, impossible-constraint and repair-shape tests
├── test/
│   ├── App.spec.tsx           Jest tests for the full interactive frontend
│   └── fixtures/               Real backend responses, captured live, used as test data
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

### Backend (`backend/server.py`)

A dependency-free `http.server` based service (Python 3 standard library
only) that:

- `GET /health` — liveness probe with a fresh nonce.
- `GET /defaults` — the static appliance roster (ids, power ranges, allowed
  hours) and default battery parameters, so the frontend can build its
  editable UI without duplicating that data.
- `POST /plan` — takes the household's current state (`usable_wh`, `max_w`,
  and a `required_hours` per appliance) and recomputes everything live, on
  every request, never cached: feasibility, a plain-English explanation
  when infeasible, and up to two independently-verified repair
  alternatives. Malformed input (unknown appliance id, out-of-range or
  wrong-typed values, unexpected fields) is rejected with `422` and a clear
  message rather than crashing; well-typed but physically impossible input
  (e.g. an appliance asked to run more hours than its window allows) is
  solved normally and reported as infeasible, not rejected. Every response
  carries an instance ID and a fresh nonce.

### Frontend (`src/App.tsx`)

React Native for Vega using `@amazon-devices/react-native-kepler`:
`TVFocusGuideView` + `Pressable` for D-pad-navigable focus, and
`useKeplerBackHandler` for hardware Back button handling. The overview's
appliance and action cards are sized to fit entirely within one 1080p
screen without scrolling — the display renders at roughly 2x the React
Native dp scale, so card and type sizes were tuned against the actual
Virtual Device output, not just desktop assumptions.

## Tests

**Frontend** (Jest + TypeScript + ESLint):
```
cd powercut-app
npm install
npm test        # 9 tests: load, edit an appliance, edit battery, view/apply
                 # alternatives, honest "no repair found", error path
npx tsc --noEmit
npm run lint
```

**Backend** (Python standard library only, no dependencies):
```
cd powercut-app/backend
python3 test_server.py   # 7 checks: malformed input rejected, impossible-but-
                          # valid input solved not rejected, default scenario
                          # explained with 2 verified ranked repairs, feasible
                          # edits need no repair, extreme capacity honestly
                          # reports zero repairs rather than fabricating one
```

**Solver / verifier / repair search** (Python standard library only):
```
cd powercut-app/engine
python3 run_experiment.py   # 16 checks: exhaustive oracle comparisons,
                             # mutation-rejection, timing
python3 test_repairs.py     # 7 checks: repair correctness, ranking,
                             # never-raises-hours, no input mutation
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

A note on scripted testing: sending D-pad presses as several rapid,
back-to-back CLI commands can occasionally outrun the app's render/network
cycle and land on an unexpected screen — this is an artifact of synthetic
input timing, not observed with normally-paced presses (including a real
remote). Pace scripted presses with a screenshot or short pause between
navigation and selection for reliable results.

## Scope and limitations

This is a Phase 2 demonstration of the full edit → recompute → explain →
repair → apply loop, not a finished consumer product. In particular:

- Appliance power figures are synthetic estimates (hourly-average constant
  watts), not measured hardware profiles.
- Startup surges, battery aging, wiring losses, and solar/charging are not
  modeled.
- The outage duration (12 hours) and the appliance roster (these six ids)
  are fixed; you can change how much of each you need, not add new
  appliances or change the outage length, in this phase.
- The repair search considers reducing one or two appliances at a time; a
  configuration that genuinely needs three or more simultaneous reductions
  is reported as infeasible with no automatic repair, honestly, rather than
  guessing.
- No phone handoff, persistence across app restarts, or multi-user
  negotiation flow yet.

See the project's feasibility assessment (outside this repository) for the
full scope of what was tested and what remains open.

## Development process

This project was built with AI-assisted development (Claude Code). A prior
feasibility assessment (Vega SDK environment checks, constraint-solver
correctness testing, and a separate usability scoping exercise) preceded
this implementation and is referenced above but is not part of this
repository.
