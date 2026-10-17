"""PostgreSQL connection pools (psycopg 3, sync) and the value loaders the row mapping relies on.

Two pools, like the Node reference:
  * owner (DATABASE_URL, seereon_owner): migrations, seed, auth/platform tables, super-admin reads, the flush
    transaction (tenant statements inside it run under SET LOCAL ROLE seereon_app, so RLS applies);
  * app   (DATABASE_APP_URL, seereon_app): tenant reads, always inside a transaction with app.tenant_id set (RLS).

Type loaders (installed globally, text protocol): date -> 'YYYY-MM-DD' str; timestamptz -> toISOString() form
('…T…sssZ', UTC, milliseconds truncated); numeric -> int/float; json/jsonb -> orjson.loads.
"""

from __future__ import annotations

import re
import threading
from datetime import UTC, datetime
from typing import Any

import orjson
import psycopg
from psycopg.adapt import Loader
from psycopg.types.json import set_json_dumps, set_json_loads
from psycopg.types.string import TextLoader
from psycopg_pool import ConnectionPool

_FAST_TS = re.compile(r'^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?\+00$')


class _DateLoader(Loader):
    def load(self, data: Any) -> str:
        return bytes(data).decode()


class _TsLoader(Loader):
    def load(self, data: Any) -> str:
        s = bytes(data).decode()
        m = _FAST_TS.match(s)
        if m:
            return f'{m.group(1)}T{m.group(2)}.{((m.group(3) or "") + "000")[:3]}Z'
        if s in ('infinity', '-infinity'):
            return s
        try:
            d = datetime.fromisoformat(s.replace(' ', 'T'))
        except ValueError:
            return s
        if d.tzinfo is None:
            d = d.replace(tzinfo=UTC)
        d = d.astimezone(UTC)
        return d.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (d.microsecond // 1000)


class _NumericLoader(Loader):
    def load(self, data: Any) -> int | float:
        s = bytes(data).decode()
        try:
            return int(s)
        except ValueError:
            f = float(s)
            return int(f) if f.is_integer() and abs(f) < 2**53 else f


_installed = False


def install_loaders() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    a = psycopg.adapters
    # date: the text as is ('YYYY-MM-DD'; DateStyle ISO) — psycopg's C text loader, same str as _DateLoader
    a.register_loader('date', TextLoader)
    a.register_loader('timestamptz', _TsLoader)
    a.register_loader('timestamp', _TsLoader)
    a.register_loader('numeric', _NumericLoader)
    set_json_loads(orjson.loads)
    set_json_dumps(lambda v: orjson.dumps(v).decode())


def _conninfo_kwargs(statement_timeout_ms: int) -> dict[str, Any]:
    return {
        'options': f'-c statement_timeout={statement_timeout_ms} -c idle_in_transaction_session_timeout=60000 -c timezone=UTC',
        'application_name': 'seereonos-api-py',
    }


def to_conninfo(url: str) -> str:
    """postgres:// URLs are accepted by libpq as is"""
    return url


class Pools:
    """the two pools of one process"""

    def __init__(
        self,
        owner_url: str,
        app_url: str,
        owner_max: int = 10,
        app_max: int = 20,
        statement_timeout_ms: int = 30000,
        open: bool = True,
        prepare_threshold: int | None = 5,
    ) -> None:
        install_loaders()
        kw = _conninfo_kwargs(statement_timeout_ms)
        # psycopg prepares a statement server-side after it ran `prepare_threshold` times on a connection (the hot
        # queries: session lookup, version vector, table reads). None = never (PgBouncer in transaction mode < 1.21)
        kw['prepare_threshold'] = prepare_threshold
        self.owner = ConnectionPool(
            to_conninfo(owner_url), min_size=1, max_size=owner_max, kwargs={**kw, 'autocommit': True}, open=open, name='owner', timeout=30
        )
        self.app = ConnectionPool(to_conninfo(app_url), min_size=1, max_size=app_max, kwargs={**kw, 'autocommit': True}, open=open, name='app', timeout=30)
        self._closed = False
        self._lock = threading.Lock()

    def ping(self) -> None:
        with self.owner.connection() as c:
            c.execute('SELECT 1')
        with self.app.connection() as c:
            c.execute('SELECT 1')

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        self.owner.close()
        self.app.close()


def connect(url: str, statement_timeout_ms: int = 30000) -> psycopg.Connection:
    """a single autocommit connection (tooling: migrate / seed / reset)"""
    install_loaders()
    return psycopg.connect(to_conninfo(url), autocommit=True, **_conninfo_kwargs(statement_timeout_ms))
