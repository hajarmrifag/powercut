import 'react-native';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import planFixture from './fixtures/plan.json';

describe('App', () => {
  beforeEach(() => {
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(planFixture),
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the live plan and shows the requested scenario is infeasible', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/requested plan is INFEASIBLE/)).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/plan'),
      expect.anything(),
    );
  });

  it('navigates to the requested-plan detail and shows the conflict explanation', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-requested'));
    fireEvent.press(screen.getByTestId('tile-requested'));
    expect(screen.getByTestId('screen-requested')).toBeTruthy();
    expect(
      screen.getAllByText(new RegExp(planFixture.requested.conflict.services[0])).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/shortfall/)).toBeTruthy();
  });

  it('navigates to alternative A and shows it passed independent verification', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alt-a'));
    fireEvent.press(screen.getByTestId('tile-alt-a'));
    expect(screen.getByTestId('screen-alt-a')).toBeTruthy();
    expect(screen.getByText(/Independently verified: PASS/)).toBeTruthy();
  });

  it('navigates to alternative B and shows it passed independent verification', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('tile-alt-b'));
    fireEvent.press(screen.getByTestId('tile-alt-b'));
    expect(screen.getByTestId('screen-alt-b')).toBeTruthy();
    expect(screen.getByText(/Independently verified: PASS/)).toBeTruthy();
  });

  it('shows a backend error message when the fetch fails', async () => {
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('network down')));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Backend error:/)).toBeTruthy());
  });
});
