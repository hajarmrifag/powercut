import copy
import json
import random
import statistics
from pathlib import Path
from solver import solve, energy_conflict
from verifier import check, exhaustive_oracle

ROOT = Path(__file__).resolve().parents[1]


def fixture(hours, usable_wh=1800, max_w=200):
    profiles = [
        ('fridge', 60, 90, hours, range(hours)),
        ('router', 20, 30, hours, range(hours)),
        ('lamp', 8, 12, min(4,hours), range(min(4,hours))),
        ('phone', 15, 25, 1, range(min(3,hours))),
        ('laptop', 45, 65, min(3,hours), range(min(6,hours))),
        ('fan', 30, 50, min(4,hours), range(hours)),
    ]
    return {'synthetic': True, 'hours': hours, 'usable_wh': usable_wh, 'max_w': max_w,
            'assumptions': ['one-hour bins', 'constant bounded effective watts', 'fridge is averaged duty load',
                            'no charging, solar, wiring validation or startup surge model',
                            'usable Wh already accounts for reserve and conversion loss'],
            'appliances': [{'id': i, 'low_w': low, 'high_w': high, 'required_hours': required,
                            'allowed_hours': list(window)} for i,low,high,required,window in profiles]}


def main():
    tests = []
    cases = {}
    for h in (4,6,8,12,16):
        cases[f'outage_{h}h'] = fixture(h)
    for label, identifier, hours in [('repair_fan_1h','fan',1), ('repair_laptop_1h','laptop',1)]:
        p = fixture(12)
        next(a for a in p['appliances'] if a['id'] == identifier)['required_hours'] = hours
        cases[label] = p
    cases['repair_capacity_2000wh'] = fixture(12,2000)
    conflict = fixture(3,10000,200)
    for a in conflict['appliances']:
        a['required_hours'] = 3 if a['id'] in ('fridge','router','laptop','fan') else 0
        a['allowed_hours'] = list(range(3))
    cases['power_infeasible_with_abundant_energy'] = conflict
    results = {}
    for name,p in cases.items():
        result = solve(p)
        verified = check(p,result['schedule']) if result['feasible'] else None
        assert verified is None or verified['valid'], (name,verified)
        if verified:
            assert verified['energy_wh'] == result['energy_wh']
            assert verified['peak_w'] == result['peak_w']
        results[name] = {'problem': p, 'result': result, 'independent_verification': verified,
                         'energy_conflict': energy_conflict(p)}
    for name in ['outage_8h','repair_fan_1h','repair_laptop_1h','repair_capacity_2000wh']:
        assert results[name]['result']['feasible'], name
        tests.append(f'{name}: solver and independent verifier passed')
    for name in ['outage_4h','outage_6h','outage_12h','outage_16h','power_infeasible_with_abundant_energy']:
        assert not results[name]['result']['feasible'], name
        tests.append(f'{name}: expected infeasibility detected')
    assert results['outage_12h']['result']['required_wh'] == 1908
    assert results['repair_fan_1h']['result']['energy_wh'] == 1758
    assert results['repair_laptop_1h']['result']['energy_wh'] == 1778
    optimistic = solve(fixture(12), 'low_w')
    assert optimistic['feasible'] and optimistic['energy_wh'] == 1262
    tests.append('uncertainty: low-bound feasible, high-bound infeasible')
    robust_case = results['repair_fan_1h']
    for bound in ['low_w','high_w']:
        assert check(robust_case['problem'], robust_case['result']['schedule'], bound)['valid']
    tests.append('robust repaired schedule valid at both constant interval endpoints')
    for mutation in ['duplicate','unknown','missing','overload']:
        schedule = copy.deepcopy(results['outage_8h']['result']['schedule'])
        if mutation == 'duplicate': schedule[0].append(schedule[0][0])
        if mutation == 'unknown': schedule[0].append('imaginary')
        if mutation == 'missing': schedule[0] = [x for x in schedule[0] if x != 'fridge']
        if mutation == 'overload': schedule[0] = [a['id'] for a in fixture(8)['appliances']]
        assert not check(fixture(8),schedule)['valid'], mutation
        tests.append(f'verifier rejects {mutation}')
    rng = random.Random(20261012)
    oracle_matches = []
    for i in range(60):
        h = rng.choice([2,3])
        p = fixture(h, rng.randint(100,850), rng.randint(130,285))
        for a in p['appliances'][2:]:
            a['required_hours'] = rng.randint(0,h)
            a['allowed_hours'] = [t for t in range(h) if rng.random() < .8]
        actual = solve(p)
        oracle = exhaustive_oracle(p)
        assert actual['feasible'] == oracle['feasible'], (i,p,actual,oracle)
        if actual['feasible']:
            assert actual['peak_w'] == oracle['optimal_peak_w'], (i,p,actual,oracle)
            assert check(p,actual['schedule'])['valid']
        oracle_matches.append({'case': i, 'feasible': actual['feasible'], 'matched': True})
    tests.append('60 fixed-seed independent exhaustive feasibility and optimal-peak comparisons passed')
    timings = []
    for _ in range(100):
        timings.append(solve(fixture(8))['elapsed_ms'])
    report = {'cases': results, 'tests': tests, 'oracle_comparisons': oracle_matches,
              'timing_8h_100_runs_ms': {'median': statistics.median(timings),
                                      'p95': sorted(timings)[94], 'max': max(timings)},
              'status': 'PASS', 'limits': fixture(8)['assumptions']}
    target = ROOT/'evidence'/'solver-results.json'
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status': 'PASS', 'checks': len(tests),
                      'cases': {name: {k:v for k,v in row['result'].items() if k != 'schedule'} for name,row in results.items()},
                      'timing': report['timing_8h_100_runs_ms'], 'report': str(target)},indent=2))


if __name__ == '__main__':
    main()
