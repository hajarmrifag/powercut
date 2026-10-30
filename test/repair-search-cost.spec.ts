import {buildPlan} from '../src/engine/plan';
import {solve} from '../src/engine/solver';

jest.mock('../src/engine/solver', () => {
  const actual = jest.requireActual('../src/engine/solver');
  return {...actual, solve: jest.fn(actual.solve)};
});

const mockedSolve = solve as jest.MockedFunction<typeof solve>;

describe('repair-search execution budget', () => {
  beforeEach(() => {
    mockedSolve.mockClear();
  });

  it('keeps the deterministic forced-compromise path at 629 solver calls', () => {
    const plan = buildPlan(1300, 200, {
      fridge: 12,
      router: 12,
      lamp: 4,
      phone: 1,
      laptop: 3,
      fan: 4,
    });
    const repairs = plan.alternatives;

    expect(repairs).toHaveLength(1);
    expect(repairs[0].tier).toBe('requires_compromise');
    expect(repairs[0].changed).toEqual([{id: 'fridge', from_hours: 12, to_hours: 5}]);
    expect(mockedSolve).toHaveBeenCalledTimes(629);
  });
});
