// Runs the plan engine in-process (src/engine/) instead of calling a
// Python backend over HTTP. Same exported signatures as the old fetch()
// implementation, so App.tsx needed no changes for this swap.
//
// Each call is deferred one macrotask (setTimeout 0) before running, so a
// calculation never runs synchronously inside the same frame as the D-pad
// press that triggered it — the press's own visual feedback (focus ring,
// stepper highlight) gets to commit first. See docs/ENGINE_BENCHMARKS.md
// for on-device timings showing the deferral is a safety margin, not a
// necessity: every measured call, including worst-case repair search,
// completes in well under one frame.
import type {ApplianceRequirement, Defaults, Plan} from './types';
import {buildPlan, defaultConfig, validateRequest} from './engine';

function deferred<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  });
}

export function fetchDefaults(): Promise<Defaults> {
  return deferred(() => defaultConfig());
}

export function fetchPlan(
  usableWh: number,
  maxW: number,
  appliances: ApplianceRequirement[],
): Promise<Plan> {
  return deferred(() => {
    const {usableWh: uw, maxW: mw, overrides} = validateRequest(usableWh, maxW, appliances);
    return buildPlan(uw, mw, overrides);
  });
}
