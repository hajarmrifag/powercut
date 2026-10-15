"""PowerCut product backend.

Serves the household backup-power plan over local HTTP for the Vega app.
Uses the constraint solver, independent verifier, and dynamic repair search
vendored in engine/ (unchanged copies of the feasibility-tested originals,
plus repairs.py built on top of them) instead of reimplementing any of it.

GET /defaults returns the static appliance roster (ids, power ranges, allowed
hours) and default battery parameters, so the frontend can build its editable
UI without duplicating that data. POST /plan takes the household's current
edited state (per-appliance required_hours, battery usable_wh/max_w) and
recomputes everything live: feasibility, a plain-English conflict
explanation when infeasible, and up to two independently-verified repair
alternatives. Nothing is cached — every response reflects an actual solve()
call made at request time (nonce + instance id prove it is not a canned
frontend value), and every alternative is re-checked with verifier.check
before being returned.
"""
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from secrets import token_hex
import sys

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT / 'engine'))
from run_experiment import fixture  # noqa: E402
from solver import solve, energy_conflict  # noqa: E402
from verifier import check  # noqa: E402
from repairs import CRITICAL_IDS, find_repairs  # noqa: E402

INSTANCE = token_hex(6)
PORT = 8766

OUTAGE_HOURS = 12
DEFAULT_USABLE_WH = 1800
DEFAULT_MAX_W = 200
KNOWN_IDS = ('fridge', 'router', 'lamp', 'phone', 'laptop', 'fan')


class InputError(ValueError):
    pass


def validate_request(data):
    if not isinstance(data, dict) or set(data) - {'usable_wh', 'max_w', 'appliances'}:
        raise InputError('unexpected fields')
    usable_wh = data.get('usable_wh', DEFAULT_USABLE_WH)
    max_w = data.get('max_w', DEFAULT_MAX_W)
    if type(usable_wh) is not int or not 100 <= usable_wh <= 10000:
        raise InputError('usable_wh must be an integer in 100..10000')
    if type(max_w) is not int or not 50 <= max_w <= 2000:
        raise InputError('max_w must be an integer in 50..2000')
    appliances = data.get('appliances')
    if appliances is None:
        return usable_wh, max_w, {}
    if not isinstance(appliances, list) or len(appliances) == 0:
        raise InputError('appliances must be a non-empty list')
    overrides = {}
    for entry in appliances:
        if not isinstance(entry, dict) or set(entry) != {'id', 'required_hours'}:
            raise InputError('each appliance entry needs exactly id and required_hours')
        aid = entry['id']
        hours = entry['required_hours']
        if aid not in KNOWN_IDS:
            raise InputError(f'unknown appliance id {aid!r}')
        if aid in overrides:
            raise InputError(f'duplicate appliance id {aid!r}')
        if type(hours) is not int or not 0 <= hours <= OUTAGE_HOURS:
            raise InputError(f'{aid} required_hours must be an integer in 0..{OUTAGE_HOURS}')
        overrides[aid] = hours
    return usable_wh, max_w, overrides


def build_problem(usable_wh, max_w, overrides):
    problem = fixture(OUTAGE_HOURS, usable_wh, max_w)
    for appliance in problem['appliances']:
        if appliance['id'] in overrides:
            appliance['required_hours'] = overrides[appliance['id']]
    return problem


def explain_infeasibility(problem, result):
    reason = result.get('reason')
    conflict = energy_conflict(problem) if reason in ('energy_lower_bound', 'power_or_window_conflict') else None
    if reason == 'energy_lower_bound' and conflict is not None:
        shortfall = conflict['required_wh'] - conflict['budget_wh']
        return (
            f"Running {', '.join(conflict['services'])} for their full requested "
            f"hours needs {conflict['required_wh']} Wh, but only "
            f"{conflict['budget_wh']} Wh is available — a shortfall of "
            f"{shortfall} Wh. That is the smallest set of services that alone "
            f"breaks the battery budget."
        ), conflict
    if reason == 'service_window':
        offenders = [a['id'] for a in problem['appliances']
                     if a['required_hours'] > len(set(a['allowed_hours']))]
        return (
            f"{', '.join(offenders) or 'one or more appliances'} need more hours "
            f"than their allowed time window has available, regardless of battery "
            f"size."
        ), None
    if reason == 'power_or_window_conflict':
        if conflict is not None:
            shortfall = conflict['required_wh'] - conflict['budget_wh']
            return (
                f"Even setting aside timing, running {', '.join(conflict['services'])} "
                f"for their full requested hours needs {conflict['required_wh']} Wh "
                f"against a {conflict['budget_wh']} Wh budget (short by {shortfall} Wh)."
            ), conflict
        return (
            "Appliances that must run at the same hour together draw more power "
            "than the battery's output limit allows, even though total energy "
            "over the outage would be sufficient."
        ), None
    return 'This combination of requirements cannot be scheduled.', None


