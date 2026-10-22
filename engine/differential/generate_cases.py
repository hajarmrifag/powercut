"""Generates the Python-side expected outputs for the solver/verifier/repairs
TypeScript port's differential test suite (src/engine/__tests__/differential.spec.ts).

Reuses the real backend/server.py pipeline (build_plan, default_config)
unchanged -- this script does not reimplement any solver/repair logic, it
only calls the already-tested Python originals and records their outputs
for comparison against the TS port. Nondeterministic fields (nonce,
instance, time_utc, elapsed_ms, states_visited) are stripped before
serializing, since those cannot and need not match across languages.
"""
import copy
import json
import random
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / 'engine'))
sys.path.insert(0, str(APP_ROOT / 'backend'))

from solver import solve  # noqa: E402
from run_experiment import fixture  # noqa: E402
import server  # noqa: E402

OUTAGE_HOURS = server.OUTAGE_HOURS
KNOWN_IDS = list(server.KNOWN_IDS)


def strip_nondeterministic(obj):
    """Recursively remove fields that cannot match across languages/runs."""
    drop_keys = {'nonce', 'instance', 'time_utc', 'elapsed_ms', 'states_visited'}
    if isinstance(obj, dict):
        return {k: strip_nondeterministic(v) for k, v in obj.items() if k not in drop_keys}
    if isinstance(obj, list):
        return [strip_nondeterministic(v) for v in obj]
    return obj


def case_from_overrides(name, usable_wh, max_w, overrides, critical_ids=None):
    """critical_ids: None means "omit the field, use the engine's own
    default (fridge, router)" -- exercising the pre-Phase-B call shape.
    A set/list means a household's own essentials selection (Phase B);
    passed straight through to the real, parameterized build_plan, and
    recorded in the case's input so the TS side sends the identical
    selection."""
    plan = server.build_plan(usable_wh, max_w, overrides, critical_ids=critical_ids)
    # The real app always sends its full current six-appliance state, never
    # a partial delta -- so the recorded input mirrors that: fixture
    # defaults merged with overrides, same as build_problem() computes
    # internally, rather than just the overridden subset.
    full_state = {a['id']: a['required_hours'] for a in fixture(OUTAGE_HOURS)['appliances']}
    full_state.update(overrides)
    case_input = {
        'usable_wh': usable_wh,
        'max_w': max_w,
        'appliances': [{'id': k, 'required_hours': v} for k, v in full_state.items()],
    }
    if critical_ids is not None:
        case_input['critical_ids'] = sorted(critical_ids)
    return {
        'name': name,
        'input': case_input,
        'expected': strip_nondeterministic(plan),
    }


def fixed_cases():
    cases = []
    # Shipped default: infeasible, needs 1908 Wh.
    cases.append(case_from_overrides('default_infeasible', 1800, 200, {}))
    # The two known single-appliance repairs from the default scenario.
    cases.append(case_from_overrides('repair_laptop_to_1h', 1800, 200, {'laptop': 1}))
    cases.append(case_from_overrides('repair_fan_to_1h', 1800, 200, {'fan': 1}))
    # Feasible by raising capacity instead.
    cases.append(case_from_overrides('capacity_2000wh_feasible', 2000, 200, {}))
    # The exact tied-repair scenario used to catch the ranking-determinism
    # bug fixed earlier in this project (two distinct 2-appliance repairs
    # both costing 4 hours removed at usable_wh=1690).
    cases.append(case_from_overrides('tied_repair_1690wh', 1690, 200, {}))
    # The known post-fix demo sequence: laptop reduced to 1h then fan
    # bumped to 5h, re-breaking the plan by exactly 3 Wh.
    cases.append(case_from_overrides('demo_sequence_state', 1800, 200,
                                      {'laptop': 1, 'fan': 5}))
    # All appliances at zero: battery requirement trivially zero, feasible.
    cases.append(case_from_overrides('all_zero', 1800, 200,
                                      {k: 0 for k in KNOWN_IDS}))
    # All appliances at their maximum (12h, except phone/laptop/lamp whose
    # windows cap lower) -- stresses service_window as well as energy.
    cases.append(case_from_overrides('all_max_hours', 1800, 200,
                                      {'fridge': 12, 'router': 12, 'lamp': 4,
                                       'phone': 1, 'laptop': 3, 'fan': 4}))
    # Extreme low capacity: infeasible with zero repairs possible.
    cases.append(case_from_overrides('extreme_low_capacity', 100, 50, {}))
    # Reduce fridge/router (the critical ids) directly via a household edit
    # -- exercises critical_reduced and the requires_compromise tier path.
    cases.append(case_from_overrides('household_reduces_fridge', 1800, 200,
                                      {'fridge': 6}))
    cases.append(case_from_overrides('household_reduces_both_critical', 1800, 200,
                                      {'fridge': 4, 'router': 4}))
    # A scenario engineered so that even the flexible-only search cannot
    # reach feasibility, forcing the requires_compromise fallback tier.
    cases.append(case_from_overrides('forces_compromise_tier', 1300, 200,
                                      {'fridge': 12, 'router': 12, 'lamp': 4,
                                       'phone': 1, 'laptop': 3, 'fan': 4}))
    # Very tight max_w, large usable_wh: exercises power_or_window_conflict.
    tight_power = case_from_overrides('tight_power_conflict', 10000, 55, {})
    cases.append(tight_power)
    # A protects_essentials repair (A) and a requires_compromise repair (B)
    # returned together in the same plan -- regression guard for a bug where
    # B's summary claimed "no fix was possible without reducing fridge" even
    # though A, right next to it, is exactly that fix.
    cases.append(case_from_overrides('mixed_tier_alternatives', 1600, 200, {}))

    # --- Phase B: household-defined essentials (critical_ids parameter) ---
    # Same default-scenario problem (infeasible, needs 1908 Wh) but with a
    # completely different essentials selection -- fridge/router are now
    # flexible, lamp/phone are protected instead. The known repairs
    # (laptop->1h, fan->1h) must now disappear or be retagged, since they
    # were only "protects_essentials" under the old default.
    cases.append(case_from_overrides('custom_critical_lamp_phone', 1800, 200, {},
                                      critical_ids={'lamp', 'phone'}))
    # Nothing selected as essential: every repair must come back
    # protects_essentials (there is nothing left to "compromise").
    cases.append(case_from_overrides('custom_critical_none', 1800, 200, {},
                                      critical_ids=set()))
    # Everything selected as essential: the search can never avoid touching
    # a critical id, so every repair must come back requires_compromise.
    cases.append(case_from_overrides('custom_critical_all', 1800, 200, {},
                                      critical_ids=set(KNOWN_IDS)))
    # A single, non-default appliance marked essential.
    cases.append(case_from_overrides('custom_critical_fan_only', 1800, 200, {},
                                      critical_ids={'fan'}))
    # Only fridge essential (router dropped) -- router must now be freely
    # reducible, unlike under the fixed default.
    cases.append(case_from_overrides('custom_critical_fridge_only', 1800, 200, {},
                                      critical_ids={'fridge'}))
    # The same forced-compromise scenario as 'forces_compromise_tier' above,
    # but with router swapped out for lamp as the second essential -- stresses
    # the fallback tier's pair search with a different, non-default pairing.
    cases.append(case_from_overrides('custom_critical_forces_compromise', 1300, 200,
                                      {'fridge': 12, 'router': 12, 'lamp': 4,
                                       'phone': 1, 'laptop': 3, 'fan': 4},
                                      critical_ids={'fridge', 'lamp'}))
    # A household reduces its own newly-chosen essential (lamp) below its
    # default full hours -- exercises critical_reduced with a non-default
    # critical id.
    cases.append(case_from_overrides('custom_critical_reduces_lamp', 1800, 200,
                                      {'lamp': 2}, critical_ids={'lamp', 'phone'}))
    return cases


