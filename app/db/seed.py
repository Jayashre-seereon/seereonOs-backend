"""Demo seed loader — port of server/db/seed.ts.

The seed is the TypeScript generator (src/mock/seed.ts buildSeed, dates relative to today) exported as JSON by
`node backend/tools/export_seed.mjs`. `seed_data()` finds that JSON:
  1. SEED_JSON (env) when set — e.g. the file baked into the Docker image at build time;
  2. backend/var/seed.json, re-exported first when Node is available and the file is missing or was generated on
     another day (SEED_REGENERATE=never disables; =always forces).
Every table is bulk-inserted in array order (so _ord follows the mock's insertion order) inside one transaction. The
demo plaintext passwords are hashed with scrypt into user_credentials; sessions / login attempts / reset tokens are
not loaded (exactly like the Node loader).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import orjson
import psycopg

from app.auth.passwords import hash_password
from app.db.mapping import Meta, build_inserts, load_meta

NOT_LOADED = frozenset({'passwords', 'sessions', 'login_attempts', 'reset_tokens'})
BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFAULT_SEED = os.path.join(BACKEND, 'var', 'seed.json')

SeedData = dict[str, list[dict[str, Any]]]


def _today() -> str:
    t = time.localtime()
    return '%04d-%02d-%02d' % (t.tm_year, t.tm_mon, t.tm_mday)


def export_seed(path: str = DEFAULT_SEED) -> None:
    node = shutil.which('node')
    if not node:
        raise RuntimeError('node is not installed: cannot export the demo seed (set SEED_JSON to an exported file)')
    subprocess.run([node, os.path.join(BACKEND, 'tools', 'export_seed.mjs'), path], check=True, cwd=os.path.dirname(BACKEND), stdout=subprocess.DEVNULL)


def seed_file() -> str:
    explicit = os.environ.get('SEED_JSON')
    if explicit:
        return explicit
    mode = os.environ.get('SEED_REGENERATE', 'auto')
    stale = True
    if os.path.exists(DEFAULT_SEED):
        with open(DEFAULT_SEED, 'rb') as f:
            head = f.read(200)
        stale = f'"generated_on":"{_today()}"'.encode() not in head
    if mode == 'always' or (mode == 'auto' and stale and shutil.which('node')):
        export_seed(DEFAULT_SEED)
    if not os.path.exists(DEFAULT_SEED):
        raise RuntimeError(f'No demo seed at {DEFAULT_SEED}: run `node backend/tools/export_seed.mjs` (or set SEED_JSON).')
    return DEFAULT_SEED


def seed_data(path: str | None = None) -> SeedData:
    with open(path or seed_file(), 'rb') as f:
        return orjson.loads(f.read())['tables']


def hash_all(passwords: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """scrypt is slow (N=32768): hash in parallel threads (hashlib.scrypt releases the GIL)"""
    with ThreadPoolExecutor(max_workers=min(8, max(1, os.cpu_count() or 2))) as ex:
        hashes = list(ex.map(lambda p: hash_password(p['password'], gated=False), passwords))
    return [(p['user_id'], h) for p, h in zip(passwords, hashes)]


def seed_database(
    conn: psycopg.Connection,
    data: SeedData | None = None,
    log: Callable[[str], None] = print,
    own_transaction: bool = True,
    hashes: list[tuple[str, str]] | None = None,
) -> tuple[SeedData, Meta, int]:
    data = seed_data() if data is None else data
    meta = load_meta(conn)
    for t in data:
        if t not in meta.tables and t not in NOT_LOADED and t != 'pending_tokens':
            raise RuntimeError(f'Seed table "{t}" has no database table')
    t0 = time.time()
    if hashes is None:
        hashes = hash_all(data.get('passwords') or [])
    rows = 0

    def run() -> None:
        nonlocal rows
        with conn.cursor() as cur:
            for table in meta.tables:  # meta order (table name), one transaction: FKs are deferred
                arr = data.get(table) or []
                for sql, values in build_inserts(table, arr, meta):
                    cur.execute(sql, values)  # type: ignore[arg-type]
                rows += len(arr)
            if hashes:
                cur.executemany("INSERT INTO user_credentials (user_id, password_hash, password_algo) VALUES (%s, %s, 'scrypt')", hashes)

    if own_transaction:
        with conn.transaction():
            run()
    else:
        run()
    log(f'seeded {rows} rows into {len(meta.tables)} tables + {len(hashes)} credentials ({int((time.time() - t0) * 1000)} ms)')
    return data, meta, rows
