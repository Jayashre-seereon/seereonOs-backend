"""Shared test fixtures.

Database: TEST_DATABASE_URL (owner) / TEST_DATABASE_APP_URL (app role), default seereonos_py_test on localhost —
create it once with `psql -U postgres -v dbname=seereonos_py_test -f backend/tools/bootstrap.sql`. The session resets
it (DROP SCHEMA -> migrations -> demo seed); `fresh` reseeds in place between tests that need pristine data.
Golden tests (tests/golden) need no database. Run everything with TZ=Asia/Kolkata (the reference's process TZ).
"""

from __future__ import annotations

import os
import time
from typing import Any

import pytest

# The reference runs with process TZ Asia/Kolkata; pin it before any app module computes a date, so the suite is
# correct however it is launched (importing pytest does not read the local time zone).
os.environ['TZ'] = 'Asia/Kolkata'
time.tzset()

OWNER = os.environ.get('TEST_DATABASE_URL', 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos_py_test')
APP = os.environ.get('TEST_DATABASE_APP_URL', 'postgres://seereon_app:seereon_app@localhost:5432/seereonos_py_test')
PASSWORD = 'Seereon@123'


def env_for(**over: Any) -> dict[str, str]:
    env = {
        'APP_ENV': 'test',
        'DATABASE_URL': OWNER,
        'DATABASE_APP_URL': APP,
        'DEMO_MODE': 'true',
        'LOG_LEVEL': 'silent',
        'STATIC_DIR': '',
        'RATE_LIMIT_AUTH': '100000',
        'RATE_LIMIT_GLOBAL': '1000000',
        'TZ': 'Asia/Kolkata',
    }
    env.update({k: str(v) for k, v in over.items()})
    return env


def _db_available() -> bool:
    try:
        import psycopg

        with psycopg.connect(OWNER, connect_timeout=3) as c:
            c.execute('SELECT 1')
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.fixture(scope='session')
def seed() -> dict[str, Any]:
    """the demo seed (exported from the TypeScript) + its password hashes, computed once"""
    from app.db.seed import hash_all, seed_data

    data = seed_data()
    return {'data': data, 'hashes': hash_all(data.get('passwords') or [])}


@pytest.fixture(scope='session')
def db(seed: dict[str, Any]) -> str:
    if not _db_available():
        pytest.skip(f'test database not reachable ({OWNER}); see tests/conftest.py')
    from app.db.migrate import migrate
    from app.db.pool import connect
    from app.db.reset import drop_all
    from app.db.seed import seed_database

    os.environ.pop('APP_ENV', None)
    with connect(OWNER) as c:
        drop_all(c)
        migrate(c, log=lambda s: None)
        seed_database(c, seed['data'], log=lambda s: None, hashes=seed['hashes'])
    return OWNER


@pytest.fixture(scope='session')
def app(db: str, seed: dict[str, Any]):  # type: ignore[no-untyped-def]
    from app.config import load_config
    from app.main import create_app

    cfg = load_config(env_for())
    a = create_app(cfg, start_workers=False)
    # demo reset in tests: reuse the precomputed hashes (scrypt is slow)
    rt = a.state.rt

    def fast_reset() -> None:
        from app.db.reset import reseed_in_place

        with rt.backend.pools.owner.connection() as c:
            reseed_in_place(c, seed['data'], hashes=seed['hashes'])

    rt.demo_reset = fast_reset
    yield a
    rt.backend.pools.close()


class Api:
    def __init__(self, client: Any) -> None:
        self.c = client
        self.tokens: dict[str, str] = {}

    def call(
        self, method: str, path: str, body: Any = None, token: str | None = None, headers: dict[str, str] | None = None, query: dict[str, Any] | None = None
    ):  # type: ignore[no-untyped-def]
        h = dict(headers or {})
        if token:
            h['Authorization'] = 'Bearer ' + token
        kw: dict[str, Any] = {'headers': h, 'params': query}
        if body is not None:
            kw['json'] = body
        return self.c.request(method, '/api/v1' + path, **kw)

    def login(self, email: str, password: str = PASSWORD) -> str:
        r = self.call('POST', '/auth/login', {'email': email, 'password': password})
        assert r.status_code == 200, r.text
        return r.json()['data']['token']

    def as_(self, email: str) -> str:
        if email not in self.tokens:
            self.tokens[email] = self.login(email)
        return self.tokens[email]


@pytest.fixture(scope='session')
def client(app):  # type: ignore[no-untyped-def]
    from starlette.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def api(client) -> Api:  # type: ignore[no-untyped-def]
    return Api(client)


@pytest.fixture()
def fresh(app, client):  # type: ignore[no-untyped-def]
    """pristine demo data (in-place reseed, like POST /demo/reset) before the test"""
    r = client.post('/api/v1/demo/reset')
    assert r.status_code == 200, r.text
    yield