def _default_required_hours():
    """The full-service required_hours for each appliance in the unedited
    default scenario, used only to tell whether a *currently requested*
    critical appliance has already been knowingly reduced by the household
    -- never to judge a repair, which always compares against the user's
    own current request, not this fixed baseline."""
    base = fixture(OUTAGE_HOURS, DEFAULT_USABLE_WH, DEFAULT_MAX_W)
    return {a['id']: a['required_hours'] for a in base['appliances']}


def _alternative_summary(tier, changed_ids, touches_critical):
    changes = ', '.join(sorted(changed_ids))
    if tier == 'requires_compromise':
        critical = ' and '.join(sorted(touches_critical))
        return (f"No fix was possible without also reducing {critical} -- usually "
                f"protected by default. This repair reduces: {changes}.")
    return f"Keeps every essential service (fridge, router) at its current hours. Reduces: {changes}."


def build_plan(usable_wh, max_w, overrides):
    problem = build_problem(usable_wh, max_w, overrides)
    result = solve(problem)
    if result['feasible']:
        explanation, conflict = None, None
    else:
        explanation, conflict = explain_infeasibility(problem, result)
    verification = check(problem, result['schedule']) if result['feasible'] else None
    requested_wh = sum(a['high_w'] * a['required_hours'] for a in problem['appliances'])
    defaults_by_id = _default_required_hours()
    critical_reduced = sorted(
        aid for aid in CRITICAL_IDS
        if next(a['required_hours'] for a in problem['appliances'] if a['id'] == aid)
        < defaults_by_id[aid]
    )
    requested = {'problem': problem, 'result': result, 'conflict': conflict,
                 'explanation': explanation, 'independent_verification': verification,
                 'requested_wh': requested_wh, 'critical_reduced': critical_reduced}
    repairs = [] if result['feasible'] else find_repairs(problem, max_results=2)
    all_ids = {a['id'] for a in problem['appliances']}
    alternatives = []
    for label, repair in zip('AB', repairs):
        changed_ids = {c['id'] for c in repair['changed']}
        alternatives.append({
            'id': label,
            'tier': repair['tier'],
            'touches_critical': repair['touches_critical'],
            'changed': repair['changed'],
            'stays_powered': sorted(all_ids - changed_ids),
            'label': ', '.join(
                f"{c['id']}: {c['from_hours']}h → {c['to_hours']}h" for c in repair['changed']),
            'summary': _alternative_summary(repair['tier'], changed_ids, repair['touches_critical']),
            'problem': repair['problem'],
            'result': repair['result'],
            'independent_verification': repair['independent_verification'],
            'hours_removed': repair['hours_removed'],
        })
    return {
        'schema': 3, 'synthetic': True, 'instance': INSTANCE,
        'nonce': token_hex(4), 'time_utc': datetime.now(timezone.utc).isoformat(),
        'title': "Tonight's outage plan",
        'outage_hours': OUTAGE_HOURS, 'budget_wh': usable_wh, 'max_w': max_w,
        'critical_ids': sorted(CRITICAL_IDS),
        'limits': ('Synthetic estimates. Hourly average loads. Startup surges, '
                   'wiring and battery aging are not modeled. Not a guarantee.'),
        'requested': requested,
        'alternatives': alternatives,
    }


def default_config():
    problem = fixture(OUTAGE_HOURS, DEFAULT_USABLE_WH, DEFAULT_MAX_W)
    appliances = [{**a, 'critical': a['id'] in CRITICAL_IDS} for a in problem['appliances']]
    return {
        'outage_hours': OUTAGE_HOURS,
        'usable_wh': DEFAULT_USABLE_WH,
        'max_w': DEFAULT_MAX_W,
        'critical_ids': sorted(CRITICAL_IDS),
        'appliances': appliances,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)
        with (APP_ROOT / 'backend' / 'requests.jsonl').open('a') as f:
            f.write(json.dumps({
                'time_utc': datetime.now(timezone.utc).isoformat(),
                'method': self.command, 'path': self.path, 'status': status,
                'instance': INSTANCE, 'nonce': data.get('nonce'),
            }) + '\n')

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'status': 'ok', 'synthetic': True, 'instance': INSTANCE,
                              'nonce': token_hex(4),
                              'time_utc': datetime.now(timezone.utc).isoformat()})
        elif self.path == '/defaults':
            self.reply(200, {'instance': INSTANCE, 'nonce': token_hex(4), **default_config()})
        else:
            self.reply(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/plan':
            return self.reply(404, {'error': 'not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096:
                return self.reply(413, {'error': 'body must be 1..4096 bytes'})
            data = json.loads(self.rfile.read(size))
            usable_wh, max_w, overrides = validate_request(data)
            self.reply(200, build_plan(usable_wh, max_w, overrides))
        except (InputError, ValueError, TypeError, KeyError, json.JSONDecodeError) as e:
            self.reply(422, {'error': str(e)})
        except Exception as e:  # noqa: BLE001 - surface to the app as JSON
            self.reply(500, {'error': str(e)})


if __name__ == '__main__':
    print(json.dumps({'listen': f'http://127.0.0.1:{PORT}', 'instance': INSTANCE}), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
