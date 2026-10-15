"""Backend request-handling tests: malformed input, impossible constraints,
and that every alternative returned is actually independently verified.

Runs standalone (no pytest, no server process) against the handler's own
pure functions, matching the style of engine/run_experiment.py. Exits
non-zero (via assert) on any failure.
"""
from server import validate_request, build_plan, default_config, InputError, OUTAGE_HOURS
from repairs import CRITICAL_IDS


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

    # --- /defaults marks fridge and router as critical, nothing else ---
    cfg = default_config()
    assert set(cfg['critical_ids']) == CRITICAL_IDS
    for a in cfg['appliances']:
        assert a['critical'] == (a['id'] in CRITICAL_IDS), a
    checks.append('/defaults marks exactly fridge and router as critical')

    # --- default scenario's repairs protect essentials and say so ---
    plan = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances()})
    assert plan['requested']['critical_reduced'] == []
    for alt in plan['alternatives']:
        assert alt['tier'] == 'protects_essentials'
        assert alt['touches_critical'] == []
        changed_ids = {c['id'] for c in alt['changed']}
        assert changed_ids <= {'fridge', 'router', 'lamp', 'phone', 'laptop', 'fan'} - CRITICAL_IDS
        assert 'fridge' in alt['stays_powered'] and 'router' in alt['stays_powered']
        assert 'Keeps every essential service' in alt['summary']
    checks.append('default scenario: repairs protect essentials and say so in plain language')

    # --- when no essentials-preserving repair exists, the compromise is explained ---
    forced = build_plan(1000, 200, {a['id']: (12 if a['id'] in ('fridge', 'router') else 0)
                                     for a in all_appliances()})
    assert not forced['requested']['result']['feasible']
    assert len(forced['alternatives']) >= 1
    for alt in forced['alternatives']:
        assert alt['tier'] == 'requires_compromise'
        assert alt['touches_critical'], alt
        assert 'usually protected by default' in alt['summary']
    checks.append('forced-compromise scenario: tier and summary correctly explain the trade-off')

    # --- a household's own reduction of an essential is reported, not hidden ---
    self_reduced = build_plan(1800, 200, {a['id']: a['required_hours'] for a in all_appliances(fridge=6)})
    assert self_reduced['requested']['critical_reduced'] == ['fridge']
    checks.append("a household's own reduction of fridge/router below full is surfaced via critical_reduced")

    print('PASS:', len(checks), 'checks')
    for c in checks:
        print(' -', c)


if __name__ == '__main__':
    main()
