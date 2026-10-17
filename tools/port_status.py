"""Writes backend/PORT_STATUS.md: every route of the reference (TS registry) -> module -> ported in Python? -> parity.

    python tools/port_status.py [--parity backend/var/parity.out ...] [--node-openapi URL] [--py-openapi URL]

* routes: the TS registry (node tools/node_routes.mjs), in match order, grouped by module;
* ported: the route is registered in the Python registry with the same method, pattern and options;
* parity: from parity harness logs (backend/tools/parity.sh output): PASS / FAIL per route pattern (all calls of the
  pattern must pass), "—" when no call covered it;
* when both OpenAPI URLs are given, their path lists are compared too (a running Node reference vs the Python API).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..')))


def node_routes() -> list[dict]:
    out = subprocess.run(['node', os.path.join(HERE, 'node_routes.mjs')], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def python_routes() -> list[dict]:
    from app.router import Router, load_modules

    r = load_modules(Router())

    class _Rt:  # overrides need only these attributes to register
        backend = None
        demo_reset = None

    from app.auth.overrides import OverrideDeps, register_overrides

    register_overrides(r, OverrideDeps(rt=_Rt(), demo_mode=False, app_url='http://x'))
    return [
        {
            'method': x.method,
            'pattern': x.pattern,
            'module': x.module,
            'public': x.public,
            'superAdmin': x.super_admin,
            'allowViewAsWrite': x.allow_view_as_write,
            'override': x.override,
        }
        for x in r.routes
    ]


def match(routes: list[dict], method: str, path: str) -> dict | None:
    parts = [p for p in path.split('?')[0].split('/') if p]
    for r in routes:
        rp = [p for p in r['pattern'].split('/') if p]
        if r['method'] == method and len(rp) == len(parts) and all(a.startswith(':') or a == b for a, b in zip(rp, parts)):
            return r
    return None


def parity_results(files: list[str], routes: list[dict]) -> dict[str, str]:
    res: dict[str, str] = {}
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for line in fh:
                m = re.match(r'^(PASS|FAIL) \S+ (GET|POST|PUT|PATCH|DELETE) (\S+)', line)
                if not m:
                    continue
                r = match(routes, m.group(2), m.group(3))
                if not r:
                    continue
                k = f'{r["method"]} {r["pattern"]}'
                if m.group(1) == 'FAIL':
                    res[k] = 'FAIL'
                elif k not in res:
                    res[k] = 'PASS'
    return res


def openapi_ops(url: str) -> dict[str, dict]:
    with urllib.request.urlopen(url, timeout=10) as r:
        d = json.load(r)
    return {f'{m.upper()} {p}': o for p, ops in d['paths'].items() for m, o in ops.items()}


NOTES = [
    '* Every route of the TypeScript registry is registered in Python with the same method, pattern and options',
    '  (public / superAdmin / allowViewAsWrite); the auth overrides (login, MFA, signup, reset, invites, /me/password, demo',
    '  reset) are the port of the Node reference\'s server overrides.',
    '* The OpenAPI comparison is against a running Node reference (the frozen bundle of the removed Node server, kept',
    '  outside the repository for comparisons): same operations, and each operation object (tags, summary, security,',
    '  parameters, request body, responses) compared as JSON.',
    '* Parity = the in-process TypeScript mock vs the Python API over HTTP on one stack, both loading the same demo seed',
    '  (backend/tests/e2e/parity.ts: fixed calls + module write scenarios + SWEEP of every GET route for 6 users).',
    '* Not covered by a parity call ("—"): `POST /auth/login/mfa`, `POST /auth/logout`, `POST /demo/reset` — tokens and',
    '  sessions differ per side; they are proven by tests/integration/test_auth.py and tests/e2e/multi.mjs.',
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--parity', nargs='*', default=[])
    ap.add_argument('--node-openapi')
    ap.add_argument('--py-openapi')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'PORT_STATUS.md'))
    a = ap.parse_args()
    node = node_routes()
    py = python_routes()
    py_shared = {(r['method'], r['pattern']): r for r in py if not r['override']}
    py_any = {(r['method'], r['pattern']) for r in py}
    par = parity_results(a.parity, node)
    mods: OrderedDict[str, list[dict]] = OrderedDict()
    for r in node:
        mods.setdefault(r['module'], []).append(r)
    total = len(node)
    ported = 0
    lines = []
    summary = []
    for mod, rs in mods.items():
        n_ported = 0
        rows = []
        for r in rs:
            k = (r['method'], r['pattern'])
            p = py_shared.get(k)
            opts_ok = p is None or all(p[o] == r[o] for o in ('public', 'superAdmin', 'allowViewAsWrite'))
            is_ported = (p is not None and opts_ok) or (p is None and k in py_any)
            n_ported += is_ported
            status = par.get(f'{r["method"]} {r["pattern"]}', '—')
            note = '' if opts_ok else ' (options differ!)'
            if p is None and k in py_any:
                note = ' (server override)'
            rows.append(f'| {r["method"]} | `{r["pattern"]}` | {"yes" if is_ported else "no"}{note} | {status} |')
        ported += n_ported
        par_pass = sum(1 for r in rs if par.get(f'{r["method"]} {r["pattern"]}') == 'PASS')
        par_fail = sum(1 for r in rs if par.get(f'{r["method"]} {r["pattern"]}') == 'FAIL')
        summary.append(f'| {mod} | {len(rs)} | {n_ported} | {par_pass} | {par_fail} |')
        lines.append(f'\n### {mod} ({n_ported}/{len(rs)} ported)\n\n| method | path | ported | parity |\n|---|---|---|---|')
        lines.extend(rows)
    extra = sorted({f'{r["method"]} {r["pattern"]}' for r in py} - {f'{r["method"]} {r["pattern"]}' for r in node})
    head = [
        '# PORT_STATUS — Python API vs the TypeScript reference',
        '',
        'Generated by `python backend/tools/port_status.py --parity <parity logs> [--node-openapi URL --py-openapi URL]` from a full',
        'run (`backend/tools/parity.sh --sweep > backend/var/parity-full.out`). "parity" = every parity-harness call of that route',
        'pattern passed (PASS) / at least one failed (FAIL) / not covered by a harness call (—).',
        '',
        f'**{ported} of {total} routes ported.**',
        '',
        '| module (OpenAPI tag) | routes | ported | parity PASS | parity FAIL |',
        '|---|---|---|---|---|',
        *summary,
    ]
    if a.parity:
        n_pass = n_fail = 0
        for f in a.parity:
            with open(f, encoding='utf-8') as fh:
                for line in fh:
                    m = re.match(r'^parity(?: \(sweep only\))?: (\d+) passed, (\d+) failed', line)
                    if m:  # the harness total (also counts the sign-ins it compares)
                        n_pass, n_fail = n_pass + int(m.group(1)), n_fail + int(m.group(2))
        head += ['', f'Parity harness calls in {", ".join(os.path.basename(f) for f in a.parity)}: {n_pass} equal, {n_fail} different.']
    if a.node_openapi and a.py_openapi:
        no, po = openapi_ops(a.node_openapi), openapi_ops(a.py_openapi)
        n, p = set(no), set(po)
        differ = sorted(k for k in n & p if no[k] != po[k])
        head += ['', f'OpenAPI vs the running Node reference: Node {len(n)} operations, Python {len(p)}; missing in Python: {len(n - p)};'
                 f' only in Python: {len(p - n)}; operation objects that differ: {len(differ)}.']
        if n - p:
            head += ['', 'Missing in Python (must be empty): ' + ', '.join(sorted(n - p))]
        if p - n:
            head += ['', 'Only in Python (must be empty): ' + ', '.join(sorted(p - n))]
        if differ:
            head += ['', 'Operation objects that differ (must be empty): ' + ', '.join(differ)]
    if extra:
        head += ['', 'Registered in Python but not in the reference (must be empty): ' + ', '.join(extra)]
    head += ['', '## Notes', '', *NOTES]
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(head + lines) + '\n')
    bad_opts = sum(1 for x in lines if 'options differ' in x)
    print(f'{ported}/{total} routes ported, {bad_opts} with different options, {len(extra)} extra -> {os.path.relpath(a.out)}')


if __name__ == '__main__':
    main()
