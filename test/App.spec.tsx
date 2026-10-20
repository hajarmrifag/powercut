import 'react-native';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import * as api from '../src/api';
import defaultsFixture from './fixtures/defaults.json';
import feasibleFixture from './fixtures/plan-feasible.json';
import infeasibleFixture from './fixtures/plan-infeasible.json';

// src/api.ts now calls the in-process engine (src/engine/) instead of
// fetch()ing a Python backend -- see docs/ENGINE_PORT.md. These tests mock
// the api module's two exported functions directly (same fixtures as
// before, captured from real backend responses) rather than global.fetch,
// since there is no network call left to intercept. Call sequencing, the
// in-flight-press guard, and error-surfacing are still exercised exactly
// as before, just against the new call surface.
function mockPlanSequence(responses: Array<Record<string, unknown>>) {
  let call = 0;
  jest.spyOn(api, 'fetchPlan').mockImplementation(() => {
    const body = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve(body as any);
  });
}

beforeEach(() => {
  jest.spyOn(api, 'fetchDefaults').mockResolvedValue(defaultsFixture as any);
});

describe('App', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads defaults, fetches the live plan, and shows the overview as infeasible', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('status-badge')).toBeTruthy());
    expect(screen.getByText('INFEASIBLE')).toBeTruthy();
    expect(screen.getByTestId('tile-alternatives')).toBeTruthy();
  });

  it('every appliance tile is reachable and opens its own edit screen', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-laptop'));
    fireEvent.press(screen.getByTestId('tile-appliance-laptop'));
    expect(screen.getByTestId('screen-edit-appliance')).toBeTruthy();
    expect(screen.getByTestId('appliance-hours-value').props.children.join('')).toContain('3h');
  });

  it('pressing +1h on an appliance sends the updated requirement to the engine and reflects the new plan', async () => {
    mockPlanSequence([infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-fan'));
    fireEvent.press(screen.getByTestId('tile-appliance-fan'));
    await waitFor(() => screen.getByTestId('btn-hours-plus'));
    fireEvent.press(screen.getByTestId('btn-hours-plus'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));
    const lastCall = (api.fetchPlan as jest.Mock).mock.calls[1];
    const sentAppliances = lastCall[2] as Array<{id: string; required_hours: number}>;
    const fan = sentAppliances.find(a => a.id === 'fan');
    expect(fan!.required_hours).toBe(5); // fixture default fan=4, +1h => 5
  });

  it('turning an appliance off with the "Off" button sends required_hours 0', async () => {
    mockPlanSequence([infeasibleFixture, feasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-laptop'));
    fireEvent.press(screen.getByTestId('tile-appliance-laptop'));
    await waitFor(() => screen.getByTestId('btn-hours-zero'));
    fireEvent.press(screen.getByTestId('btn-hours-zero'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));
    const sentAppliances = (api.fetchPlan as jest.Mock).mock.calls[1][2] as Array<{
      id: string;
      required_hours: number;
    }>;
    const laptop = sentAppliances.find(a => a.id === 'laptop');
    expect(laptop!.required_hours).toBe(0);
  });

  it('navigates to alternatives, shows the conflict explanation and both verified repair cards', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByTestId('screen-alternatives')).toBeTruthy();
    expect(
      screen.getAllByText(new RegExp(infeasibleFixture.requested.conflict.services[0])).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('alt-card-A')).toBeTruthy();
    expect(screen.getByTestId('alt-card-B')).toBeTruthy();
    expect(screen.getAllByText('✓ Independently verified').length).toBe(2);
  });

  it('selecting an alternative applies it and the overview becomes feasible', async () => {
    mockPlanSequence([infeasibleFixture, feasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    await waitFor(() => screen.getByTestId('alt-card-A'));
    fireEvent.press(screen.getByTestId('alt-card-A'));
    await waitFor(() => expect(screen.getByTestId('screen-overview')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('FEASIBLE')).toBeTruthy());
  });

  it('shows "no automatic fix" honestly when the engine returns zero alternatives', async () => {
    const noRepairFixture = {
      ...infeasibleFixture,
      alternatives: [],
    };
    mockPlanSequence([noRepairFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByTestId('no-alternatives')).toBeTruthy();
  });

  it('battery screen adjusts usable_wh and max_w independently', async () => {
    mockPlanSequence([infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-battery'));
    fireEvent.press(screen.getByTestId('tile-battery'));
    await waitFor(() => screen.getByTestId('btn-wh-plus'));
    fireEvent.press(screen.getByTestId('btn-wh-plus'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));
    const lastCall = (api.fetchPlan as jest.Mock).mock.calls[1];
    expect(lastCall[0]).toBe(1900); // default 1800 + 100
    expect(lastCall[1]).toBe(200); // unchanged
  });

  it('shows a calculation error message when the initial load fails', async () => {
    jest.spyOn(api, 'fetchDefaults').mockRejectedValue(new Error('engine threw'));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Calculation error:/)).toBeTruthy());
  });

  // --- Priority 1: essential services are visibly marked ---

  it('marks fridge and router as essential and leaves the other four unmarked', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('badge-essential-fridge'));
    expect(screen.getByTestId('badge-essential-router')).toBeTruthy();
    expect(screen.queryByTestId('badge-essential-lamp')).toBeNull();
    expect(screen.queryByTestId('badge-essential-phone')).toBeNull();
    expect(screen.queryByTestId('badge-essential-laptop')).toBeNull();
    expect(screen.queryByTestId('badge-essential-fan')).toBeNull();
  });

  it("warns when the household's own edit has reduced an essential below full", async () => {
    const reducedFridgeFixture = {
      ...feasibleFixture,
      requested: {...feasibleFixture.requested, critical_reduced: ['fridge']},
    };
    mockPlanSequence([reducedFridgeFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('badge-essential-fridge'));
    expect(screen.getByTestId('badge-essential-fridge').props.children).toContain('⚠');
    expect(screen.getByTestId('badge-essential-router').props.children).toContain('✓');
  });

  // --- Priority 1/2: repair tiers are shown and explained in plain language ---

  it('shows the protects-essentials tier, stays-powered list and plain-language summary for each repair', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByTestId('alt-tier-A')).toBeTruthy();
    expect(screen.getAllByText('✓ Protects essentials').length).toBe(2);
    expect(screen.getAllByText(/Stays as requested:/).length).toBe(2);
    expect(screen.getAllByText(/Keeps every essential service/).length).toBe(2);
  });

  it('shows the requires-compromise tier distinctly when a repair touches an essential service', async () => {
    const compromiseFixture = {
      ...infeasibleFixture,
      alternatives: [
        {
          id: 'A',
          tier: 'requires_compromise',
          touches_critical: ['fridge'],
          changed: [{id: 'fridge', from_hours: 12, to_hours: 8}],
          stays_powered: ['router', 'lamp', 'phone', 'laptop', 'fan'],
          label: 'fridge: 12h → 8h',
          summary: 'No fix was possible without also reducing fridge. This repair reduces: fridge.',
          problem: infeasibleFixture.alternatives[0].problem,
          result: infeasibleFixture.alternatives[0].result,
          independent_verification: infeasibleFixture.alternatives[0].independent_verification,
          hours_removed: 4,
        },
      ],
    };
    mockPlanSequence([compromiseFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByText('⚠ Requires compromise')).toBeTruthy();
    expect(screen.getByText(/No fix was possible without also reducing fridge/)).toBeTruthy();
  });

  // --- Priority 3: reliability ---

  it('ignores a second press while a request is still in flight, instead of racing or dropping silently', async () => {
    let resolveSecond: (() => void) | null = null;
    let callCount = 0;
    jest.spyOn(api, 'fetchPlan').mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // initial /plan resolves immediately
        return Promise.resolve(infeasibleFixture as any);
      }
      // the first user-triggered call hangs until we release it
      return new Promise(resolve => {
        resolveSecond = () => resolve(infeasibleFixture as any);
      });
    });
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-fan'));
    fireEvent.press(screen.getByTestId('tile-appliance-fan'));
    await waitFor(() => screen.getByTestId('btn-hours-plus'));

    fireEvent.press(screen.getByTestId('btn-hours-plus')); // triggers the hanging 2nd call
    expect(callCount).toBe(2);
    fireEvent.press(screen.getByTestId('btn-hours-plus')); // must be ignored: still in flight
    fireEvent.press(screen.getByTestId('btn-hours-plus')); // also ignored
    expect(callCount).toBe(2); // no 3rd or 4th call was made while loading

    resolveSecond!();
    await waitFor(() => expect(screen.getByTestId('appliance-edit-status')).toBeTruthy());
    // now that the in-flight request resolved, a further press is accepted again
    fireEvent.press(screen.getByTestId('btn-hours-plus'));
    await waitFor(() => expect(callCount).toBe(3));
  });

  it('surfaces a recalculation error on the appliance edit screen itself, not only the overview', async () => {
    let shouldFail = false;
    jest.spyOn(api, 'fetchPlan').mockImplementation(() => {
      if (shouldFail) {
        return Promise.reject(new Error('mid-edit calculation failure'));
      }
      return Promise.resolve(infeasibleFixture as any);
    });
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-fan'));
    fireEvent.press(screen.getByTestId('tile-appliance-fan'));
    await waitFor(() => screen.getByTestId('btn-hours-plus'));
    shouldFail = true;
    fireEvent.press(screen.getByTestId('btn-hours-plus'));
    await waitFor(() => expect(screen.getByTestId('status-error')).toBeTruthy());
    expect(screen.getByTestId('status-error').props.children).toContain('mid-edit calculation failure');
  });

  // Note: hardware Back itself (useKeplerBackHandler) is inert under the
  // Kepler Jest preset's own mock (addEventListener records a callback but
  // never invokes it), so the Back -> focus-restoration path cannot be
  // meaningfully exercised here -- it is verified on the real Vega Virtual
  // Device instead (see evidence/screenshots/phase3/).

  // --- Phase B: household-defined essentials ---

  it('fridge and router start essential, and an edit screen shows an unmarked appliance as not essential', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('badge-essential-fridge'));
    expect(screen.getByTestId('badge-essential-router')).toBeTruthy();
    expect(screen.queryByTestId('badge-essential-lamp')).toBeNull();

    fireEvent.press(screen.getByTestId('tile-appliance-lamp'));
    await waitFor(() => screen.getByTestId('btn-toggle-essential'));
    expect(screen.getByText('Mark as essential')).toBeTruthy();
    expect(
      screen.getByText('Not marked essential: the automatic repair search may reduce it freely to make a plan fit.'),
    ).toBeTruthy();
  });

  it('marking an appliance essential sends the updated critical_ids to the engine and updates the badge', async () => {
    mockPlanSequence([infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-lamp'));
    fireEvent.press(screen.getByTestId('tile-appliance-lamp'));
    await waitFor(() => screen.getByTestId('btn-toggle-essential'));
    fireEvent.press(screen.getByTestId('btn-toggle-essential'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));
    const sentCriticalIds = (api.fetchPlan as jest.Mock).mock.calls[1][3] as string[];
    expect(new Set(sentCriticalIds)).toEqual(new Set(['fridge', 'router', 'lamp']));
    expect(screen.getByText('Unmark as essential')).toBeTruthy();

    fireEvent.press(screen.getByTestId('btn-toggle-essential'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(3));
    const sentAfterUnmark = (api.fetchPlan as jest.Mock).mock.calls[2][3] as string[];
    expect(new Set(sentAfterUnmark)).toEqual(new Set(['fridge', 'router']));
  });

  it('the alternatives screen offers and correctly explains a fridge-reducing repair once fridge is not essential', async () => {
    // Simulates the plan the engine returns once a household has unmarked
    // fridge (critical_ids now just {router}) and the plan is infeasible --
    // a repair that reduces fridge is only ever protects_essentials, never
    // offered at all under the default {fridge, router} criticality, so
    // this is standing in for "the recommended alternatives change" that's
    // also verified end-to-end on the real device (see docs/PHASE_B.md).
    const fridgeFlexibleFixture = {
      ...infeasibleFixture,
      critical_ids: ['router'],
      alternatives: [
        {
          id: 'A',
          tier: 'protects_essentials',
          touches_critical: [],
          changed: [{id: 'fridge', from_hours: 12, to_hours: 1}],
          stays_powered: ['router', 'lamp', 'phone', 'laptop', 'fan'],
          label: 'fridge: 12h → 1h',
          summary: 'Keeps every essential service (router) at its current hours. Reduces: fridge.',
          problem: infeasibleFixture.alternatives[0].problem,
          result: infeasibleFixture.alternatives[0].result,
          independent_verification: infeasibleFixture.alternatives[0].independent_verification,
          hours_removed: 11,
        },
      ],
    };
    mockPlanSequence([fridgeFlexibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByText('✓ Protects essentials')).toBeTruthy();
    expect(screen.getByText('Reduces: fridge: 12h → 1h')).toBeTruthy();
    expect(screen.getByText(/Keeps every essential service \(router\)/)).toBeTruthy();
    // A "protects_essentials" tag means it protects whatever the household
    // *currently* has marked essential (router, here) -- it must not read
    // as a food-safety endorsement for the fridge hours it reduces.
    expect(screen.getByTestId('alt-safety-caution-A')).toBeTruthy();
    expect(screen.getByText(/not a guarantee of food safety/)).toBeTruthy();
  });

  it('shows no safety caution on a repair that leaves fridge and router untouched', async () => {
    mockPlanSequence([infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    // The default fixture's repairs reduce laptop/fan, never fridge/router.
    expect(screen.queryByTestId('alt-safety-caution-A')).toBeNull();
    expect(screen.queryByTestId('alt-safety-caution-B')).toBeNull();
  });

  it('unmarking fridge as essential shows a food-safety caution distinct from the generic toggle copy', async () => {
    mockPlanSequence([infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-fridge'));
    fireEvent.press(screen.getByTestId('tile-appliance-fridge'));
    await waitFor(() => screen.getByTestId('btn-toggle-essential'));
    // Marked (default): food-safety rationale, not the generic copy.
    expect(screen.getByText(/Marked essential: protects food safety/)).toBeTruthy();
    expect(screen.queryByTestId('safety-caution-edit')).toBeNull();

    fireEvent.press(screen.getByTestId('btn-toggle-essential'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('safety-caution-edit')).toBeTruthy();
    expect(
      screen.getByText(/not a guarantee that food stays safely cold/),
    ).toBeTruthy();
  });

  it('unmarking an appliance after marking it restores exactly the original essentials set', async () => {
    mockPlanSequence([infeasibleFixture, infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-lamp'));
    fireEvent.press(screen.getByTestId('tile-appliance-lamp'));
    await waitFor(() => screen.getByTestId('btn-toggle-essential'));
    fireEvent.press(screen.getByTestId('btn-toggle-essential'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(2));

    fireEvent.press(screen.getByTestId('btn-toggle-essential'));
    await waitFor(() => expect(api.fetchPlan).toHaveBeenCalledTimes(3));
    const sentAfterUnmark = (api.fetchPlan as jest.Mock).mock.calls[2][3] as string[];
    expect(new Set(sentAfterUnmark)).toEqual(new Set(['fridge', 'router']));
  });
});
