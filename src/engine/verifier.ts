// Ported from engine/verifier.py — independent schedule checker. Deliberately
// does not import solver.ts, matching the Python original's isolation.
import type {Problem, ScheduleRow, Verification} from '../types';

type Bound = 'low_w' | 'high_w';

export function check(problem: Problem, schedule: string[][] | undefined, bound: Bound = 'high_w'): Verification {
  const errors: string[] = [];
  if (!schedule || schedule.length !== problem.hours) {
    // Matches engine/verifier.py exactly: only `valid`/`errors` are present
    // on this early-return path (dead in normal operation — solve() only
    // ever returns a schedule whose length equals problem.hours).
    return {valid: false, errors: ['wrong horizon']} as Verification;
  }
  const counts: Record<string, number> = {};
  const registry: Record<string, Problem['appliances'][number]> = {};
  for (const a of problem.appliances) {
    counts[a.id] = 0;
    registry[a.id] = a;
  }
  let battery = problem.usable_wh;
  let peak = 0;
  const rows: ScheduleRow[] = [];
  for (let t = 0; t < schedule.length; t++) {
    const names = schedule[t];
    if (names.length !== new Set(names).size) {
      errors.push(`duplicate load at hour ${t}`);
    }
    let load = 0;
    for (const name of names) {
      const a = registry[name];
      if (a === undefined) {
        errors.push(`unknown load ${name}`);
        continue;
      }
      counts[name] += 1;
      load += a[bound];
      if (!a.allowed_hours.includes(t)) {
        errors.push(`${name} outside window at ${t}`);
      }
    }
    battery -= load;
    peak = Math.max(peak, load);
    if (load > problem.max_w) {
      errors.push(`output limit exceeded at ${t}`);
    }
    if (battery < 0) {
      errors.push(`energy depleted at ${t}`);
    }
    rows.push({hour: t, loads: names, watts: load, remaining_wh: battery});
  }
  for (const a of problem.appliances) {
    if (counts[a.id] < a.required_hours) {
      errors.push(`service not met: ${a.id}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    energy_wh: problem.usable_wh - battery,
    remaining_wh: battery,
    peak_w: peak,
    service_hours: counts,
    hourly: rows,
  };
}
