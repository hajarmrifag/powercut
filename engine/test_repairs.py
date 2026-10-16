"""Unit and adversarial tests for the dynamic repair search (repairs.py),
independent of the HTTP layer. Runs standalone, in the style of
run_experiment.py.
"""
import copy
import os
import random
import subprocess
import sys
from itertools import product
from pathlib import Path

from run_experiment import fixture
from repairs import CRITICAL_IDS, find_repairs, _single_appliance_repairs, _two_appliance_repairs
from solver import solve
from verifier import check

ENGINE_DIR = Path(__file__).resolve().parent


def brute_force_min_pair_sacrifice(problem, id_a, id_b):
    """Independent, unoptimized oracle: try every (hours_a, hours_b) pair in
    their full ranges and return the minimum total hours removed among the
    feasible ones, by calling solve() directly -- no binary search, no
    reuse of repairs.py's own logic. Used to prove _two_appliance_repairs
    is not just *a* feasible answer but the true minimum."""
    originals = {a['id']: a['required_hours'] for a in problem['appliances']}
    orig_a, orig_b = originals[id_a], originals[id_b]
    best = None
    for hours_a, hours_b in product(range(orig_a + 1), range(orig_b + 1)):
        candidate = copy.deepcopy(problem)
        for a in candidate['appliances']:
            if a['id'] == id_a:
                a['required_hours'] = hours_a
            if a['id'] == id_b:
                a['required_hours'] = hours_b
        if solve(candidate)['feasible']:
            removed = (orig_a - hours_a) + (orig_b - hours_b)
            if best is None or removed < best:
                best = removed
    return best


def brute_force_min_single_sacrifice(problem, appliance_id):
    originals = {a['id']: a['required_hours'] for a in problem['appliances']}
    original = originals[appliance_id]
    for hours in range(original, -1, -1):  # descending: first feasible = max hours = min sacrifice
        candidate = copy.deepcopy(problem)
        for a in candidate['appliances']:
            if a['id'] == appliance_id:
                a['required_hours'] = hours
        if solve(candidate)['feasible']:
            return original - hours
    return None


