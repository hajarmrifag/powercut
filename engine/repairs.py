"""Dynamic repair search for infeasible, user-edited household configurations.

Phase 1 offered two hardcoded alternatives (reduce fan, or reduce laptop) for
one fixed scenario. Phase 2 generalized that to any appliance combination,
but its two-appliance search only explored one path across the feasibility
frontier (zero the first appliance, maximize the second, relax the first
back up), which is not guaranteed to find the true minimum-sacrifice pair.
This version fixes that: for a given pair of appliances it enumerates every
value of the first appliance's hours and binary-searches the best matching
value of the second, so the result is the true minimum total service-hours
removed achievable by changing exactly those two appliances -- not just a
value better than before.

It only ever proposes *reducing* required_hours (never raising power limits
or inventing new appliances), and independently re-verifies every candidate
with verifier.check before returning it. Nothing here is returned without
that verification passing.

OPTIMALITY SCOPE: within a search restricted to changing at most two
appliances at once, every repair returned is the exact minimum-sacrifice
choice for its particular set of changed appliances (proven by exhaustive
enumeration for the pair case, and by binary search under the solver's
monotonic-in-required-hours property for the single case -- see
test_repairs.py for an adversarial brute-force check of both). This module
does NOT search three-or-more-simultaneous-appliance changes, so "no repair
found" means none exists within one or two changes, not that the problem is
unfixable by any repair -- find_repairs never claims global optimality
beyond its stated one-or-two-appliance scope, and callers should not either.

PROTECTED SERVICES: fridge (food safety) and router (basic connectivity) are
treated as critical by default and are only touched by the automatic repair
search if no repair exists that leaves them untouched. This governs the
*search* only -- a household's own direct edit to either appliance's
required_hours (made through the UI) is never overridden by this module.
"""
import copy
from itertools import combinations

from solver import solve
from verifier import check

CRITICAL_IDS = frozenset({'fridge', 'router'})


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
    makes a schedule harder to fit), so a standard binary search is exact.
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


def _single_appliance_repairs(problem, allowed_ids):
    """Exact: for each appliance in allowed_ids, the single largest required-
    hours value that alone restores feasibility, all others held fixed."""
    candidates = []
    for appliance in problem['appliances']:
        if appliance['id'] not in allowed_ids or appliance['required_hours'] <= 0:
            continue
        original = appliance['required_hours']
        reduced = _maximum_feasible_hours(problem, appliance['id'], original)
        if reduced is None or reduced == original:
            continue
        repair = _verified_candidate(problem, {appliance['id']: reduced})
        if repair is not None:
            candidates.append(repair)
    return candidates


def _two_appliance_repairs(problem, allowed_ids):
    """Exact minimum joint sacrifice for every pair within allowed_ids: for
    every possible value of the first appliance's hours, binary-search the
    best matching value of the second, and keep whichever point on that
    frontier removes the fewest total hours. This enumerates the whole
    feasibility frontier for the pair rather than one path across it.

    The minimum total removed is mathematically the same whichever of the
    two appliances is scanned (feasibility is monotonic in each, holding
    the other fixed, so a full scan of either axis traces the entire
    frontier). But the frontier can contain several points tied at that
    same minimum total -- including a "degenerate" point where the second
    appliance doesn't need to move at all, which is really a single-
    appliance repair in disguise. Scanning only one axis picks whichever
    tied point that axis happens to reach, which is arbitrary. So both
    axes are scanned and, among points tied at the true minimum, the one
    touching fewer appliances is kept -- a strictly simpler repair for a
    household to act on, and a deterministic, order-independent choice
    rather than one that depends on dict/set iteration order."""
    originals = {a['id']: a['required_hours'] for a in problem['appliances']}
    # allowed_ids is a set, whose iteration order depends on PYTHONHASHSEED;
    # sorting here keeps pair *discovery* order reproducible across runs
    # (on top of _rank's own tiebreaker below, which keeps the final
    # *ranking* reproducible regardless of discovery order).
    ids = sorted(aid for aid in allowed_ids if originals.get(aid, 0) > 0)
    candidates = []
    for id_a, id_b in combinations(ids, 2):
        orig_a, orig_b = originals[id_a], originals[id_b]
        frontier = []
        for scan_id, scan_ceiling, other_id, other_ceiling in (
                (id_a, orig_a, id_b, orig_b), (id_b, orig_b, id_a, orig_a)):
            for scan_hours in range(scan_ceiling + 1):
                other_hours = _maximum_feasible_hours(
                    problem, other_id, other_ceiling, fixed_overrides={scan_id: scan_hours})
                if other_hours is None:
                    continue
                removed = (scan_ceiling - scan_hours) + (other_ceiling - other_hours)
                touched = (scan_hours < scan_ceiling) + (other_hours < other_ceiling)
                frontier.append((removed, touched, {scan_id: scan_hours, other_id: other_hours}))
        if not frontier:
            continue
        _, _, changes = min(frontier, key=lambda point: (point[0], point[1]))
        repair = _verified_candidate(problem, changes)
        if repair is not None:
            candidates.append(repair)
    return candidates


