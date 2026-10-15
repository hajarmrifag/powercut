export type Appliance = {
  id: string;
  low_w: number;
  high_w: number;
  required_hours: number;
  allowed_hours: number[];
};

export type Problem = {
  hours: number;
  usable_wh: number;
  max_w: number;
  appliances: Appliance[];
};

export type SolveResult = {
  feasible: boolean;
  reason?: string;
  required_wh?: number;
  budget_wh?: number;
  schedule?: string[][];
  energy_wh?: number;
  remaining_wh?: number;
  peak_w?: number;
};

export type EnergyConflict = {
  services: string[];
  required_wh: number;
  budget_wh: number;
  cardinality: number;
  scope: string;
} | null;

export type ScheduleRow = {
  hour: number;
  loads: string[];
  watts: number;
  remaining_wh: number;
};

export type Verification = {
  valid: boolean;
  errors: string[];
  energy_wh: number;
  remaining_wh: number;
  peak_w: number;
  service_hours: Record<string, number>;
  hourly: ScheduleRow[];
} | null;

export type Requested = {
  problem: Problem;
  result: SolveResult;
  conflict: EnergyConflict;
  explanation: string | null;
  independent_verification: Verification;
  requested_wh: number;
};

export type ChangedAppliance = {id: string; from_hours: number; to_hours: number};

export type Alternative = {
  id: string;
  changed: ChangedAppliance[];
  label: string;
  problem: Problem;
  result: SolveResult;
  independent_verification: Verification;
  hours_removed: number;
};

export type Plan = {
  schema: number;
  synthetic: boolean;
  instance: string;
  nonce: string;
  time_utc: string;
  title: string;
  outage_hours: number;
  budget_wh: number;
  max_w: number;
  limits: string;
  requested: Requested;
  alternatives: Alternative[];
};

export type Defaults = {
  instance: string;
  nonce: string;
  outage_hours: number;
  usable_wh: number;
  max_w: number;
  appliances: Appliance[];
};

export type ApplianceRequirement = {id: string; required_hours: number};
