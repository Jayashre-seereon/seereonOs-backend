"""Database reset — port of server/db/reset.ts (development / tests only; refused when APP_ENV=production).

    python -m app.db.reset              DROP SCHEMA public → migrate → seed
    python -m app.db.reset --no-seed    DROP SCHEMA public → migrate
    python -m app.db.reset --migrate    migrate only (production-safe)
    python -m app.db.reset --seed       seed an empty, migrated schema

`reseed_in_place` is POST /demo/reset (DEMO_MODE only): TRUNCATE every data table, re-insert the seed and bump every
tenant_table_versions row, in ONE transaction (concurrent requests wait on the TRUNCATE lock and then see fresh data;
versions only increase, so every API instance's cache invalidates).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable

import psycopg

from app.db.mapping import ident, load_meta
from app.db.migrate import migrate
from app.db.seed import SeedData, hash_all, seed_data, seed_database

PLATFORM_DATA_TABLES = [
    'user_credentials',
    'sessions',
    'login_attempts',
    'reset_tokens',
    'idempotency_keys',
    'email_deliveries',
    'rate_limits',
    'security_events',
]
PLATFORM_DATA_TABLES_OPTIONAL = ['table_changes']  # V007 (the flush change log); absent on databases not yet migrated


def _refuse_production() -> None:
    env = os.environ.get('APP_ENV') or os.environ.get('NODE_ENV')
    if env == 'production':
        raise RuntimeError('db reset is disabled in production')


def drop_all(conn: psycopg.Connection) -> None:
    _refuse_production()
    conn.execute('DROP SCHEMA IF EXISTS public CASCADE')
    conn.execute('CREATE SCHEMA public')
    conn.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
    conn.execute('GRANT USAGE ON SCHEMA public TO seereon_app')
    conn.execute('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO seereon_app')


def reset_database(conn: psycopg.Connection, seed: bool = True, data: SeedData | None = None, log: Callable[[str], None] = print) -> None:
    drop_all(conn)
    migrate(conn, log=log)
    if seed:
        seed_database(conn, data, log)


def reseed_in_place(
    conn: psycopg.Connection, data: SeedData | None = None, log: Callable[[str], None] = lambda s: None, hashes: list[tuple[str, str]] | None = None
) -> None:
    _refuse_production()
    data = seed_data() if data is None else data
    if hashes is None:
        hashes = hash_all(data.get('passwords') or [])  # slow: outside the transaction
    meta = load_meta(conn)
    tables = [*meta.tables.keys(), *PLATFORM_DATA_TABLES]
    tables += [t for t in PLATFORM_DATA_TABLES_OPTIONAL if conn.execute('SELECT to_regclass(%s) IS NOT NULL', [f'public.{t}']).fetchone()[0]]  # type: ignore[index]
    with conn.transaction():
        conn.execute(f'TRUNCATE {", ".join(ident(t) for t in tables)} RESTART IDENTITY')  # type: ignore[arg-type]
        seed_database(conn, data, log, own_transaction=False, hashes=hashes)
        conn.execute('UPDATE tenant_table_versions SET version = version + 1')


def main(argv: list[str]) -> None:
    from app.config import settings
    from app.db.pool import connect

    with connect(settings().database_url) as c:
        if '--migrate' in argv:
            migrate(c)
        elif '--seed' in argv:
            n = c.execute('SELECT count(*) FROM tenants').fetchone()[0]  # type: ignore[index]
            if n and '--force' not in argv:
                raise RuntimeError('Database already has tenants; use python -m app.db.reset (or --seed --force on an empty schema).')
            seed_database(c)
        else:
            reset_database(c, seed='--no-seed' not in argv)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as e:  # noqa: BLE001
        print(e, file=sys.stderr)
        sys.exit(1)
