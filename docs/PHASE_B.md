# Phase B: household-defined essentials

## What changed

A household can now mark or unmark **any** of the six appliances as
essential, not just fridge and router (which stay essential by default).
The selection is local UI state in `src/App.tsx`, sent to the engine on
every recompute, and genuinely changes which repairs `findRepairs()`
will and won't offer: not just which "essential" badge gets drawn.

- **Engine** (`engine/repairs.py` + `src/engine/repairs.ts`, kept in
  lock-step): `find_repairs`/`findRepairs` take an optional
  `critical_ids`/`criticalIds` parameter. Omitted, it defaults to the
  existing fridge/router constant: every pre-existing caller and test
  keeps its exact original behavior, unchanged.
- **Request/response plumbing** (`backend/server.py` + `src/engine/plan.ts`):
  `build_plan`/`buildPlan` and request validation thread the same
  parameter through: validating it (known ids, no duplicates) and
  reflecting the actual requested selection in the response's
  `critical_ids`, `critical_reduced`, and each alternative's summary text
  (no more hardcoded "fridge, router" in the English explanation).
- **UI** (`src/App.tsx`): a toggle button on the appliance edit screen
  ("Mark as essential" / "Unmark as essential"), routed through the same
  `recompute()` / in-flight-guard path as every other edit, so the
  "Saving…" indicator and press-debouncing already proven in Phase 3
  cover it too. The essential badges and explanatory text on both the
  overview and the edit screen reflect this live selection. "Reset to
  default" resets the selection back to fridge/router along with the
  appliance hours.

## Why this is a real algorithm change, not a UI relabel

Before Phase B, a repair that reduced fridge or router could only ever be
tagged `requires_compromise`: the search would try everything else
first and only touch fridge/router as a last resort. After unmarking
fridge as essential, the exact same search machinery now finds and
offers a fridge-reducing repair tagged `protects_essentials`, because
fridge is no longer in the set the search tries to avoid. This was
verified both in isolation (Python and TypeScript adversarial tests) and
live on the real device (screenshot `06-alternative-reduces-fridge.png`
below), not assumed from the code structure alone.

## Correctness

- **Python reference**, `engine/test_repairs.py`: 14 checks (11
  pre-existing + 3 new): custom `critical_ids` genuinely changes which
  repairs are found and how they're tagged (fridge becomes freely
  reducible once not selected), an empty selection means nothing can
  ever be `requires_compromise`, and selecting every appliance forces
  every repair into `requires_compromise`.
- **Python backend**, `backend/test_server.py`: 12 checks (11
  pre-existing + 1 new): `critical_ids` validation (unknown id,
  duplicate, non-list all rejected) and that the response's
  `critical_ids`/`critical_reduced` genuinely reflect a custom selection
  rather than the fixed default.
- **Differential suite**, `test/engine-differential.spec.ts`: extended
  at this phase from 163 to **230 cases**: the original 163 (each still run with
  `critical_ids` omitted, exercising the unchanged default-essentials
  path) plus 7 hand-picked and 60 randomized scenarios
  (`engine/differential/generate_cases.py`'s
  `randomized_critical_ids_cases`) that vary the essentials selection
  itself (empty, full, single-appliance, and random subsets), checked
  byte-for-byte against the same now-parameterized Python reference.
  **Historical Phase B result: 230/230 cases passed.** A later mixed-tier
  regression brought the current fixture to 231 scenarios; see
  `docs/QUALITY_SPRINT.md`.
- **Jest UI tests**, `test/App.spec.tsx`: 4 new tests; the toggle's
  label and copy reflect live state, toggling sends the updated
  `critical_ids` to the engine (checked via the mocked `fetchPlan`'s own
  call arguments), the alternatives screen correctly renders and labels
  a repair that's only possible once fridge is unmarked, and
  toggling-then-untoggling round-trips back to the original set.
- **Historical Phase B result: 250/250 Jest tests passed** (19 App + 1
  case-count sanity + 230 differential). `tsc` and lint were clean at this
  phase. The current count is intentionally higher and is reconciled in
  `docs/QUALITY_SPRINT.md`.

## On-device verification (Vega Virtual Device, backend still stopped)

Full workflow, screenshots in `evidence/screenshots/phase-b/`:

1. `01-launch-default.png`: launch, default INFEASIBLE (1908/1800 Wh),
   fridge + router essential.
2. `02-lamp-not-essential.png`: lamp's edit screen: "Not marked
   essential" copy, "Mark as essential" button.
3. `03-lamp-marked-essential.png`: pressed the toggle: live-recomputed,
   title now shows "· essential service", button now reads essential and
   offers to unmark it. (This screenshot predates a later wording-only
   pass that changed the button's punctuation; see `README.md`'s
   development process section. The screenshot itself was not
   recaptured.)
4. `04-overview-three-essentials.png`: back on the overview: fridge,
   router, **and lamp** now all show the essential badge.
5. `05-fridge-unmarked.png`: fridge's edit screen, toggled off: "Not
   marked essential" copy now shown for fridge.
6. `06-alternative-reduces-fridge.png`: **the proof**: Alternative A now
   reads "Reduces: fridge: 12h → 10h", tagged "✓ Protects essentials",
   summary "Keeps every essential service (lamp, router) at its current
   hours. Reduces: fridge." This was structurally impossible before Phase B.
7. `07-applied-fridge-reduced.png`: applied: FEASIBLE, 1728/1800 Wh,
   fridge shown at 10h with no essential badge, router and lamp still
   badged.
8. `08-reset-restores-defaults.png`: pressed "Reset to default": back to
   the original INFEASIBLE 1908/1800 Wh state, essential badges back to
   exactly fridge + router, lamp's badge gone.

Every number at every step matches what the differential-tested engine
computes for that exact input, the same verification standard as Phase A.

## Scope

No unrelated features added. The Python engine's binary-search and
frontier-scan algorithms (the parts hardest to get right) were not
touched: only which ids they're asked to avoid. The existing demo
sequence (`docs/DEMO_VIDEO_STORYBOARD.md`) and the Phase A engine port
are unaffected; default behavior (fridge/router essential, nothing else
touched) is unchanged in every path that doesn't explicitly select a
different essentials set.
