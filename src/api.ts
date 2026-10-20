// Runs the plan engine in-process (src/engine/) instead of calling a
// Python backend over HTTP. Same exported signatures as the old fetch()
// implementation, so App.tsx needed no changes for this swap.
//
// Each call is deferred one macrotask (setTimeout 0) before running. That
// only guarantees the *triggering* frame (the D-pad press's own focus-ring/
// stepper-highlight update) gets to commit before the calculation starts.
// It is not a guarantee the calculation itself is fast, and it does NOT
// prevent the JS thread from blocking once the deferred call is running.
// Measured on-device, most calls finish in well under one frame, but the
// worst case (a repair search forced through both essentials-protecting
// and compromise tiers) measured ~2 seconds and blocks the thread for that
// whole span, see docs/ENGINE_BENCHMARKS.md. The UI's existing "Saving…"
// indicator (src/App.tsx) is what actually covers that case, not this
// deferral.
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
  criticalIds: string[],
): Promise<Plan> {
  return deferred(() => {
    const {
      usableWh: uw,
      maxW: mw,
      overrides,
      criticalIds: validatedCriticalIds,
    } = validateRequest(usableWh, maxW, appliances, criticalIds);
    return buildPlan(uw, mw, overrides, validatedCriticalIds);
  });
}
