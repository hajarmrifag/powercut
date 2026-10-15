"""Dynamic repair search for infeasible, user-edited household configurations.

Phase 1 offered two hardcoded alternatives (reduce fan, or reduce laptop) for
one fixed scenario. This module generalizes that idea to any appliance
combination and any user-edited required_hours / battery capacity: it only
ever proposes *reducing* required_hours (never raising power limits or
inventing new appliances), searches for the smallest sacrifice that restores
feasibility, and independently re-verifies every candidate with
verifier.check before returning it. Nothing here is returned without that
verification passing.
"""
import copy

from solver import solve
from verifier import check


def _with_required_hours(problem, overrides):
    """Deep copy of problem with required_hours overridden for the given
    {appliance_id: hours} map; all other fields (power, window) untouched."""
    candidate = copy.deepcopy(problem)
    for appliance in candidate['appliances']:
        if appliance['id'] in overrides:
            appliance['required_hours'] = overrides[appliance['id']]
    return candidate


def _maximum_feasible_hours(problem, appliance_id, ceiling, fixed_overrides=None):
    """Binary search the LARGEST required_hours for one appliance (0..ceiling)
    that still makes the problem feasible, holding every other appliance's
    hours at `fixed_overrides` (or their current value in `problem` if not
    given). This is the smallest possible sacrifice for that appliance.
    Feasibility is monotonic in required_hours (fewer required hours never
    makes a schedule harder to fit), so a standard binary search applies.
    Returns None if even 0 hours is still infeasible."""
    fixed_overrides = dict(fixed_overrides or {})
    lo, hi, best = 0, ceiling, None
    while lo <= hi:
        mid = (lo + hi + 1) // 2
        overrides = {**fixed_overrides, appliance_id: mid}
        if solve(_with_required_hours(problem, overrides))['feasible']:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _verified_candidate(problem, changes):
    """changes: {appliance_id: new_hours}. Returns a verified repair dict, or
    None if the resulting schedule is infeasible or fails independent check."""
    candidate_problem = _with_required_hours(problem, changes)
    result = solve(candidate_problem)
    if not result['feasible']:
        return None
    verification = check(candidate_problem, result['schedule'])
    if not verification['valid']:
        return None
    originals = {a['id']: a['required_hours'] for a in problem['appliances']}
    changed = [
        {'id': aid, 'from_hours': originals[aid], 'to_hours': hours}
        for aid, hours in changes.items() if originals[aid] != hours
    ]
    if not changed:
        return None
    return {
        'changed': changed,
        'problem': candidate_problem,
        'result': result,
        'independent_verification': verification,
        'hours_removed': sum(c['from_hours'] - c['to_hours'] for c in changed),
    }


def _single_appliance_repairs(problem):
    candidates = []
    for appliance in problem['appliances']:
        original = appliance['required_hours']
        if original <= 0:
            continue
        reduced = _maximum_feasible_hours(problem, appliance['id'], original)
        if reduced is None or reduced == original:
            continue
        repair = _verified_candidate(problem, {appliance['id']: reduced})
        if repair is not None:
            candidates.append(repair)
    return candidates


def _two_appliance_repairs(problem):
    ids = [a['id'] for a in problem['appliances'] if a['required_hours'] > 0]
    originals = {a['id']: a['required_hours'] for a in problem['appliances']}
    candidates = []
    for i, id_a in enumerate(ids):
        for id_b in ids[i + 1:]:
            max_b = _maximum_feasible_hours(
                problem, id_b, originals[id_b], fixed_overrides={id_a: 0})
            if max_b is None:
                continue
            max_a = _maximum_feasible_hours(
                problem, id_a, originals[id_a], fixed_overrides={id_b: max_b})
            if max_a is None:
                max_a = 0
            repair = _verified_candidate(problem, {id_a: max_a, id_b: max_b})
            if repair is not None:
                candidates.append(repair)
    return candidates


def find_repairs(problem, max_results=2):
    """Up to max_results distinct, independently-verified feasible repairs
    for an infeasible problem, ranked by least total service hours removed
    (fewest appliances touched as a tiebreaker). Returns [] if the problem
    is already feasible, or if no repair was found within one or two
    simultaneous appliance reductions."""
    if solve(problem)['feasible']:
        return []
    candidates = _single_appliance_repairs(problem) + _two_appliance_repairs(problem)
    candidates.sort(key=lambda c: (c['hours_removed'], len(c['changed'])))
    results, seen = [], set()
    for candidate in candidates:
        key = frozenset(c['id'] for c in candidate['changed'])
        if key in seen:
            continue
        seen.add(key)
        results.append(candidate)
        if len(results) >= max_results:
            break
    return results
