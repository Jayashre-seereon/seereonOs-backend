"""PostgreSQL side of the unit of work — port of server/src/pg/backend.ts.

* tenant reads: app pool (seereon_app), REPEATABLE READ READ ONLY snapshot with app.tenant_id set (RLS enforced);
* platform/auth tables, super-admin reads and the flush transaction: owner pool; inside the flush, tenant-table
  statements run under SET LOCAL ROLE seereon_app (RLS applies) and only platform statements run as owner;
* one flush = one transaction: advisory lock on the tenant -> read-set version check -> batched DELETE / UPDATE /
  INSERT -> platform rows -> email deliveries -> idempotency record -> COMMIT.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

import orjson
import psycopg

from app.db.mapping import Meta, ident, load_meta, row_from_tuple, values_to_pg, write_columns
from app.db.pool import Pools

MAX_PARAMS = 30000


@dataclass
class TableChange:
    table: str
    inserts: list[dict[str, Any]] = field(default_factory=list)
    updates: list[tuple[dict[str, Any], dict[str, Any]]] = field(default_factory=list)  # (before, after)
    deletes: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class PlatformChange:
    credential_upserts: list[tuple[str, str]] = field(default_factory=list)  # (user_id, scrypt hash)
    credential_deletes: list[str] = field(default_factory=list)
    session_inserts: list[dict[str, Any]] = field(default_factory=list)  # {token_hash, user_id, tenant_id, created_at}
    session_revokes: list[str] = field(default_factory=list)
    reset_inserts: list[dict[str, Any]] = field(default_factory=list)  # {token_hash, user_id, expires_at(ms), used}
    reset_used: list[str] = field(default_factory=list)
    reset_deletes: list[str] = field(default_factory=list)
    attempt_failures: list[dict[str, Any]] = field(default_factory=list)  # {email, at(ms)}
    attempt_clears: list[str] = field(default_factory=list)

    def empty(self) -> bool:
        return not (
            self.credential_upserts
            or self.credential_deletes
            or self.session_inserts
            or self.session_revokes
            or self.reset_inserts
            or self.reset_used
            or self.reset_deletes
            or self.attempt_failures
            or self.attempt_clears
        )


@dataclass
class IdempotencyRecord:
    tenant_id: str
    key: str
    method: str
    path: str
    status: int
    body: bytes  # the serialised envelope


@dataclass
class FlushPlan:
    mode: str  # tenant | global | fresh
    tenant_id: str | None
    read_set: dict[str, int]
    tables: list[TableChange]
    platform: PlatformChange
    client_ip: str | None = None
    user_agent: str | None = None
    session_absolute_days: int = 30
    idempotency: IdempotencyRecord | None = None
    lease: Lease | None = None


@dataclass
class FlushOutcome:
    status: str  # ok | conflict
    tables: list[str] = field(default_factory=list)  # conflict: tables whose version moved
    versions_before: dict[str, int] = field(default_factory=dict)
    versions_after: dict[str, int] = field(default_factory=dict)
    statements: dict[str, int] = field(default_factory=dict)


class Lease:
    """exclusive per-tenant write lock (owner connection with an open transaction holding pg_advisory_xact_lock)"""

    def __init__(self, tenant_id: str, conn: psycopg.Connection, pool: Any) -> None:
        self.tenant_id = tenant_id
        self.conn = conn
        self._pool = pool
        self.open = True

    def close_after_flush(self) -> None:
        """the flush committed on this connection: give it back"""
        if self.open:
            self.open = False
            self._pool.putconn(self.conn)

    def release(self) -> None:
        if not self.open:
            return
        self.open = False
        try:
            self.conn.execute('ROLLBACK')
        except Exception:  # noqa: BLE001
            pass
        self._pool.putconn(self.conn)


class Snapshot:
    """a read snapshot of one tenant (REPEATABLE READ READ ONLY on the app pool) or of all tenants (owner pool,
    super-admin): versions + lazily loaded tables, all from the same snapshot."""

    def __init__(self, backend: PgBackend, tenant_id: str | None, global_: bool = False) -> None:
        self.backend = backend
        self.tenant_id = tenant_id
        self.global_ = global_
        self.pool = backend.pools.owner if global_ else backend.pools.app
        self.conn: psycopg.Connection | None = self.pool.getconn()
        try:
            if global_:
                self.conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
                self.versions: dict[str, int] = {}
            else:
                # one network round trip (pipeline) for the transaction, the tenant setting and the version vector
                c = self.conn
                with c.pipeline():
                    c.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
                    c.execute("SELECT set_config('app.tenant_id', %s, true)", [tenant_id])
                    cur = c.execute('SELECT table_name, version FROM tenant_table_versions WHERE tenant_id = %s', [tenant_id])
                self.versions = dict(cur.fetchall())
        except Exception:
            self.close()
            raise

    def load(self, table: str) -> list[dict[str, Any]]:
        if self.conn is None:
            raise RuntimeError('snapshot closed')
        tm = self.backend.meta.tables[table]
        if self.global_:
            sql = tm.select_sql + ' ORDER BY _ord'
            cur = self.conn.execute(sql)  # type: ignore[arg-type]
        else:
            sql = tm.select_sql + (' WHERE id = %s' if table == 'tenants' else ' WHERE tenant_id = %s') + ' ORDER BY _ord'
            cur = self.conn.execute(sql, [self.tenant_id])  # type: ignore[arg-type]
        m = tm.mapper
        return [m(t) for t in cur.fetchall()]

    def load_where(self, table: str, field: str, value: str) -> list[dict[str, Any]]:
        """the tenant's rows with `field` = value, in table order (an index-backed query; RLS applies)"""
        if self.conn is None:
            raise RuntimeError('snapshot closed')
        tm = self.backend.meta.tables[table]
        cur = self.conn.execute(tm.select_sql + f' WHERE tenant_id = %s AND {ident(field)} = %s ORDER BY _ord', [self.tenant_id, value])  # type: ignore[arg-type]
        m = tm.mapper
        return [m(t) for t in cur.fetchall()]

    def delta(self, table: str, old_rows: list[dict], old_keys: list[Any], old_version: int, version: int) -> list[dict] | None:
        """The rows of `table` at `version` from those at `old_version` and the change log (V007), in the order a full
        read returns them (ORDER BY _ord): updated rows keep their place, deleted ones go, inserted ones — and rows
        deleted then inserted again — follow in _ord order (new rows always get a higher _ord). None when the log has
        no gapless chain from old_version to version, or more than delta_max rows changed."""
        b = self.backend
        if self.conn is None or self.global_ or not b.change_log or b.delta_max <= 0 or version <= old_version:
            return None
        tm = b.meta.tables[table]
        if tm.pk != ['id'] or table == 'tenants':
            return None
        steps = self.conn.execute(
            'SELECT version_before, version_after, upserted_ids, deleted_ids FROM table_changes'
            ' WHERE tenant_id = %s AND table_name = %s AND version_after > %s AND version_after <= %s ORDER BY version_after',
            [self.tenant_id, table, old_version, version],
        ).fetchall()
        prev = old_version
        state: dict[str, bool] = {}  # id -> present at the end
        moved: set[str] = set()  # ids deleted at some step: if present at the end they were inserted again (new _ord)
        for vb, va, ups, dels in steps:
            if vb != prev:
                return None
            prev = va
            for i in dels:
                state[i] = False
                moved.add(i)
            for i in ups:
                state[i] = True
            if len(state) > b.delta_max:
                return None
        if prev != version:
            return None
        want = [i for i, present in state.items() if present]
        fetched: dict[Any, dict] = {}
        if want:
            m = tm.mapper
            cur = self.conn.execute(tm.select_sql + ' WHERE tenant_id = %s AND id = ANY(%s::text[]) ORDER BY _ord', [self.tenant_id, want])  # type: ignore[arg-type]
            for t in cur.fetchall():
                r = m(t)
                fetched[r.get('id')] = r
        out: list[dict] = []
        append = out.append
        for r, k in zip(old_rows, old_keys):
            if type(k) is not str:
                return None  # ids are text; anything else: read the table
            st = state.get(k)
            if st is None:
                append(r)
            elif st and k not in moved:
                nr = fetched.pop(k, None)
                if nr is None:
                    return None  # logged as present but not found: never expected — read the table
                append(nr)  # updated in place: same _ord
        out.extend(fetched.values())  # inserted (and re-inserted) rows, in _ord order
        return out

    def close(self) -> None:
        c = self.conn
        if c is None:
            return
        self.conn = None
        try:
            c.execute('ROLLBACK')
        except Exception:  # noqa: BLE001
            pass
        self.pool.putconn(c)


