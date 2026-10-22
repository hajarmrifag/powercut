// Ported from backend/server.py's business logic (validate_request,
// build_problem, explain_infeasibility, build_plan, default_config).
// Runs entirely in-process: no HTTP, no localhost, no Python server
// dependency. See src/api.ts for the thin wrapper that replaces the old
// fetch()-based calls with these functions.
import type {
  ApplianceRequirement,
  Defaults,
  EnergyConflict,
  Plan,
  Problem,
  SolveResult,
} from '../types';
import {energyConflict, solve} from './solver';
import {check} from './verifier';
import {CRITICAL_IDS, findRepairs} from './repairs';
import {fixture} from './fixture';

export const OUTAGE_HOURS = 12;
export const DEFAULT_USABLE_WH = 1800;
export const DEFAULT_MAX_W = 200;
const KNOWN_IDS = ['fridge', 'router', 'lamp', 'phone', 'laptop', 'fan'];

// One per app session, matching the Python backend's one-per-process
// INSTANCE token; nonce is regenerated per call, matching per-request.
const INSTANCE = randomHex(6);

function randomHex(bytes: number): string {
  let s = '';
  for (let i = 0; i < bytes; i++) {
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return s;
}

export class InputError extends Error {}

export function validateRequest(
  usableWh: number | undefined,
  maxW: number | undefined,
  appliances: ApplianceRequirement[] | undefined,
  criticalIds?: string[],
): {usableWh: number; maxW: number; overrides: Record<string, number>; criticalIds?: Set<string>} {
  const uw = usableWh ?? DEFAULT_USABLE_WH;
  const mw = maxW ?? DEFAULT_MAX_W;
  if (!Number.isInteger(uw) || !(uw >= 100 && uw <= 10000)) {
    throw new InputError('usable_wh must be an integer in 100..10000');
  }
  if (!Number.isInteger(mw) || !(mw >= 50 && mw <= 2000)) {
    throw new InputError('max_w must be an integer in 50..2000');
  }
  let validatedCriticalIds: Set<string> | undefined;
  if (criticalIds !== undefined) {
    if (!Array.isArray(criticalIds) || criticalIds.some(id => typeof id !== 'string')) {
      throw new InputError('critical_ids must be a list of appliance ids');
    }
    if (new Set(criticalIds).size !== criticalIds.length) {
      throw new InputError('critical_ids must not contain duplicates');
    }
    const unknown = criticalIds.filter(id => !KNOWN_IDS.includes(id));
    if (unknown.length > 0) {
      throw new InputError(`unknown appliance id in critical_ids: ${unknown.join(', ')}`);
    }
    validatedCriticalIds = new Set(criticalIds);
  }
  if (appliances === undefined) {
    return {usableWh: uw, maxW: mw, overrides: {}, criticalIds: validatedCriticalIds};
  }
  if (!Array.isArray(appliances) || appliances.length === 0) {
    throw new InputError('appliances must be a non-empty list');
  }
  const overrides: Record<string, number> = {};
  for (const entry of appliances) {
    const {id, required_hours} = entry;
    if (!KNOWN_IDS.includes(id)) {
      throw new InputError(`unknown appliance id ${id}`);
    }
    if (id in overrides) {
      throw new InputError(`duplicate appliance id ${id}`);
    }
    if (!Number.isInteger(required_hours) || !(required_hours >= 0 && required_hours <= OUTAGE_HOURS)) {
      throw new InputError(`${id} required_hours must be an integer in 0..${OUTAGE_HOURS}`);
    }
    overrides[id] = required_hours;
  }
  return {usableWh: uw, maxW: mw, overrides, criticalIds: validatedCriticalIds};
}

function buildProblem(usableWh: number, maxW: number, overrides: Record<string, number>): Problem {
  const problem = fixture(OUTAGE_HOURS, usableWh, maxW);
  for (const appliance of problem.appliances) {
    if (appliance.id in overrides) {
      appliance.required_hours = overrides[appliance.id];
    }
  }
  return problem;
}

function explainInfeasibility(
  problem: Problem,
  result: SolveResult,
): [string, EnergyConflict] {
  const reason = result.reason;
  const conflict =
    reason === 'energy_lower_bound' || reason === 'power_or_window_conflict'
      ? energyConflict(problem)
      : null;
  if (reason === 'energy_lower_bound' && conflict !== null) {
    const shortfall = conflict.required_wh - conflict.budget_wh;
    return [
      `Running ${conflict.services.join(', ')} for their full requested ` +
        `hours needs ${conflict.required_wh} Wh, but only ` +
        `${conflict.budget_wh} Wh is available: a shortfall of ` +
        `${shortfall} Wh. That is the smallest set of services that alone ` +
        `breaks the battery budget.`,
      conflict,
    ];
  }
  if (reason === 'service_window') {
    const offenders = problem.appliances
      .filter(a => a.required_hours > new Set(a.allowed_hours).size)
      .map(a => a.id);
    return [
      `${offenders.join(', ') || 'one or more appliances'} need more hours ` +
        `than their allowed time window has available, regardless of battery ` +
        `size.`,
      null,
    ];
  }
  if (reason === 'power_or_window_conflict') {
    if (conflict !== null) {
      const shortfall = conflict.required_wh - conflict.budget_wh;
      return [
        `Even setting aside timing, running ${conflict.services.join(', ')} ` +
          `for their full requested hours needs ${conflict.required_wh} Wh ` +
          `against a ${conflict.budget_wh} Wh budget (short by ${shortfall} Wh).`,
        conflict,
      ];
    }
    return [
      "Appliances that must run at the same hour together draw more power " +
        "than the battery's output limit allows, even though total energy " +
        'over the outage would be sufficient.',
      null,
    ];
  }
  return ['This combination of requirements cannot be scheduled.', null];
}

function defaultRequiredHours(): Record<string, number> {
  const base = fixture(OUTAGE_HOURS, DEFAULT_USABLE_WH, DEFAULT_MAX_W);
  const map: Record<string, number> = {};
  for (const a of base.appliances) {
    map[a.id] = a.required_hours;
  }
  return map;
}

function alternativeSummary(
  tier: 'protects_essentials' | 'requires_compromise',
  changedIds: Set<string>,
  touchesCritical: string[],
  criticalIds: Set<string>,
  anyProtectsEssentials: boolean,
): string {
  const changes = [...changedIds].sort().join(', ');
  if (tier === 'requires_compromise') {
    const critical = [...touchesCritical].sort().join(' and ');
    if (anyProtectsEssentials) {
      // A protects_essentials alternative exists elsewhere in this same
      // plan's alternatives list, so "no fix was possible" would be false
      // here -- this repair only reaches a larger saving by also touching
      // a critical id, not the only way to fix the plan.
      return (
        `This repair also reduces ${critical}, usually protected by ` +
        `default. A separate alternative avoids touching ${critical} ` +
        `entirely. Reduces: ${changes}.`
      );
    }
    return (
      `No fix was possible without also reducing ${critical} -- usually ` +
      `protected by default. This repair reduces: ${changes}.`
    );
  }
  const kept = criticalIds.size > 0 ? [...criticalIds].sort().join(', ') : 'none selected';
  return `Keeps every essential service (${kept}) at its current hours. Reduces: ${changes}.`;
}

// criticalIds: which appliance ids this household currently marks as
// essential. Defaults to CRITICAL_IDS (fridge, router) when omitted, so
// every pre-existing caller keeps its exact original behavior -- Phase B
// (household-defined essentials) is the only caller that passes its own
// selection, and that selection genuinely drives findRepairs' search, not
// just this response's display fields.
export function buildPlan(
  usableWh: number,
  maxW: number,
  overrides: Record<string, number>,
  criticalIds: Set<string> = CRITICAL_IDS,
): Plan {
  const problem = buildProblem(usableWh, maxW, overrides);
  const result = solve(problem);
  let explanation: string | null = null;
  let conflict: EnergyConflict = null;
  if (!result.feasible) {
    [explanation, conflict] = explainInfeasibility(problem, result);
  }
  const verification = result.feasible ? check(problem, result.schedule) : null;
  const requestedWh = problem.appliances.reduce((s, a) => s + a.high_w * a.required_hours, 0);
  const defaultsById = defaultRequiredHours();
  const criticalReduced = [...criticalIds]
    .filter(aid => {
      const current = problem.appliances.find(a => a.id === aid)!.required_hours;
      return current < defaultsById[aid];
    })
    .sort();

  const requested = {
    problem,
    result,
    conflict,
    explanation,
    independent_verification: verification,
    requested_wh: requestedWh,
    critical_reduced: criticalReduced,
  };

  const repairs = result.feasible ? [] : findRepairs(problem, 2, criticalIds);
  const allIds = new Set(problem.appliances.map(a => a.id));
  const anyProtectsEssentials = repairs.some(r => r.tier === 'protects_essentials');
  const labels = ['A', 'B'];
  const alternatives = repairs.map((repair, i) => {
    const changedIds = new Set(repair.changed.map(c => c.id));
    return {
      id: labels[i],
      tier: repair.tier!,
      touches_critical: repair.touches_critical!,
      changed: repair.changed,
      stays_powered: [...allIds].filter(id => !changedIds.has(id)).sort(),
      label: repair.changed.map(c => `${c.id}: ${c.from_hours}h → ${c.to_hours}h`).join(', '),
      summary: alternativeSummary(
        repair.tier!,
        changedIds,
        repair.touches_critical!,
        criticalIds,
        anyProtectsEssentials,
      ),
      problem: repair.problem,
      result: repair.result,
      independent_verification: repair.independent_verification,
      hours_removed: repair.hours_removed,
    };
  });

  return {
    schema: 3,
    synthetic: true,
    instance: INSTANCE,
    nonce: randomHex(4),
    time_utc: new Date().toISOString(),
    title: "Tonight's outage plan",
    outage_hours: OUTAGE_HOURS,
    budget_wh: usableWh,
    max_w: maxW,
    critical_ids: [...criticalIds].sort(),
    limits:
      'Synthetic estimates. Hourly average loads. Startup surges, ' +
      'wiring and battery aging are not modeled. Not a guarantee.',
    requested,
    alternatives,
  };
}

export function defaultConfig(): Defaults {
  const problem = fixture(OUTAGE_HOURS, DEFAULT_USABLE_WH, DEFAULT_MAX_W);
  const appliances = problem.appliances.map(a => ({...a, critical: CRITICAL_IDS.has(a.id)}));
  return {
    instance: INSTANCE,
    nonce: randomHex(4),
    outage_hours: OUTAGE_HOURS,
    usable_wh: DEFAULT_USABLE_WH,
    max_w: DEFAULT_MAX_W,
    critical_ids: [...CRITICAL_IDS].sort(),
    appliances,
  };
}
