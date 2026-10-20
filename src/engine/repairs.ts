// Ported from engine/repairs.py. See that file's module docstring for the
// full design rationale (two-tier essentials-first search, optimality
// scope, protected-services semantics), preserved unchanged here.
import type {ChangedAppliance, Problem, RepairTier} from '../types';
import {solve} from './solver';
import {check} from './verifier';

export const CRITICAL_IDS = new Set(['fridge', 'router']);

type Repair = {
  changed: ChangedAppliance[];
  problem: Problem;
  result: ReturnType<typeof solve>;
  independent_verification: ReturnType<typeof check>;
  hours_removed: number;
  tier?: RepairTier;
  touches_critical?: string[];
};

function withRequiredHours(problem: Problem, overrides: Record<string, number>): Problem {
  return {
    ...problem,
    appliances: problem.appliances.map(a =>
      a.id in overrides ? {...a, required_hours: overrides[a.id]} : {...a},
    ),
  };
}

function maximumFeasibleHours(
  problem: Problem,
  applianceId: string,
  ceiling: number,
  fixedOverrides: Record<string, number> = {},
): number | null {
  let lo = 0;
  let hi = ceiling;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const overrides = {...fixedOverrides, [applianceId]: mid};
    if (solve(withRequiredHours(problem, overrides)).feasible) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function verifiedCandidate(problem: Problem, changes: Record<string, number>): Repair | null {
  const candidateProblem = withRequiredHours(problem, changes);
  const result = solve(candidateProblem);
  if (!result.feasible) {
    return null;
  }
  const verification = check(candidateProblem, result.schedule);
  if (!verification?.valid) {
    return null;
  }
  const originals: Record<string, number> = {};
  for (const a of problem.appliances) {
    originals[a.id] = a.required_hours;
  }
  const changed: ChangedAppliance[] = Object.entries(changes)
    .filter(([id, hours]) => originals[id] !== hours)
    .map(([id, hours]) => ({id, from_hours: originals[id], to_hours: hours}));
  if (changed.length === 0) {
    return null;
  }
  return {
    changed,
    problem: candidateProblem,
    result,
    independent_verification: verification,
    hours_removed: changed.reduce((s, c) => s + (c.from_hours - c.to_hours), 0),
  };
}

function singleApplianceRepairs(problem: Problem, allowedIds: Set<string>): Repair[] {
  const candidates: Repair[] = [];
  for (const appliance of problem.appliances) {
    if (!allowedIds.has(appliance.id) || appliance.required_hours <= 0) {
      continue;
    }
    const original = appliance.required_hours;
    const reduced = maximumFeasibleHours(problem, appliance.id, original);
    if (reduced === null || reduced === original) {
      continue;
    }
    const repair = verifiedCandidate(problem, {[appliance.id]: reduced});
    if (repair !== null) {
      candidates.push(repair);
    }
  }
  return candidates;
}

function* combinationPairs<T>(items: T[]): Generator<[T, T]> {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      yield [items[i], items[j]];
    }
  }
}

function twoApplianceRepairs(
  problem: Problem,
  allowedIds: Set<string>,
  // When given, skip any pair where BOTH ids already lie inside this set --
  // used by findRepairs' fallback tier to avoid re-running the exact same
  // pair search its first tier already completed (see that function for
  // why this is provably safe to skip, not just an approximation).
  skipPairsFullyWithin?: Set<string>,
): Repair[] {
  const originals: Record<string, number> = {};
  for (const a of problem.appliances) {
    originals[a.id] = a.required_hours;
  }
  const ids = [...allowedIds].filter(id => (originals[id] ?? 0) > 0).sort();
  const candidates: Repair[] = [];
  for (const [idA, idB] of combinationPairs(ids)) {
    if (skipPairsFullyWithin?.has(idA) && skipPairsFullyWithin?.has(idB)) {
      continue;
    }
    const origA = originals[idA];
    const origB = originals[idB];
    type Point = {removed: number; touched: number; changes: Record<string, number>};
    const frontier: Point[] = [];
    const axes: Array<[string, number, string, number]> = [
      [idA, origA, idB, origB],
      [idB, origB, idA, origA],
    ];
    for (const [scanId, scanCeiling, otherId, otherCeiling] of axes) {
      for (let scanHours = 0; scanHours <= scanCeiling; scanHours++) {
        const otherHours = maximumFeasibleHours(problem, otherId, otherCeiling, {
          [scanId]: scanHours,
        });
        if (otherHours === null) {
          continue;
        }
        const removed = scanCeiling - scanHours + (otherCeiling - otherHours);
        const touched = (scanHours < scanCeiling ? 1 : 0) + (otherHours < otherCeiling ? 1 : 0);
        frontier.push({removed, touched, changes: {[scanId]: scanHours, [otherId]: otherHours}});
      }
    }
    if (frontier.length === 0) {
      continue;
    }
    let bestPoint = frontier[0];
    for (const p of frontier) {
      if (p.removed < bestPoint.removed || (p.removed === bestPoint.removed && p.touched < bestPoint.touched)) {
        bestPoint = p;
      }
    }
    const repair = verifiedCandidate(problem, bestPoint.changes);
    if (repair !== null) {
      candidates.push(repair);
    }
  }
  return candidates;
}

