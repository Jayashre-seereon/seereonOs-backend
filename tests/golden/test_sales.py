"""app/routes/sales.py against Node golden vectors (tests/golden/gen/sales.mjs): reads for every user of both tenants on
several days, every write route (valid + invalid, allowed + denied), stale-deal notices, the stage-history repair and
the exports (view_deal, closed_in_month, comp_for) — every response, warning and the rows written."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.ctx import rows
from app.routes import sales as sa
from tests.golden.memdb import MemRuntime, load_gz
from tests.golden.route_kit import Cap, Ids, fixed_env, replay

V = load_gz('sales.json.gz')
SEED = load_gz('engine_seed.json.gz')
TABLES = ['deals', 'deal_activities', 'deal_stage_history', 'projects', 'project_status_history', 'activity_log', 'notifications', 'number_sequences']
REPAIR_TABLES = ['deals', 'notifications']
CAP = Cap()
sa.register(CAP)
FNS: dict[str, Any] = {
    'viewDeals': lambda ctx, a: [sa.view_deal(ctx, d) for d in rows(ctx, 'deals')],
    'closedInMonth': lambda ctx, a: [sa.closed_in_month(rows(ctx, 'deals'), u, m) for u in a['users'] for m in a['months']],
    'compFor': lambda ctx, a: [sa.comp_for(ctx, u, m) for u in a['users'] for m in a['months']],
    'products': lambda ctx, a: sa.PRODUCTS,
}


@pytest.fixture(scope='module')
def rt() -> MemRuntime:
    return MemRuntime(SEED['tables'])


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> Ids:
    monkeypatch.setattr(sa, 'random', SimpleNamespace(randrange=lambda n: n // 2))  # Math.random() = 0.5 in the generator
    return fixed_env(monkeypatch)


@pytest.mark.parametrize('idx', range(len(V['scenarios'])), ids=[s['name'] for s in V['scenarios']])
def test_scenarios(rt: MemRuntime, env: Ids, idx: int) -> None:
    sc = V['scenarios'][idx]
    bad = replay(rt, env, sc, CAP, FNS, REPAIR_TABLES if sc['name'] == 'stage repair' else TABLES)
    assert not bad, f'{sc["name"]}: {bad[:3]}'
