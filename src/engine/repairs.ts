// Ported from engine/repairs.py. See that file's module docstring for the
// full design rationale (two-tier essentials-first search, optimality
// scope, protected-services semantics) — preserved unchanged here.
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

function twoApplianceRepairs(problem: Problem, allowedIds: Set<string>): Repair[] {
  const originals: Record<string, number> = {};
  for (const a of problem.appliances) {
    originals[a.id] = a.required_hours;
  }
  const ids = [...allowedIds].filter(id => (originals[id] ?? 0) > 0).sort();
  const candidates: Repair[] = [];
  for (const [idA, idB] of combinationPairs(ids)) {
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

export function findRepairs(problem: Problem, maxResults = 2): Repair[] {
  if (solve(problem).feasible) {
    return [];
  }
  const allIds = new Set(problem.appliances.map(a => a.id));
  const flexibleIds = new Set([...allIds].filter(id => !CRITICAL_IDS.has(id)));

  function tagged(allowedIds: Set<string>, tier: RepairTier): Repair[] {
    const found = rank([
      ...singleApplianceRepairs(problem, allowedIds),
      ...twoApplianceRepairs(problem, allowedIds),
    ]);
    for (const c of found) {
      c.tier = tier;
      c.touches_critical = [...new Set(c.changed.map(x => x.id))]
        .filter(id => CRITICAL_IDS.has(id))
        .sort();
    }
    return found;
  }

  function take(candidates: Repair[], results: Repair[], seen: Set<string>): boolean {
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

  const results: Repair[] = [];
  const seen = new Set<string>();
  if (take(tagged(flexibleIds, 'protects_essentials'), results, seen)) {
    return results;
  }
  take(tagged(allIds, 'requires_compromise'), results, seen);
  return results;
}
