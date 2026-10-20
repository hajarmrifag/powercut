// Ported from engine/run_experiment.py's fixture(), the six-appliance
// roster definition. Appliance order and ids must stay exactly in sync
// with the Python original: combinations()-order-dependent code
// (energyConflict) and every captured fixture/screenshot assume this order.
import type {Problem} from '../types';

type Profile = [id: string, low: number, high: number, required: number, window: number[]];

function range(n: number): number[] {
  return Array.from({length: n}, (_, i) => i);
}

export function fixture(hours: number, usableWh = 1800, maxW = 200): Problem {
  const profiles: Profile[] = [
    ['fridge', 60, 90, hours, range(hours)],
    ['router', 20, 30, hours, range(hours)],
    ['lamp', 8, 12, Math.min(4, hours), range(Math.min(4, hours))],
    ['phone', 15, 25, 1, range(Math.min(3, hours))],
    ['laptop', 45, 65, Math.min(3, hours), range(Math.min(6, hours))],
    ['fan', 30, 50, Math.min(4, hours), range(hours)],
  ];
  return {
    synthetic: true,
    hours,
    usable_wh: usableWh,
    max_w: maxW,
    assumptions: [
      'one-hour bins',
      'constant bounded effective watts',
      'fridge is averaged duty load',
      'no charging, solar, wiring validation or startup surge model',
      'usable Wh already accounts for reserve and conversion loss',
    ],
    appliances: profiles.map(([id, low_w, high_w, required_hours, allowed_hours]) => ({
      id,
      low_w,
      high_w,
      required_hours,
      allowed_hours,
    })),
  };
}
