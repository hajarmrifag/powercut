"""PowerCut product backend.

Serves the household backup-power plan over local HTTP for the Vega app.
Uses the constraint solver and independent verifier vendored in engine/
(solver.py, verifier.py, run_experiment.py — unchanged copies of the
feasibility-tested originals) instead of reimplementing them. Every request
recomputes the plan live (nonce + instance id prove the response is not a
canned frontend value) and every feasible alternative is independently
re-checked with verifier.check before being returned.
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

INSTANCE = token_hex(6)
PORT = 8766

OUTAGE_HOURS = 12
BUDGET_WH = 1800
MAX_W = 200

# The two repair options surfaced to the household. Both are proven feasible
# and Pareto-optimal by prototype/search_repairs.py (fan=1/laptop=3 and
# fan=4/laptop=1); a third option exists (fan=3/laptop=2) but two alternatives
# is what the product asks the household to choose between.
ALTERNATIVES = [
    {'id': 'A', 'fan_hours': 1, 'laptop_hours': 3,
     'label': 'Keep the laptop charged, cut the fan to 1 hour'},
    {'id': 'B', 'fan_hours': 4, 'laptop_hours': 1,
     'label': 'Keep the fan running, cut the laptop to 1 hour'},
]


def build_requested():
    problem = fixture(OUTAGE_HOURS, BUDGET_WH, MAX_W)
    result = solve(problem)
    conflict = energy_conflict(problem)
    explanation = None
    if conflict is not None:
        shortfall = conflict['required_wh'] - conflict['budget_wh']
        explanation = (
            f"Running {', '.join(conflict['services'])} for their full requested "
            f"hours needs {conflict['required_wh']} Wh, but only "
            f"{conflict['budget_wh']} Wh is available — a shortfall of "
            f"{shortfall} Wh. That is the smallest set of services that alone "
            f"breaks the battery budget; it does not mean the other appliances "
            f"are free of blame, only that these four are sufficient to prove "
            f"infeasibility."
        )
    return {'problem': problem, 'result': result, 'conflict': conflict,
            'explanation': explanation}


def build_alternative(spec):
    problem = fixture(OUTAGE_HOURS, BUDGET_WH, MAX_W)
    for appliance in problem['appliances']:
        if appliance['id'] == 'fan':
            appliance['required_hours'] = spec['fan_hours']
        if appliance['id'] == 'laptop':
            appliance['required_hours'] = spec['laptop_hours']
    result = solve(problem)
    verification = check(problem, result['schedule']) if result['feasible'] else None
    protected = ['fridge', 'router', 'lamp', 'phone']
    protected_ok = bool(verification) and all(
        verification['service_hours'][aid] >= next(
            a['required_hours'] for a in problem['appliances'] if a['id'] == aid)
        for aid in protected
    )
    return {
        'id': spec['id'], 'label': spec['label'],
        'fan_hours': spec['fan_hours'], 'laptop_hours': spec['laptop_hours'],
        'problem': problem, 'result': result,
        'independent_verification': verification,
        'protected_services_preserved': protected_ok,
    }


def build_plan():
    requested = build_requested()
    alternatives = [build_alternative(spec) for spec in ALTERNATIVES]
    return {
        'schema': 1, 'synthetic': True, 'instance': INSTANCE,
        'nonce': token_hex(4), 'time_utc': datetime.now(timezone.utc).isoformat(),
        'title': "Tonight's outage plan",
        'outage_hours': OUTAGE_HOURS, 'budget_wh': BUDGET_WH, 'max_w': MAX_W,
        'protected': 'Fridge + router: 12h. Lamp: first 4h. Phone charge: 1h in first 3h.',
        'limits': ('Synthetic estimates. Hourly average loads. Startup surges, '
                   'wiring and battery aging are not modeled. Not a guarantee.'),
        'requested': requested,
        'alternatives': alternatives,
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
        elif self.path == '/plan':
            try:
                self.reply(200, build_plan())
            except Exception as e:  # noqa: BLE001 - surface to the app as JSON
                self.reply(500, {'error': str(e)})
        else:
            self.reply(404, {'error': 'not found'})


if __name__ == '__main__':
    print(json.dumps({'listen': f'http://127.0.0.1:{PORT}', 'instance': INSTANCE}), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
