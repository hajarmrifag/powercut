"""Isolated feasibility prototype. Synthetic hourly loads, no GridFlex imports."""
from itertools import combinations
from time import perf_counter


def validate(problem):
    h = problem['hours']
    if type(h) is not int or not 1 <= h <= 24:
        raise ValueError('hours must be an integer in 1..24')
    for key in ['usable_wh', 'max_w']:
        if type(problem[key]) is not int or problem[key] <= 0:
            raise ValueError(f'{key} must be a positive integer')
    ids = set()
    if len(problem['appliances']) != 6:
        raise ValueError('this experiment requires six appliances')
    for a in problem['appliances']:
        if a['id'] in ids:
            raise ValueError('duplicate appliance id')
        ids.add(a['id'])
        if not (0 <= a['low_w'] <= a['high_w']) or any(type(a[k]) is not int for k in ['low_w', 'high_w', 'required_hours']):
            raise ValueError('invalid appliance bounds')
        if not 0 <= a['required_hours'] <= h:
            raise ValueError('invalid service requirement')
        if any(type(t) is not int or not 0 <= t < h for t in a['allowed_hours']):
            raise ValueError('invalid window')


def solve(problem, bound='high_w'):
    validate(problem)
    if bound not in ('low_w', 'high_w'):
        raise ValueError('unknown power bound')
    started = perf_counter()
    appliances = problem['appliances']
    targets = tuple(a['required_hours'] for a in appliances)
    lower_energy = sum(a[bound] * a['required_hours'] for a in appliances)
    if lower_energy > problem['usable_wh']:
        return {'feasible': False, 'reason': 'energy_lower_bound', 'required_wh': lower_energy,
                'budget_wh': problem['usable_wh'], 'elapsed_ms': (perf_counter()-started)*1000}
    if any(a['required_hours'] > len(set(a['allowed_hours'])) for a in appliances):
        return {'feasible': False, 'reason': 'service_window', 'elapsed_ms': (perf_counter()-started)*1000}
    # For constant per-appliance power, energy is fixed by counts at a given time.
    # Retaining the path with the smallest peak per count state is exact.
    states = {(0,) * len(appliances): (0, [])}
    visited = 0
    for hour in range(problem['hours']):
        next_states = {}
        for counts, (peak, path) in states.items():
            mandatory = [i for i,a in enumerate(appliances)
                         if hour in a['allowed_hours'] and counts[i] < targets[i]
                         and sum(t >= hour for t in set(a['allowed_hours'])) == targets[i]-counts[i]]
            available = [i for i,a in enumerate(appliances)
                         if hour in a['allowed_hours'] and counts[i] < targets[i] and i not in mandatory]
            for bits in range(1 << len(available)):
                selected = mandatory + [i for j,i in enumerate(available) if bits & (1 << j)]
                if any(hour not in appliances[i]['allowed_hours'] for i in selected):
                    continue
                watts = sum(appliances[i][bound] for i in selected)
                if watts > problem['max_w']:
                    continue
                new_counts = tuple(c + int(i in selected) for i,c in enumerate(counts))
                if any(targets[i]-c > sum(t > hour for t in set(a['allowed_hours'])) for i,(c,a) in enumerate(zip(new_counts,appliances))):
                    continue
                energy = sum(c * a[bound] for c,a in zip(new_counts,appliances))
                if energy > problem['usable_wh']:
                    continue
                candidate_peak = max(peak, watts)
                old = next_states.get(new_counts)
                if old is None or candidate_peak < old[0]:
                    next_states[new_counts] = (candidate_peak, path + [[appliances[i]['id'] for i in selected]])
                visited += 1
        states = next_states
        if not states:
            break
    result = states.get(targets)
    if result is None:
        return {'feasible': False, 'reason': 'power_or_window_conflict', 'states_visited': visited,
                'elapsed_ms': (perf_counter()-started)*1000}
    peak, schedule = result
    return {'feasible': True, 'schedule': schedule, 'energy_wh': lower_energy,
            'remaining_wh': problem['usable_wh']-lower_energy, 'peak_w': peak,
            'bound': bound, 'states_visited': visited, 'elapsed_ms': (perf_counter()-started)*1000}


def energy_conflict(problem):
    """Minimum-cardinality conflicting service set, with battery budget fixed.

    This is an energy conflict only. It does not claim a complete unsat core.
    """
    appliances = problem['appliances']
    for size in range(1, len(appliances)+1):
        for subset in combinations(appliances,size):
            energy = sum(a['high_w']*a['required_hours'] for a in subset)
            if energy > problem['usable_wh']:
                return {'services': [a['id'] for a in subset], 'required_wh': energy,
                        'budget_wh': problem['usable_wh'], 'cardinality': size,
                        'scope': 'constant upper-bound energy with fixed usable battery'}
    return None
