import 'react-native';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import defaultsFixture from './fixtures/defaults.json';
import feasibleFixture from './fixtures/plan-feasible.json';
import infeasibleFixture from './fixtures/plan-infeasible.json';

function mockFetchSequence(responses: Array<Record<string, unknown>>) {
  let call = 0;
  (globalThis as any).fetch = jest.fn(() => {
    const body = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ok: true, json: () => Promise.resolve(body)});
  });
}

describe('App', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads defaults, fetches the live plan, and shows the overview as infeasible', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('status-badge')).toBeTruthy());
    expect(screen.getByText('INFEASIBLE')).toBeTruthy();
    expect(screen.getByTestId('tile-alternatives')).toBeTruthy();
  });

  it('every appliance tile is reachable and opens its own edit screen', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-laptop'));
    fireEvent.press(screen.getByTestId('tile-appliance-laptop'));
    expect(screen.getByTestId('screen-edit-appliance')).toBeTruthy();
    expect(screen.getByTestId('appliance-hours-value').props.children.join('')).toContain('3h');
  });

  it('pressing +1h on an appliance sends the updated requirement to the backend and reflects the new plan', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-fan'));
    fireEvent.press(screen.getByTestId('tile-appliance-fan'));
    await waitFor(() => screen.getByTestId('btn-hours-plus'));
    fireEvent.press(screen.getByTestId('btn-hours-plus'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const lastCall = (fetch as jest.Mock).mock.calls[2];
    expect(lastCall[0]).toContain('/plan');
    const sentBody = JSON.parse(lastCall[1].body);
    const fan = sentBody.appliances.find((a: {id: string}) => a.id === 'fan');
    expect(fan.required_hours).toBe(5); // fixture default fan=4, +1h => 5
  });

  it('turning an appliance off with the "Off" button sends required_hours 0', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture, feasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-appliance-laptop'));
    fireEvent.press(screen.getByTestId('tile-appliance-laptop'));
    await waitFor(() => screen.getByTestId('btn-hours-zero'));
    fireEvent.press(screen.getByTestId('btn-hours-zero'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const sentBody = JSON.parse((fetch as jest.Mock).mock.calls[2][1].body);
    const laptop = sentBody.appliances.find((a: {id: string}) => a.id === 'laptop');
    expect(laptop.required_hours).toBe(0);
  });

  it('navigates to alternatives, shows the conflict explanation and both verified repair cards', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture]);
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
    mockFetchSequence([defaultsFixture, infeasibleFixture, feasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    await waitFor(() => screen.getByTestId('alt-card-A'));
    fireEvent.press(screen.getByTestId('alt-card-A'));
    await waitFor(() => expect(screen.getByTestId('screen-overview')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('FEASIBLE')).toBeTruthy());
  });

  it('shows "no automatic fix" honestly when the backend returns zero alternatives', async () => {
    const noRepairFixture = {
      ...infeasibleFixture,
      alternatives: [],
    };
    mockFetchSequence([defaultsFixture, noRepairFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alternatives'));
    fireEvent.press(screen.getByTestId('tile-alternatives'));
    expect(screen.getByTestId('no-alternatives')).toBeTruthy();
  });

  it('battery screen adjusts usable_wh and max_w independently', async () => {
    mockFetchSequence([defaultsFixture, infeasibleFixture, infeasibleFixture]);
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-battery'));
    fireEvent.press(screen.getByTestId('tile-battery'));
    await waitFor(() => screen.getByTestId('btn-wh-plus'));
    fireEvent.press(screen.getByTestId('btn-wh-plus'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const sentBody = JSON.parse((fetch as jest.Mock).mock.calls[2][1].body);
    expect(sentBody.usable_wh).toBe(1900); // default 1800 + 100
    expect(sentBody.max_w).toBe(200); // unchanged
  });

  it('shows a backend error message when the initial fetch fails', async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('network down')));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Backend error:/)).toBeTruthy());
  });
});
