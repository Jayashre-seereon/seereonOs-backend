"""Migration runner — compatible with server/db/migrate.ts (same schema_migrations rows and sha256 checksums, so a
database migrated by the Node tooling is recognised and vice versa).

Applies backend/migrations/V###__name.sql in version order, each file in its own transaction, recorded with the
sha256 of its contents. An applied file whose contents changed is refused (add a new migration instead). Concurrent
runners are serialised with the same advisory lock key as the Node runner.

    python -m app.db.migrate            (DATABASE_URL = owner connection)
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass

import psycopg

MIGRATIONS_DIR = os.environ.get('MIGRATIONS_DIR') or os.path.join(os.path.dirname(__file__), '..', '..', 'migrations')
LOCK_KEY = 7_405_311_001


@dataclass
class MigrationFile:
    version: str
    order: int
    checksum: str
    sql: str


def read_migrations(directory: str = MIGRATIONS_DIR) -> list[MigrationFile]:
    out = []
    for f in os.listdir(directory):
        if not re.fullmatch(r'V\d+__[\w-]+\.sql', f, re.ASCII):
            continue
        with open(os.path.join(directory, f), 'rb') as fh:
            raw = fh.read()
        out.append(MigrationFile(f, int(re.match(r'V(\d+)', f).group(1)), hashlib.sha256(raw).hexdigest(), raw.decode('utf-8')))  # type: ignore[union-attr]
    return sorted(out, key=lambda m: m.order)


def migrate(conn: psycopg.Connection, directory: str = MIGRATIONS_DIR, log: Callable[[str], None] = print) -> list[str]:
    files = read_migrations(directory)
    seen: set[int] = set()
    for f in files:
        if f.order in seen:
            raise RuntimeError(f'Duplicate migration version V{f.order} ({f.version})')
        seen.add(f.order)
    conn.autocommit = True
    conn.execute('SELECT pg_advisory_lock(%s)', [LOCK_KEY])
    try:
        conn.execute(
            'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        applied = dict(conn.execute('SELECT version, checksum FROM schema_migrations').fetchall())
        for v in applied:
            if not any(f.version == v for f in files):
                raise RuntimeError(f'Applied migration {v} is missing from {directory}')
        done: list[str] = []
        for f in files:
            prev = applied.get(f.version)
            if prev is not None:
                if prev != f.checksum:
                    raise RuntimeError(
                        f'Migration {f.version} was changed after it was applied (checksum {prev[:12]}… → {f.checksum[:12]}…). Add a new migration instead.'
                    )
                continue
            t0 = time.time()
            try:
                with conn.transaction():
                    conn.execute(f.sql)  # type: ignore[arg-type]
                    conn.execute('INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)', [f.version, f.checksum])
            except Exception as e:
                raise RuntimeError(f'Migration {f.version} failed: {e}') from e
            done.append(f.version)
            log(f'applied {f.version} ({int((time.time() - t0) * 1000)} ms)')
        if not done:
            log('schema is up to date')
        return done
    finally:
        conn.execute('SELECT pg_advisory_unlock(%s)', [LOCK_KEY])


def main() -> None:
    from app.config import settings
    from app.db.pool import connect

    with connect(settings().database_url) as c:
        migrate(c)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(e, file=sys.stderr)
        sys.exit(1)