def randomized_cases(n, seed):
    rng = random.Random(seed)
    cases = []
    for i in range(n):
        usable_wh = rng.randint(100, 2500)
        max_w = rng.randint(50, 400)
        overrides = {}
        # Vary a random subset of appliances; leave the rest at fixture default.
        base = fixture(OUTAGE_HOURS)
        caps = {a['id']: len(set(a['allowed_hours'])) for a in base['appliances']}
        for aid in KNOWN_IDS:
            if rng.random() < 0.8:
                overrides[aid] = rng.randint(0, min(OUTAGE_HOURS, caps[aid] + rng.choice([0, 0, 1])))
                overrides[aid] = min(overrides[aid], OUTAGE_HOURS)
        cases.append(case_from_overrides(f'random_{i}', usable_wh, max_w, overrides))
    return cases


def randomized_critical_ids_cases(n, seed):
    """Phase B: randomized scenarios that also randomize the household's
    essentials selection -- a random-sized (including empty and
    all-six) random subset of appliances, independent of which appliances
    the fixed cases above happen to use. Covers combinations no hand-picked
    case would think to try."""
    rng = random.Random(seed)
    cases = []
    base = fixture(OUTAGE_HOURS)
    caps = {a['id']: len(set(a['allowed_hours'])) for a in base['appliances']}
    for i in range(n):
        usable_wh = rng.randint(100, 2500)
        max_w = rng.randint(50, 400)
        overrides = {}
        for aid in KNOWN_IDS:
            if rng.random() < 0.8:
                overrides[aid] = rng.randint(0, min(OUTAGE_HOURS, caps[aid] + rng.choice([0, 0, 1])))
                overrides[aid] = min(overrides[aid], OUTAGE_HOURS)
        subset_size = rng.randint(0, len(KNOWN_IDS))
        critical_ids = set(rng.sample(KNOWN_IDS, subset_size))
        cases.append(case_from_overrides(f'random_critical_{i}', usable_wh, max_w, overrides,
                                          critical_ids=critical_ids))
    return cases


def main():
    cases = fixed_cases() + randomized_cases(150, seed=20261016) + \
        randomized_critical_ids_cases(60, seed=20261017)
    out = {'generated_count': len(cases), 'cases': cases}
    # Written under test/fixtures/ (not engine/differential/) so it sits
    # inside Jest's configured `roots` and can be imported as a plain JSON
    # module from a Jest test without touching jest.config.json.
    target = APP_ROOT / 'test' / 'fixtures' / 'differential-cases.json'
    target.write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({'status': 'generated', 'count': len(cases), 'path': str(target)}))


if __name__ == '__main__':
    main()
