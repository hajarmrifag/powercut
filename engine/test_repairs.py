"""Unit tests for the dynamic repair search (repairs.py), independent of the
HTTP layer. Runs standalone, in the style of run_experiment.py.
"""
import copy

from run_experiment import fixture
from repairs import find_repairs
from solver import solve
from verifier import check


def main():
    checks = []

    # --- feasible problems need no repair ---
    assert find_repairs(fixture(8)) == []
    checks.append('feasible problem: find_repairs returns []')

    # --- default infeasible scenario: matches known-good minimal-sacrifice repairs ---
    p = fixture(12)
    assert not solve(p)['feasible']
    repairs = find_repairs(p)
    assert len(repairs) == 2
    for r in repairs:
        assert solve(r['problem'])['feasible']
        assert check(r['problem'], r['result']['schedule'])['valid']
        assert r['independent_verification']['valid']
        assert r['hours_removed'] > 0
    # least-sacrifice-first ranking
    assert repairs[0]['hours_removed'] <= repairs[1]['hours_removed']
    # known minimal single-change fixes for this exact fixture
    found = {frozenset(c['id'] for c in r['changed']) for r in repairs}
    assert found == {frozenset(['fridge']), frozenset(['laptop'])}, found
    laptop_repair = next(r for r in repairs if r['changed'][0]['id'] == 'laptop')
    assert laptop_repair['changed'][0]['to_hours'] == 1  # matches Phase 1's known-good laptop repair
    assert laptop_repair['result']['energy_wh'] == 1778
    checks.append('default scenario: 2 minimal-sacrifice repairs matching known-good values')

    # --- every changed appliance in a repair is only ever reduced, never raised ---
    for r in repairs:
        for c in r['changed']:
            assert c['to_hours'] < c['from_hours']
    checks.append('repairs only ever reduce required_hours, never raise it')

    # --- appliances untouched by a repair keep their original hours exactly ---
    for r in repairs:
        changed_ids = {c['id'] for c in r['changed']}
        originals = {a['id']: a['required_hours'] for a in p['appliances']}
        for appliance in r['problem']['appliances']:
            if appliance['id'] not in changed_ids:
                assert appliance['required_hours'] == originals[appliance['id']]
    checks.append('repairs leave every unrelated appliance exactly as requested')

    # --- extreme, truly-impossible capacity: no repair is fabricated ---
    impossible = fixture(12, usable_wh=100, max_w=200)
    assert find_repairs(impossible) == []
    checks.append('truly impossible capacity (100 Wh): no repair fabricated')

    # --- a scenario needing a two-appliance repair ---
    two_change = fixture(12)
    for a in two_change['appliances']:
        if a['id'] == 'phone':
            a['required_hours'] = 2  # widen the gap enough that no single change suffices
    assert not solve(two_change)['feasible']
    repairs2 = find_repairs(two_change)
    assert len(repairs2) >= 1
    for r in repairs2:
        assert r['independent_verification']['valid']
    checks.append('a harder scenario still returns independently-verified repairs')

    # --- idempotence / no mutation of the input problem ---
    original_copy = copy.deepcopy(p)
    find_repairs(p)
    assert p == original_copy
    checks.append('find_repairs does not mutate its input problem')

    print('PASS:', len(checks), 'checks')
    for c in checks:
        print(' -', c)


if __name__ == '__main__':
    main()
