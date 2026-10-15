"""Backend request-handling tests: malformed input, impossible constraints,
and that every alternative returned is actually independently verified.

Runs standalone (no pytest, no server process) against the handler's own
pure functions, matching the style of engine/run_experiment.py. Exits
non-zero (via assert) on any failure.
"""
from server import validate_request, build_plan, InputError, OUTAGE_HOURS


def expect_rejected(data, label):
    try:
        validate_request(data)
    except InputError:
        return
    raise AssertionError(f'{label}: expected InputError, got none')


def all_appliances(**overrides):
    base = {'fridge': 12, 'router': 12, 'lamp': 4, 'phone': 1, 'laptop': 3, 'fan': 4}
    base.update(overrides)
    return [{'id': k, 'required_hours': v} for k, v in base.items()]


def main():
    checks = []

    # --- malformed input is rejected, never crashes the server ---
    expect_rejected({'appliances': [{'id': 'toaster', 'required_hours': 1}]}, 'unknown id')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': 1},
                                     {'id': 'fridge', 'required_hours': 2}]}, 'duplicate id')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': 99}]}, 'hours too high')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': -1}]}, 'negative hours')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': 'twelve'}]}, 'wrong type')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': 1.5}]}, 'float hours')
    expect_rejected({'usable_wh': 99999}, 'usable_wh too high')
    expect_rejected({'usable_wh': 0}, 'usable_wh too low')
    expect_rejected({'max_w': 10000}, 'max_w too high')
    expect_rejected({'hack': True}, 'unexpected field')
    expect_rejected({'appliances': [{'id': 'fridge'}]}, 'missing required_hours')
    expect_rejected({'appliances': [{'id': 'fridge', 'required_hours': 1, 'extra': 1}]}, 'extra key')
    expect_rejected({'appliances': []}, 'empty appliances list')
    expect_rejected({'appliances': 'fridge'}, 'appliances not a list')
    checks.append('malformed input rejected with InputError in every case')

    # --- valid partial/empty edits are accepted ---
    usable_wh, max_w, overrides = validate_request({})
    assert (usable_wh, max_w, overrides) == (1800, 200, {}), 'empty body should use all defaults'
    usable_wh, max_w, overrides = validate_request({'usable_wh': 2000})
    assert usable_wh == 2000 and max_w == 200
    checks.append('valid/partial/empty requests accepted with correct defaults')

    # --- default scenario: infeasible, explained, two independently-verified repairs ---
    plan = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances()})
    assert not plan['requested']['result']['feasible']
    assert plan['requested']['explanation'] is not None
    assert plan['requested']['conflict'] is not None
    assert len(plan['alternatives']) == 2
    for alt in plan['alternatives']:
        assert alt['result']['feasible'], alt['id']
        assert alt['independent_verification']['valid'], alt['id']
        assert alt['hours_removed'] > 0
    assert plan['alternatives'][0]['hours_removed'] <= plan['alternatives'][1]['hours_removed'], \
        'alternatives should be ranked by least sacrifice first'
    checks.append('default scenario: infeasible with explanation + 2 verified ranked repairs')

    # --- a user edit that resolves feasibility up front needs no repairs ---
    plan = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances(laptop=1)})
    assert plan['requested']['result']['feasible']
    assert plan['requested']['explanation'] is None
    assert plan['requested']['independent_verification']['valid']
    assert plan['alternatives'] == []
    checks.append('feasible user edit: no explanation, no repairs offered')

    # --- impossible-but-well-typed input (window overflow) is solved, not rejected ---
    plan = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances(phone=OUTAGE_HOURS)})
    assert not plan['requested']['result']['feasible']
    assert plan['requested']['explanation'] is not None
    for alt in plan['alternatives']:
        assert alt['independent_verification']['valid']
    checks.append('impossible-but-valid input (phone beyond its window) solved and explained, not rejected')

    # --- extreme capacity: honestly reports no repair rather than fabricating one ---
    plan = build_plan(100, 200, {a['id']: a['required_hours'] for a in all_appliances()})
    assert not plan['requested']['result']['feasible']
    assert plan['alternatives'] == [], 'should not fabricate a repair when none exists within scope'
    checks.append('extreme capacity (100 Wh): infeasible, zero repairs, no fabricated result')

    # --- every alternative's own problem+schedule is self-consistent ---
    plan = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances()})
    for alt in plan['alternatives']:
        changed_ids = {c['id'] for c in alt['changed']}
        for appliance in alt['problem']['appliances']:
            if appliance['id'] in changed_ids:
                change = next(c for c in alt['changed'] if c['id'] == appliance['id'])
                assert appliance['required_hours'] == change['to_hours']
            else:
                original = next(a for a in all_appliances() if a['id'] == appliance['id'])
                assert appliance['required_hours'] == original['required_hours']
    checks.append('alternative problems only change the appliances listed in `changed`')

    print('PASS:', len(checks), 'checks')
    for c in checks:
        print(' -', c)


if __name__ == '__main__':
    main()
