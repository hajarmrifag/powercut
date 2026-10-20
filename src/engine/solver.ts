// Ported from engine/solver.py: keep behavior byte-for-byte equivalent.
// The Python original remains the reference implementation; see
// engine/differential/ for the cross-language test harness that enforces
// this file never silently drifts from it.
import type {EnergyConflict, Problem, SolveResult} from '../types';

export function validate(problem: Problem): void {
  const h = problem.hours;
  if (!Number.isInteger(h) || h < 1 || h > 24) {
    throw new Error('hours must be an integer in 1..24');
  }
  for (const key of ['usable_wh', 'max_w'] as const) {
    const v = problem[key];
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  const ids = new Set<string>();
  if (problem.appliances.length !== 6) {
    throw new Error('this experiment requires six appliances');
  }
  for (const a of problem.appliances) {
    if (ids.has(a.id)) {
      throw new Error('duplicate appliance id');
    }
    ids.add(a.id);
    if (
      !(a.low_w >= 0 && a.low_w <= a.high_w) ||
      !Number.isInteger(a.low_w) ||
      !Number.isInteger(a.high_w) ||
      !Number.isInteger(a.required_hours)
    ) {
      throw new Error('invalid appliance bounds');
    }
    if (!(a.required_hours >= 0 && a.required_hours <= h)) {
      throw new Error('invalid service requirement');
    }
    if (a.allowed_hours.some(t => !Number.isInteger(t) || !(t >= 0 && t < h))) {
      throw new Error('invalid window');
    }
  }
}

type Bound = 'low_w' | 'high_w';

function uniq(xs: number[]): Set<number> {
  return new Set(xs);
}

export function solve(problem: Problem, bound: Bound = 'high_w'): SolveResult {
  validate(problem);
  if (bound !== 'low_w' && bound !== 'high_w') {
    throw new Error('unknown power bound');
  }
  const started = Date.now();
  const appliances = problem.appliances;
  const targets = appliances.map(a => a.required_hours);
  const lowerEnergy = appliances.reduce((sum, a) => sum + a[bound] * a.required_hours, 0);
  if (lowerEnergy > problem.usable_wh) {
    return {
      feasible: false,
      reason: 'energy_lower_bound',
      required_wh: lowerEnergy,
      budget_wh: problem.usable_wh,
      elapsed_ms: Date.now() - started,
    } as SolveResult;
  }
  if (appliances.some(a => a.required_hours > uniq(a.allowed_hours).size)) {
    return {
      feasible: false,
      reason: 'service_window',
      elapsed_ms: Date.now() - started,
    } as SolveResult;
  }

  const n = appliances.length;
  const allowedSets = appliances.map(a => uniq(a.allowed_hours));
  const key = (counts: number[]) => counts.join(',');

  let states = new Map<string, {counts: number[]; peak: number; path: string[][]}>();
  const zero = new Array(n).fill(0);
  states.set(key(zero), {counts: zero, peak: 0, path: []});
  let visited = 0;

  for (let hour = 0; hour < problem.hours; hour++) {
    const next = new Map<string, {counts: number[]; peak: number; path: string[][]}>();
    for (const {counts, peak, path} of states.values()) {
      const remainingAfter = (i: number) => {
        let c = 0;
        for (const t of allowedSets[i]) {
          if (t > hour) {
            c++;
          }
        }
        return c;
      };
      const remainingFrom = (i: number) => {
        let c = 0;
        for (const t of allowedSets[i]) {
          if (t >= hour) {
            c++;
          }
        }
        return c;
      };
      const mandatory: number[] = [];
      const available: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!allowedSets[i].has(hour) || counts[i] >= targets[i]) {
          continue;
        }
        if (remainingFrom(i) === targets[i] - counts[i]) {
          mandatory.push(i);
        } else {
          available.push(i);
        }
      }
      const combos = 1 << available.length;
      for (let bits = 0; bits < combos; bits++) {
        const selected = [...mandatory];
        for (let j = 0; j < available.length; j++) {
          if (bits & (1 << j)) {
            selected.push(available[j]);
          }
        }
        if (selected.some(i => !allowedSets[i].has(hour))) {
          continue;
        }
        const watts = selected.reduce((s, i) => s + appliances[i][bound], 0);
        if (watts > problem.max_w) {
          continue;
        }
        const selectedSet = new Set(selected);
        const newCounts = counts.map((c, i) => c + (selectedSet.has(i) ? 1 : 0));
        let windowOk = true;
        for (let i = 0; i < n; i++) {
          if (targets[i] - newCounts[i] > remainingAfter(i)) {
            windowOk = false;
            break;
          }
        }
        if (!windowOk) {
          continue;
        }
        const energy = newCounts.reduce((s, c, i) => s + c * appliances[i][bound], 0);
        if (energy > problem.usable_wh) {
          continue;
        }
        const candidatePeak = Math.max(peak, watts);
        const k = key(newCounts);
        const old = next.get(k);
        if (old === undefined || candidatePeak < old.peak) {
          next.set(k, {
            counts: newCounts,
            peak: candidatePeak,
            path: [...path, selected.map(i => appliances[i].id)],
          });
        }
        visited++;
      }
    }
    states = next;
    if (states.size === 0) {
      break;
    }
  }

  const result = states.get(key(targets));
  if (result === undefined) {
    return {
      feasible: false,
      reason: 'power_or_window_conflict',
      states_visited: visited,
      elapsed_ms: Date.now() - started,
    } as SolveResult;
  }
  return {
    feasible: true,
    schedule: result.path,
    energy_wh: lowerEnergy,
    remaining_wh: problem.usable_wh - lowerEnergy,
    peak_w: result.peak,
    bound,
    states_visited: visited,
    elapsed_ms: Date.now() - started,
  } as SolveResult;
}

export function energyConflict(problem: Problem): EnergyConflict {
  const appliances = problem.appliances;
  const n = appliances.length;
  for (let size = 1; size <= n; size++) {
    for (const subsetIdx of combinations(n, size)) {
      const subset = subsetIdx.map(i => appliances[i]);
      const energy = subset.reduce((s, a) => s + a.high_w * a.required_hours, 0);
      if (energy > problem.usable_wh) {
        return {
          services: subset.map(a => a.id),
          required_wh: energy,
          budget_wh: problem.usable_wh,
          cardinality: size,
          scope: 'constant upper-bound energy with fixed usable battery',
        };
      }
    }
  }
  return null;
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({length: k}, (_, i) => i);
  if (k > n) {
    return;
  }
  while (true) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) {
      i--;
    }
    if (i < 0) {
      return;
    }
    idx[i]++;
    for (let j = i + 1; j < k; j++) {
      idx[j] = idx[j - 1] + 1;
    }
  }
}
