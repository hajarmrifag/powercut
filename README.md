# PowerCut

A Fire TV (Vega) app that helps a household plan which appliances to run on
battery backup during a power outage. Built for the Amazon Build, Ship, Shape
2026 Hackathon, Fire TV track.

PowerCut takes a household's requested appliance schedule, runs it through a
real constraint solver against the battery's energy and power limits, and —
when the request doesn't fit — explains exactly why and offers two
independently-verified feasible alternatives. Everything shown on screen is
computed live by a local backend; nothing is hardcoded in the frontend.

## What it does

1. **Shows a deliberately infeasible scenario.** A 12-hour outage with six
   household appliances (fridge, router, lamp, phone, laptop, fan) at their
   full requested hours needs 1908 Wh, but the battery only holds 1800 Wh.
2. **Explains the conflict.** The backend computes the minimum-cardinality
   set of services that alone exceeds the budget (fridge + router + laptop +
   fan = 1835 Wh) and surfaces that as a plain-English explanation, not just
   a pass/fail flag.
3. **Offers two independently-verified feasible alternatives** — different
   trade-offs on fan vs. laptop runtime — each one solved, then re-checked
   by a *separate* verifier that recomputes every hour's power, energy, and
   service windows from scratch (it does not import or trust the solver).
4. **Navigates entirely with the D-pad**, as a Fire TV app must: directional
   focus movement between a root tile menu and three detail screens, Select
   to drill in, Back to return, Back-at-root to exit — all using the
   standard Vega/Kepler remote-input APIs.

## Architecture

```
powercut-app/
├── src/                  React Native (Vega/Kepler) frontend
│   ├── App.tsx           Root tile menu + 3 detail screens, D-pad nav
│   └── types.ts          TypeScript types for the backend's /plan response
├── engine/                Python constraint engine (vendored, see below)
│   ├── solver.py          Exact DP solver + minimum-cardinality energy-conflict finder
│   ├── verifier.py         Independent schedule checker + brute-force oracle
│   └── run_experiment.py   The six-appliance/battery problem fixture
├── backend/
│   └── server.py          Local HTTP server exposing GET /health, GET /plan
├── test/
│   ├── App.spec.tsx        Jest tests for the frontend
│   └── fixtures/plan.json  A real backend response, captured live, used as test data
└── evidence/
    └── screenshots/         Screenshots from the app running on the Vega Virtual Device
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
the product** — no sibling directories required.

These files are standard-library-only Python with no GridFlex or other
third-party code imported (see the module docstrings). No third-party
license obligations apply to them.

### Backend (`backend/server.py`)

A dependency-free `http.server` based service (Python 3 standard library
only) that:

- `GET /health` — liveness probe with a fresh nonce.
- `GET /plan` — recomputes the full household plan on every request
  (never cached): the infeasible requested schedule, its energy-conflict
  explanation, and both alternatives, each independently re-verified before
  being returned. Every response carries an instance ID and a fresh nonce
  so you can confirm you're seeing a live computation, not a canned value.

### Frontend (`src/App.tsx`)

React Native for Vega using `@amazon-devices/react-native-kepler`:
`TVFocusGuideView` + `Pressable` for D-pad-navigable focus, and
`useKeplerBackHandler` for hardware Back button handling. Four screens:
root tile menu, requested-plan detail (conflict explanation), and two
alternative-plan detail screens (hour-by-hour schedule + verification
status).

## Tests

**Frontend** (Jest + TypeScript + ESLint):
```
cd powercut-app
npm install
npm test        # 5 tests: plan loads, each screen renders, error path
npx tsc --noEmit
npm run lint
```

**Backend / solver** (Python standard library only, no dependencies):
```
cd powercut-app/backend
python3 -c "
import server
plan = server.build_plan()
assert not plan['requested']['result']['feasible']
assert plan['requested']['conflict'] is not None
assert len(plan['alternatives']) == 2
for alt in plan['alternatives']:
    assert alt['result']['feasible']
    assert alt['independent_verification']['valid']
print('OK')
"
```

The solver and verifier also carry their own exhaustive test suite
(`engine/run_experiment.py`), which runs the full battery of oracle
comparisons, mutation-rejection checks, and timing benchmarks described
above:
```
cd powercut-app/engine
python3 run_experiment.py
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

## Scope and limitations

This is a Phase 1 demonstration of the core constraint-solving and D-pad
interaction loop, not a finished consumer product. In particular:

- Appliance power figures are synthetic estimates (hourly-average constant
  watts), not measured hardware profiles.
- Startup surges, battery aging, wiring losses, and solar/charging are not
  modeled.
- The outage scenario (12 hours, six fixed appliances) is a built-in fixture,
  not yet a user-editable household profile.
- No phone handoff, persistence, or multi-user negotiation flow yet.

See the project's feasibility assessment (outside this repository) for the
full scope of what was tested and what remains open.

## Development process

This project was built with AI-assisted development (Claude Code). A prior
feasibility assessment (Vega SDK environment checks, constraint-solver
correctness testing, and a separate usability scoping exercise) preceded
this implementation and is referenced above but is not part of this
repository.