function rank(candidates: Repair[]): Repair[] {
  return [...candidates].sort((a, b) => {
    if (a.hours_removed !== b.hours_removed) {
      return a.hours_removed - b.hours_removed;
    }
    if (a.changed.length !== b.changed.length) {
      return a.changed.length - b.changed.length;
    }
    const aIds = a.changed.map(c => c.id).sort().join(',');
    const bIds = b.changed.map(c => c.id).sort().join(',');
    return aIds < bIds ? -1 : aIds > bIds ? 1 : 0;
  });
}

function tagWith(found: Repair[], tier: RepairTier, criticalIds: Set<string>): Repair[] {
  for (const c of found) {
    c.tier = tier;
    c.touches_critical = [...new Set(c.changed.map(x => x.id))]
      .filter(id => criticalIds.has(id))
      .sort();
  }
  return found;
}

// Tags each candidate by what it actually changed, rather than by which
// search pass found it -- needed only for the fallback tier below, where a
// candidate's own changed-appliance set is the source of truth for whether
// it "requires a compromise", not an assumption that everything found
// while essentials were back in scope must touch one.
function tagByActualCriticality(found: Repair[], criticalIds: Set<string>): Repair[] {
  for (const c of found) {
    c.touches_critical = [...new Set(c.changed.map(x => x.id))]
      .filter(id => criticalIds.has(id))
      .sort();
    c.tier = c.touches_critical.length > 0 ? 'requires_compromise' : 'protects_essentials';
  }
  return found;
}

function take(candidates: Repair[], results: Repair[], seen: Set<string>, maxResults: number): boolean {
  for (const c of candidates) {
    const k = [...new Set(c.changed.map(x => x.id))].sort().join(',');
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    results.push(c);
    if (results.length >= maxResults) {
      return true;
    }
  }
  return false;
}

// criticalIds: which appliance ids the search should try to avoid
// touching. Defaults to CRITICAL_IDS (fridge, router) when omitted, so
// every pre-existing caller keeps its exact original behavior -- Phase B
// (household-defined essentials) is the only caller that passes its own
// current selection instead, and that selection genuinely drives this
// search, not just the response's display fields.
export function findRepairs(problem: Problem, maxResults = 2, criticalIds: Set<string> = CRITICAL_IDS): Repair[] {
  if (solve(problem).feasible) {
    return [];
  }
  const allIds = new Set(problem.appliances.map(a => a.id));
  const flexibleIds = new Set([...allIds].filter(id => !criticalIds.has(id)));

  const results: Repair[] = [];
  const seen = new Set<string>();

  // Tier 1: every repair reachable without touching a critical id at all.
  const tier1 = tagWith(
    rank([...singleApplianceRepairs(problem, flexibleIds), ...twoApplianceRepairs(problem, flexibleIds)]),
    'protects_essentials',
    criticalIds,
  );
  if (take(tier1, results, seen, maxResults)) {
    return results;
  }

  // Tier 2 (fallback): tier 1 didn't find enough. Rather than re-running
  // the identical flexible-only single- and two-appliance search a second
  // time against the same unchanged problem -- which can only reproduce
  // the exact same (already-collected-into `seen`) results, since nothing
  // about that search's inputs changed -- only search what tier 1
  // couldn't: single-appliance repairs for the critical ids, and two-
  // appliance pairs that include at least one of them. This is provably
  // equivalent to the old "search everyone again" approach: the skipped
  // flexible-only pairs are deterministic given `problem`, so re-running
  // them would yield the same candidates tier 1 already found (and `seen`
  // would discard the duplicates anyway) or the same empty result tier 1
  // already got. See docs/ENGINE_PORT.md and the differential suite
  // (163 cases, including this exact fallback path) for the verification
  // that this produces byte-identical output to the unoptimized version.
  const tier2New = tagByActualCriticality(
    rank([
      ...singleApplianceRepairs(problem, criticalIds),
      ...twoApplianceRepairs(problem, allIds, flexibleIds),
    ]),
    criticalIds,
  );
  take(tier2New, results, seen, maxResults);
  return results;
}
