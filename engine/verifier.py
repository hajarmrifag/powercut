"""Separate schedule checker and brute-force oracle. Does not import solver."""
from itertools import product


def check(problem, schedule, bound='high_w'):
    errors = []
    if len(schedule) != problem['hours']:
        return {'valid': False, 'errors': ['wrong horizon']}
    counts = {a['id']: 0 for a in problem['appliances']}
    registry = {a['id']: a for a in problem['appliances']}
    battery = problem['usable_wh']
    peak = 0
    rows = []
    for t, names in enumerate(schedule):
        if len(names) != len(set(names)):
            errors.append(f'duplicate load at hour {t}')
        load = 0
        for name in names:
            if name not in registry:
                errors.append(f'unknown load {name}')
                continue
            a = registry[name]
            counts[name] += 1
            load += a[bound]
            if t not in a['allowed_hours']:
                errors.append(f'{name} outside window at {t}')
        battery -= load
        peak = max(peak, load)
        if load > problem['max_w']:
            errors.append(f'output limit exceeded at {t}')
        if battery < 0:
            errors.append(f'energy depleted at {t}')
        rows.append({'hour': t, 'loads': names, 'watts': load, 'remaining_wh': battery})
    for a in problem['appliances']:
        if counts[a['id']] < a['required_hours']:
            errors.append(f"service not met: {a['id']}")
    return {'valid': not errors, 'errors': errors, 'energy_wh': problem['usable_wh']-battery,
            'remaining_wh': battery, 'peak_w': peak, 'service_hours': counts, 'hourly': rows}


def exhaustive_oracle(problem):
    """Enumerates entire hourly action products for short horizons only."""
    options = []
    items = problem['appliances']
    for t in range(problem['hours']):
        choices = []
        for mask in range(64):
            ids = [a['id'] for i,a in enumerate(items) if mask & (1 << i)]
            if any(t not in a['allowed_hours'] for i,a in enumerate(items) if mask & (1 << i)):
                continue
            if any(a['required_hours'] == problem['hours'] and a['id'] not in ids for a in items):
                continue
            if sum(a['high_w'] for a in items if a['id'] in ids) > problem['max_w']:
                continue
            choices.append(ids)
        options.append(choices)
    best = None
    for schedule in product(*options):
        # Independent direct arithmetic rather than calling check() or solve().
        counts = {a['id']: sum(a['id'] in row for row in schedule) for a in items}
        if any(counts[a['id']] != a['required_hours'] for a in items):
            continue
        powers = [sum(a['high_w'] for a in items if a['id'] in row) for row in schedule]
        if sum(powers) > problem['usable_wh']:
            continue
        peak = max(powers, default=0)
        if best is None or peak < best:
            best = peak
    return {'feasible': best is not None, 'optimal_peak_w': best}