def _rank(candidates):
    """Sort by the correct optimization priorities -- least total sacrifice,
    then fewest appliances touched -- with a final tiebreaker (sorted
    changed-appliance ids) so that two candidates tied on both of those
    still sort the same way every run. Without it, ties could be ordered by
    whatever order dict/set iteration happened to discover them in, which
    varies by PYTHONHASHSEED and is not reproducible across process runs
    (confirmed: the same tied scenario produced a different Alternative A/B
    ordering across hash seeds before this tiebreaker was added)."""
    candidates.sort(key=lambda c: (
        c['hours_removed'],
        len(c['changed']),
        tuple(sorted(x['id'] for x in c['changed'])),
    ))
    return candidates


def find_repairs(problem, max_results=2, critical_ids=None):
    """Up to max_results distinct, independently-verified feasible repairs
    for an infeasible problem, ranked by least total service hours removed.
    Returns [] if the problem is already feasible, or if no repair exists
    within one or two simultaneous appliance reductions.

    critical_ids: which appliance ids the search should try to avoid
    touching. Defaults to CRITICAL_IDS (fridge, router) when omitted, so
    every pre-existing caller and test keeps its exact original behavior.
    Phase B (household-defined essentials) passes the household's own
    current selection instead -- this is the only change needed here to
    let that selection genuinely drive the search, not just the display.

    Each result is tagged:
      tier='protects_essentials' -- feasible without touching any id in
        critical_ids.
      tier='requires_compromise' -- only feasible by also reducing one or
        more critical_ids; 'touches_critical' names which ones.
    protects_essentials repairs are always preferred and listed first;
    requires_compromise repairs are only included to fill remaining slots
    when fewer than max_results essentials-preserving repairs exist.
    """
    critical_ids = CRITICAL_IDS if critical_ids is None else frozenset(critical_ids)
    if solve(problem)['feasible']:
        return []
    all_ids = {a['id'] for a in problem['appliances']}
    flexible_ids = all_ids - critical_ids

    def tagged(allowed_ids, tier):
        found = _rank(_single_appliance_repairs(problem, allowed_ids) +
                       _two_appliance_repairs(problem, allowed_ids))
        for c in found:
            c['tier'] = tier
            c['touches_critical'] = sorted({x['id'] for x in c['changed']} & critical_ids)
        return found

    def take(candidates, results, seen):
        for c in candidates:
            key = frozenset(x['id'] for x in c['changed'])
            if key in seen:
                continue
            seen.add(key)
            results.append(c)
            if len(results) >= max_results:
                return True
        return False

    results, seen = [], set()
    if take(tagged(flexible_ids, 'protects_essentials'), results, seen):
        return results
    take(tagged(all_ids, 'requires_compromise'), results, seen)
    return results