class PgBackend:
    def __init__(self, pools: Pools, app_role: str = 'seereon_app', queue_emails: bool = False, delta_max: int = 2000) -> None:
        self.pools = pools
        self.app_role = app_role
        self.queue_emails = queue_emails
        self.meta: Meta = Meta()
        self._lock = threading.Lock()
        self.change_log = False  # table_changes exists (V007)
        self.delta_max = delta_max  # incremental refresh up to this many changed rows (0 = off)

    def init(self) -> None:
        with self.pools.owner.connection() as c:
            self.meta = load_meta(c)
            self.change_log = c.execute("SELECT to_regclass('public.table_changes') IS NOT NULL").fetchone()[0]  # type: ignore[index]
        if not self.meta.tables:
            raise RuntimeError('app_table_meta is empty — run the migrations (python -m app.db.migrate).')

    # ---------------- metadata ----------------
    def pk(self, table: str) -> list[str]:
        return self.meta.tables[table].pk

    def single_pk(self, table: str) -> str | None:
        pk = self.meta.tables[table].pk
        return pk[0] if len(pk) == 1 else None

    def key_fn(self, table: str):  # type: ignore[no-untyped-def]
        pk = self.meta.tables[table].pk
        if len(pk) == 1:
            c = pk[0]
            return lambda r: r.get(c)
        return lambda r: tuple(r.get(c) for c in pk)

    # ---------------- reads ----------------
    def snapshot(self, tenant_id: str | None, global_: bool = False) -> Snapshot:
        return Snapshot(self, tenant_id, global_)

    def _owner_query(self, sql: str, params: Any = None) -> list[tuple]:
        with self.pools.owner.connection() as c:
            return c.execute(sql, params).fetchall()  # type: ignore[arg-type]

    def load_credentials(self, tenant_id: str | None) -> list[dict[str, Any]]:
        if tenant_id is None:
            rows = self._owner_query('SELECT user_id, password_hash FROM user_credentials')
        else:
            rows = self._owner_query(
                'SELECT c.user_id, c.password_hash FROM user_credentials c JOIN users u ON u.id = c.user_id WHERE u.tenant_id = %s ORDER BY u._ord', [tenant_id]
            )
        return [{'user_id': u, 'hash': h} for u, h in rows]

    def load_sessions(self, tenant_id: str | None, idle_hours: int) -> list[dict[str, Any]]:
        cond = 'revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - make_interval(hours => %s)'
        if tenant_id is None:
            rows = self._owner_query(f'SELECT token_hash, user_id, tenant_id, created_at FROM sessions WHERE {cond} ORDER BY created_at', [idle_hours])
        else:
            rows = self._owner_query(
                f'SELECT token_hash, user_id, tenant_id, created_at FROM sessions WHERE tenant_id = %s AND {cond} ORDER BY created_at', [tenant_id, idle_hours]
            )
        return [{'token': t, 'user_id': u, 'tenant_id': tn, 'created_at': c} for t, u, tn, c in rows]

    def load_reset_tokens(self, tenant_id: str | None) -> list[dict[str, Any]]:
        if tenant_id is None:
            rows = self._owner_query(
                "SELECT token_hash, user_id, (extract(epoch FROM expires_at) * 1000)::bigint, used_at IS NOT NULL FROM reset_tokens WHERE expires_at > now() - interval '1 day'"
            )
        else:
            rows = self._owner_query(
                "SELECT r.token_hash, r.user_id, (extract(epoch FROM r.expires_at) * 1000)::bigint, r.used_at IS NOT NULL FROM reset_tokens r JOIN users u ON u.id = r.user_id WHERE u.tenant_id = %s AND r.expires_at > now() - interval '1 day'",
                [tenant_id],
            )
        return [{'token': t, 'user_id': u, 'expires_at': int(e), 'used': bool(used)} for t, u, e, used in rows]

    def load_attempts(self, emails: list[str]) -> list[dict[str, Any]]:
        if not emails:
            return []
        rows = self._owner_query(
            """SELECT a.email, (extract(epoch FROM a.at) * 1000)::bigint FROM login_attempts a
                WHERE a.email = ANY(%s::text[]) AND NOT a.succeeded AND a.at > now() - interval '7 days'
                  AND a.at > coalesce((SELECT max(s.at) FROM login_attempts s WHERE s.email = a.email AND s.succeeded), '-infinity')
                ORDER BY a.at, a.id""",
            [emails],
        )
        return [{'email': e, 'at': int(at)} for e, at in rows]

    def foreign_users_by_email(self, emails: list[str], except_tenant: str | None) -> list[dict[str, Any]]:
        if not emails:
            return []
        tm = self.meta.tables['users']
        with self.pools.owner.connection() as c:
            cur = c.execute(tm.select_sql + ' WHERE lower(email) = ANY(%s::text[]) AND tenant_id IS DISTINCT FROM %s ORDER BY _ord', [emails, except_tenant])  # type: ignore[arg-type]
            return [row_from_tuple(tm, t) for t in cur.fetchall()]

    def resolve_session(self, token_hash: str, idle_hours: int) -> dict[str, Any] | None:
        rows = self._owner_query(
            """WITH s AS (
                 SELECT token_hash, user_id, tenant_id, last_seen_at FROM sessions
                  WHERE token_hash = %(h)s AND revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - make_interval(hours => %(idle)s)
               ), touch AS (
                 UPDATE sessions SET last_seen_at = now()
                  WHERE token_hash = %(h)s AND EXISTS (SELECT 1 FROM s WHERE s.last_seen_at < now() - interval '60 seconds')
               )
               SELECT s.token_hash, s.user_id, s.tenant_id, coalesce(u.is_super_admin, false) AS is_super_admin
                 FROM s LEFT JOIN users u ON u.id = s.user_id""",
            {'h': token_hash, 'idle': idle_hours},
        )
        if not rows:
            return None
        h, u, t, sa = rows[0]
        return {'token_hash': h, 'user_id': u, 'tenant_id': t, 'is_super_admin': bool(sa)}

    def user_by_email(self, email: str) -> dict[str, str] | None:
        rows = self._owner_query('SELECT id, tenant_id FROM users WHERE lower(email) = %s LIMIT 1', [email])
        return {'id': rows[0][0], 'tenant_id': rows[0][1]} if rows else None

    def invite_tenant(self, token: str) -> str | None:
        rows = self._owner_query('SELECT tenant_id FROM invites WHERE token = %s LIMIT 1', [token])
        return rows[0][0] if rows else None

    def reset_token_tenant(self, token_hash: str) -> str | None:
        rows = self._owner_query('SELECT u.tenant_id FROM reset_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = %s', [token_hash])
        return rows[0][0] if rows else None

    def idempotency_get(self, tenant_id: str, key: str) -> dict[str, Any] | None:
        rows = self._owner_query(
            "SELECT method, path, status, body::text FROM idempotency_keys WHERE tenant_id = %s AND key = %s AND created_at > now() - interval '24 hours'",
            [tenant_id, key],
        )
        if not rows:
            return None
        m, p, s, b = rows[0]
        return {'method': m, 'path': p, 'status': int(s), 'body': b}

    def idempotency_put(self, rec: IdempotencyRecord, conn: psycopg.Connection | None = None) -> None:
        sql = """INSERT INTO idempotency_keys (tenant_id, key, method, path, status, body) VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                 ON CONFLICT (tenant_id, key) DO UPDATE SET method = EXCLUDED.method, path = EXCLUDED.path, status = EXCLUDED.status, body = EXCLUDED.body, created_at = now()
                 WHERE idempotency_keys.created_at < now() - interval '24 hours'"""
        params = [rec.tenant_id, rec.key, rec.method, rec.path, rec.status, rec.body.decode()]
        if conn is not None:
            conn.execute(sql, params)  # type: ignore[arg-type]
        else:
            with self.pools.owner.connection() as c:
                c.execute(sql, params)  # type: ignore[arg-type]

    def ping(self) -> None:
        self.pools.ping()

    # ---------------- locking ----------------
    def lock_tenant(self, tenant_id: str) -> Lease:
        pool = self.pools.owner
        c = pool.getconn()
        try:
            c.execute('BEGIN')
            c.execute("SELECT set_config('app.tenant_id', %s, true)", [tenant_id])
            c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [tenant_id])
        except Exception:
            try:
                c.execute('ROLLBACK')
            except Exception:  # noqa: BLE001
                pass
            pool.putconn(c)
            raise
        return Lease(tenant_id, c, pool)

    # ---------------- flush ----------------
    def _versions_on(self, c: psycopg.Connection, tid: str) -> dict[str, int]:
        return dict(c.execute('SELECT table_name, version FROM tenant_table_versions WHERE tenant_id = %s', [tid]).fetchall())

    def flush(self, plan: FlushPlan) -> FlushOutcome:
        lease = plan.lease if plan.lease is not None and plan.lease.open and plan.lease.tenant_id == plan.tenant_id else None
        pool = self.pools.owner
        c = lease.conn if lease else pool.getconn()
        committed = False
        try:
            if not lease:
                c.execute('BEGIN')
            tid = plan.tenant_id
            before: dict[str, int] = {}
            if lease:
                before = self._versions_on(c, tid)  # type: ignore[arg-type]
            elif plan.mode == 'global':
                tenants = sorted(
                    {
                        str(r['id'] if ch.table == 'tenants' else r['tenant_id'])
                        for ch in plan.tables
                        for r in [*ch.inserts, *ch.deletes, *(a for _, a in ch.updates)]
                    }
                )
                for t in tenants:
                    c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [t])
            elif tid:
                c.execute("SELECT set_config('app.tenant_id', %s, true)", [tid])
                c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [tid])
                before = self._versions_on(c, tid)
            if plan.mode != 'global' and tid:
                conflicts = [t for t, v in plan.read_set.items() if before.get(t, 0) != v]
                if conflicts:
                    c.execute('ROLLBACK')
                    return FlushOutcome('conflict', tables=conflicts)
            statements: dict[str, int] = {}
            if plan.tables:
                if plan.mode != 'global':
                    c.execute(f'SET LOCAL ROLE {ident(self.app_role)}')  # type: ignore[arg-type]
                for ch in plan.tables:
                    self._apply_deletes(c, ch, statements)
                for ch in plan.tables:
                    self._apply_updates(c, ch, statements)
                for ch in plan.tables:
                    self._apply_inserts(c, ch, statements)
                if plan.mode != 'global':
                    c.execute('RESET ROLE')
            after = self._versions_on(c, tid) if tid and plan.mode != 'global' else {}
            if tid and plan.mode != 'global' and plan.tables and self.change_log:
                self._log_changes(c, tid, plan, before, after)
            self._apply_platform(c, plan)
            if self.queue_emails:
                mails = next((ch.inserts for ch in plan.tables if ch.table == 'email_outbox'), [])
                if mails:
                    c.execute(
                        "INSERT INTO email_deliveries (message_id, tenant_id, status) SELECT m, t, 'pending' FROM unnest(%s::text[], %s::text[]) AS x(m, t) ON CONFLICT DO NOTHING",
                        [[str(m['id']) for m in mails], [str(m['tenant_id']) for m in mails]],
                    )
            if plan.idempotency is not None:
                self.idempotency_put(plan.idempotency, c)
            c.execute('COMMIT')
            committed = True
            return FlushOutcome('ok', versions_before=before, versions_after=after, statements=statements)
        except BaseException:
            try:
                c.execute('ROLLBACK')
            except Exception:  # noqa: BLE001
                pass
            raise
        finally:
            if lease:
                lease.close_after_flush()
            else:
                pool.putconn(c)
            _ = committed

    def _log_changes(self, c: psycopg.Connection, tid: str, plan: FlushPlan, before: dict[str, int], after: dict[str, int]) -> None:
        """table_changes rows (V007): per changed table keyed by `id`, the version step of this flush and the ids"""
        rows = []
        for ch in plan.tables:
            t = ch.table
            if self.meta.tables[t].pk != ['id'] or t == 'tenants':
                continue
            vb, va = before.get(t, 0), after.get(t, 0)
            if va <= vb:
                continue
            ups = [str(r['id']) for r in ch.inserts] + [str(a['id']) for _, a in ch.updates]
            dels = [str(r['id']) for r in ch.deletes]
            rows.append((tid, t, vb, va, ups, dels))
        if rows:
            with c.cursor() as cur:
                cur.executemany(
                    'INSERT INTO table_changes (tenant_id, table_name, version_before, version_after, upserted_ids, deleted_ids) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING',
                    rows,
                )

    def purge_changes(self, keep_seconds: int = 600) -> None:
        if not self.change_log:
            return
        with self.pools.owner.connection() as c:
            c.execute('DELETE FROM table_changes WHERE created_at < now() - make_interval(secs => %s)', [keep_seconds])

    def _count(self, st: dict[str, int], table: str, rowcount: int) -> None:
        if rowcount and rowcount > 0:
            st[table] = st.get(table, 0) + 1

    def _apply_deletes(self, c: psycopg.Connection, ch: TableChange, st: dict[str, int]) -> None:
        if not ch.deletes:
            return
        pk = self.meta.tables[ch.table].pk
        for i in range(0, len(ch.deletes), 5000):
            chunk = ch.deletes[i : i + 5000]
            if len(pk) == 1:
                cur = c.execute(f'DELETE FROM {ident(ch.table)} WHERE {ident(pk[0])} = ANY(%s::text[])', [[str(x[pk[0]]) for x in chunk]])  # type: ignore[arg-type]
            else:
                cols = ', '.join(ident(p) for p in pk)
                arrays = [[str(x[p]) for x in chunk] for p in pk]
                cur = c.execute(f'DELETE FROM {ident(ch.table)} WHERE ({cols}) IN (SELECT * FROM unnest({", ".join(["%s::text[]"] * len(pk))}))', arrays)  # type: ignore[arg-type]
            self._count(st, ch.table, cur.rowcount)

    def _apply_updates(self, c: psycopg.Connection, ch: TableChange, st: dict[str, int]) -> None:
        tm = self.meta.tables[ch.table]
        pk = tm.pk
        for before, after in ch.updates:
            b = values_to_pg(ch.table, before, self.meta)
            a = values_to_pg(ch.table, after, self.meta)
            changed = [k for k in a if k != '_null_override' and a[k] != b[k]]
            null_changed = a['_null_override'] != b['_null_override']
            if not changed and not null_changed:
                continue
            cols = [*changed, '_null_override']
            values = [a[k] for k in cols] + [str(before[p]) for p in pk]
            sets = ', '.join(f'{ident(k)} = %s' for k in cols)
            where = ' AND '.join(f'{ident(p)} = %s' for p in pk)
            cur = c.execute(f'UPDATE {ident(ch.table)} SET {sets} WHERE {where}', values)  # type: ignore[arg-type]
            self._count(st, ch.table, cur.rowcount)

    def _apply_inserts(self, c: psycopg.Connection, ch: TableChange, st: dict[str, int]) -> None:
        if not ch.inserts:
            return
        cols = write_columns(ch.table, self.meta)
        per = max(1, MAX_PARAMS // len(cols))
        head = f'INSERT INTO {ident(ch.table)} ({", ".join(ident(x) for x in cols)}) VALUES '
        tup = '(' + ', '.join(['%s'] * len(cols)) + ')'
        for i in range(0, len(ch.inserts), per):
            chunk = ch.inserts[i : i + per]
            values: list[Any] = []
            for row in chunk:
                v = values_to_pg(ch.table, row, self.meta)
                values.extend(v[x] for x in cols)
            cur = c.execute(head + ', '.join([tup] * len(chunk)), values)  # type: ignore[arg-type]
            self._count(st, ch.table, cur.rowcount)

    def _apply_platform(self, c: psycopg.Connection, plan: FlushPlan) -> None:
        p = plan.platform
        ip = plan.client_ip
        ua = plan.user_agent[:400] if plan.user_agent else None
        for uid, h in p.credential_upserts:
            c.execute(
                """INSERT INTO user_credentials (user_id, password_hash, password_algo, password_changed_at) VALUES (%s, %s, 'scrypt', now())
                   ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_algo = 'scrypt', password_changed_at = now()""",
                [uid, h],
            )
        if p.credential_deletes:
            c.execute('DELETE FROM user_credentials WHERE user_id = ANY(%s::text[])', [p.credential_deletes])
        for s in p.session_inserts:
            c.execute(
                """INSERT INTO sessions (token_hash, user_id, tenant_id, created_at, last_seen_at, expires_at, ip, user_agent)
                   VALUES (%s, %s, %s, %s::timestamptz, now(), %s::timestamptz + make_interval(days => %s), %s, %s)""",
                [s['token_hash'], s['user_id'], s['tenant_id'], s['created_at'], s['created_at'], plan.session_absolute_days, ip, ua],
            )
        if p.session_revokes:
            c.execute('UPDATE sessions SET revoked_at = now() WHERE token_hash = ANY(%s::text[]) AND revoked_at IS NULL', [p.session_revokes])
        for r in p.reset_inserts:
            c.execute(
                'INSERT INTO reset_tokens (token_hash, user_id, expires_at, used_at) VALUES (%s, %s, to_timestamp(%s::double precision / 1000), CASE WHEN %s THEN now() END)',
                [r['token_hash'], r['user_id'], r['expires_at'], bool(r['used'])],
            )
        if p.reset_used:
            c.execute('UPDATE reset_tokens SET used_at = now() WHERE token_hash = ANY(%s::text[]) AND used_at IS NULL', [p.reset_used])
        if p.reset_deletes:
            c.execute('DELETE FROM reset_tokens WHERE token_hash = ANY(%s::text[])', [p.reset_deletes])
        for a in p.attempt_failures:
            c.execute(
                'INSERT INTO login_attempts (email, at, ip, succeeded) VALUES (%s, to_timestamp(%s::double precision / 1000), %s, false)',
                [a['email'], a['at'], ip],
            )
        for e in p.attempt_clears:
            c.execute('INSERT INTO login_attempts (email, at, ip, succeeded) VALUES (%s, now(), %s, true)', [e, ip])


def dumps(v: Any) -> bytes:
    return orjson.dumps(v)