def main():
    checks = []

    # --- feasible problems need no repair ---
    assert find_repairs(fixture(8)) == []
    checks.append('feasible problem: find_repairs returns []')

    # --- default infeasible scenario: both repairs protect essentials ---
    p = fixture(12)
    assert not solve(p)['feasible']
    repairs = find_repairs(p)
    assert len(repairs) == 2
    for r in repairs:
        assert solve(r['problem'])['feasible']
        assert check(r['problem'], r['result']['schedule'])['valid']
        assert r['independent_verification']['valid']
        assert r['hours_removed'] > 0
        assert r['tier'] == 'protects_essentials', r
        assert r['touches_critical'] == [], r
        assert not CRITICAL_IDS & {c['id'] for c in r['changed']}
    assert repairs[0]['hours_removed'] <= repairs[1]['hours_removed']
    found = {frozenset(c['id'] for c in r['changed']) for r in repairs}
    assert found == {frozenset(['laptop']), frozenset(['fan'])}, found
    checks.append('default scenario: 2 essentials-protecting repairs, correctly tagged')

    # --- repairs only ever reduce, never raise, required_hours ---
    for r in repairs:
        for c in r['changed']:
            assert c['to_hours'] < c['from_hours']
    checks.append('repairs only ever reduce required_hours, never raise it')

    # --- untouched appliances keep their exact original hours ---
    for r in repairs:
        changed_ids = {c['id'] for c in r['changed']}
        originals = {a['id']: a['required_hours'] for a in p['appliances']}
        for appliance in r['problem']['appliances']:
            if appliance['id'] not in changed_ids:
                assert appliance['required_hours'] == originals[appliance['id']]
    checks.append('repairs leave every unrelated appliance exactly as requested')

    # --- ADVERSARIAL: single-appliance search finds the true minimum sacrifice ---
    for appliance_id in ('fridge', 'router', 'lamp', 'phone', 'laptop', 'fan'):
        found = _single_appliance_repairs(p, {appliance_id})
        expected = brute_force_min_single_sacrifice(p, appliance_id)
        if expected is None or expected == 0:
            assert found == [], (appliance_id, found)
        else:
            assert len(found) == 1, (appliance_id, found)
            assert found[0]['hours_removed'] == expected, (appliance_id, found[0], expected)
    checks.append('ADVERSARIAL: single-appliance search matches brute-force minimum for all 6 appliances')

    # --- ADVERSARIAL: two-appliance search finds the true minimum joint sacrifice ---
    # This specifically targets the Phase 2 bug: a search that only zeroes the
    # first appliance before maximizing the second can miss the true minimum
    # when the cheaper direction is to zero the *other* one first.
    rng = random.Random(20261015)
    pairs_checked = 0
    for id_a, id_b in [('laptop', 'fan'), ('phone', 'laptop'), ('lamp', 'fan'), ('fridge', 'laptop')]:
        base = fixture(12)
        max_wh = {a['id']: a['high_w'] * a['required_hours'] for a in base['appliances']}
        pair_ceiling = max_wh[id_a] + max_wh[id_b]
        for trial in range(3):
            # Pick a capacity strictly below what the pair could draw at full
            # hours, so the pair alone is guaranteed infeasible -- varying
            # just enough headroom per trial to exercise different points on
            # the feasibility frontier, not just the fully-zeroed extreme.
            usable_wh = max(50, pair_ceiling - rng.randint(1, max(1, pair_ceiling - 10)))
            adversarial = fixture(12, usable_wh, rng.randint(140, 220))
            for a in adversarial['appliances']:
                if a['id'] not in (id_a, id_b):
                    a['required_hours'] = 0  # isolate the pair's own frontier
            assert not solve(adversarial)['feasible'], (id_a, id_b, trial, usable_wh)
            found = _two_appliance_repairs(adversarial, {id_a, id_b})
            expected = brute_force_min_pair_sacrifice(adversarial, id_a, id_b)
            pairs_checked += 1
            if expected is None:
                assert found == [], (id_a, id_b, found)
            else:
                assert len(found) == 1, (id_a, id_b, trial, found)
                assert found[0]['hours_removed'] == expected, \
                    (id_a, id_b, trial, found[0]['hours_removed'], expected)
    assert pairs_checked >= 10, 'adversarial pair search should have exercised multiple scenarios'
    checks.append(f'ADVERSARIAL: two-appliance search matches brute-force minimum ({pairs_checked} scenarios)')

    # --- ADVERSARIAL: ranking is deterministic across PYTHONHASHSEED values ---
    # repairs.py builds appliance pairs from a set (allowed_ids), whose
    # iteration order Python randomizes per-process by default. When two
    # repairs are genuinely tied on (hours_removed, len(changed)), their
    # relative order must not depend on that randomization -- otherwise
    # which one the household sees as "Alternative A" could change between
    # server restarts for the identical scenario. This runs the real
    # repairs module in fresh subprocesses (not just the one test process,
    # which only ever has one hash seed) across a spread of seeds, on a
    # scenario confirmed by direct inspection to produce a genuine two-pair
    # tie (usable_wh=1690: {fan,laptop} and {phone,laptop} both cost 4).
    determinism_script = (
        "from run_experiment import fixture\n"
        "from repairs import find_repairs\n"
        "p = fixture(12, usable_wh=1690, max_w=200)\n"
        "r = find_repairs(p)\n"
        "print([sorted(c['id'] for c in x['changed']) for x in r])\n"
    )
    outputs = set()
    for seed in (0, 1, 2, 3, 5, 8, 13, 21, 34, 55):
        result = subprocess.run(
            [sys.executable, '-c', determinism_script],
            cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=30,
            env={**os.environ, 'PYTHONHASHSEED': str(seed)},
        )
        assert result.returncode == 0, (seed, result.stderr)
        outputs.add(result.stdout.strip())
    assert len(outputs) == 1, f'ranking is not deterministic across PYTHONHASHSEED: {outputs}'
    checks.append('ADVERSARIAL: repair ranking is deterministic across 10 PYTHONHASHSEED values on a genuine tie')

    # --- essentials are only touched when no essentials-preserving repair exists ---
    forced = fixture(12, usable_wh=1000, max_w=200)
    for a in forced['appliances']:
        if a['id'] not in CRITICAL_IDS:
            a['required_hours'] = 0
    assert not solve(forced)['feasible']
    forced_repairs = find_repairs(forced)
    assert len(forced_repairs) >= 1
    for r in forced_repairs:
        assert r['tier'] == 'requires_compromise'
        assert set(r['touches_critical']) & CRITICAL_IDS
        assert set(c['id'] for c in r['changed']) & CRITICAL_IDS
    checks.append('essentials are only compromised when no essentials-preserving repair exists')

    # --- a scenario where BOTH tiers exist: essentials-preserving must win ---
    both_exist = fixture(12)
    for a in both_exist['appliances']:
        if a['id'] == 'fridge':
            a['required_hours'] = 12  # cheap to shrink and would look attractive by hours alone
    assert not solve(both_exist)['feasible']
    mixed_repairs = find_repairs(both_exist)
    assert all(r['tier'] == 'protects_essentials' for r in mixed_repairs), mixed_repairs
    checks.append('when an essentials-preserving repair exists, no compromise repair is ever offered')

    # --- truly impossible capacity: no repair is fabricated ---
    impossible = fixture(12, usable_wh=100, max_w=200)
    assert find_repairs(impossible) == []
    checks.append('truly impossible capacity (100 Wh): no repair fabricated')

    # --- idempotence / no mutation of the input problem ---
    original_copy = copy.deepcopy(p)
    find_repairs(p)
    assert p == original_copy
    checks.append('find_repairs does not mutate its input problem')

    # --- Phase B: custom critical_ids genuinely change the search, not just display ---
    # Same default-scenario problem as above (infeasible, needs 1908 Wh): with
    # fridge/router as critical, the known repairs are laptop->1h and fan->1h,
    # both protects_essentials. Re-run with lamp+phone marked critical instead
    # (and fridge/router left flexible) and confirm the search actually
    # respects the new selection rather than silently keeping the old one.
    custom = find_repairs(p, critical_ids=frozenset({'lamp', 'phone'}))
    assert len(custom) >= 1
    for r in custom:
        touched = {c['id'] for c in r['changed']}
        if r['tier'] == 'protects_essentials':
            assert not touched & {'lamp', 'phone'}, 'protects_essentials must not touch the new essentials'
        else:
            assert touched & {'lamp', 'phone'}, 'requires_compromise must actually touch a new essential'
        assert set(r['touches_critical']) <= {'lamp', 'phone'}, \
            'touches_critical must reflect the passed-in critical_ids, not the module default'
    # fridge/router are no longer protected, so reducing one of them alone
    # (fridge -> 1h) must now be offered as a protects_essentials repair,
    # which it never is under the default {fridge, router} criticality.
    assert any(
        r['tier'] == 'protects_essentials' and {c['id'] for c in r['changed']} == {'fridge'}
        for r in custom
    ), 'fridge must be freely reducible once it is not selected as essential'
    checks.append("household-defined critical_ids ({'lamp','phone'}) change which repairs are "
                   'found and how they are tagged, not just the default fridge/router pair')

    # --- Phase B: no essentials selected -- every repair is protects_essentials ---
    none_critical = find_repairs(p, critical_ids=frozenset())
    assert len(none_critical) >= 1
    assert all(r['tier'] == 'protects_essentials' for r in none_critical)
    assert all(r['touches_critical'] == [] for r in none_critical)
    checks.append('empty critical_ids: nothing can ever be tagged requires_compromise')

    # --- Phase B: every appliance selected as essential -- compromise is forced ---
    all_critical_repairs = find_repairs(p, critical_ids=frozenset(a['id'] for a in p['appliances']))
    assert len(all_critical_repairs) >= 1
    assert all(r['tier'] == 'requires_compromise' for r in all_critical_repairs)
    checks.append('every appliance marked essential: every repair is forced into requires_compromise')

    print('PASS:', len(checks), 'checks')
    for c in checks:
        print(' -', c)


if __name__ == '__main__':
    main()
