"""Fixed-window rate-limit counters and the security_events audit trail — port of server/src/security/store.ts.

PgSecurityStore keeps both in PostgreSQL (owner pool; V006 tables) so N instances / worker processes enforce ONE
limit. MemorySecurityStore is the single-process twin for unit tests."""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RateResult:
    allowed: bool
    hits: int
    limit: int
    retry_after: int  # seconds until the window ends


@dataclass
class SecurityEvent:
    event: str
    outcome: str  # success | failure | blocked | info
    tenant_id: str | None = None
    user_id: str | None = None
    email: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    request_id: str | None = None
    detail: dict[str, Any] | None = None


def bucket_of(name: str, key: str) -> str:
    return hashlib.sha256((name + '\0' + key).encode('utf-8', 'surrogatepass')).hexdigest()


def _clip(s: Any, n: int) -> str | None:
    return None if s is None else str(s)[:n]


class PgSecurityStore:
    def __init__(self, pool: Any, retention_days: int = 400, on_error: Callable[[Exception, str], None] | None = None) -> None:
        self.pool = pool
        self.retention_days = retention_days
        self.on_error = on_error

    def hit(self, name: str, key: str, limit: int, window_sec: int) -> RateResult:
        # one statement; the window start comes from the database clock (identical on every instance); the upsert is
        # atomic, so concurrent hits from several instances are all counted
        with self.pool.connection() as c:
            hits, ttl = c.execute(
                """WITH w AS (SELECT to_timestamp(floor(extract(epoch FROM now()) / %(w)s::int) * %(w)s::int) AS start)
                   INSERT INTO rate_limits AS r (bucket, window_start, hits, expires_at)
                   SELECT %(b)s, w.start, 1, w.start + make_interval(secs => %(w)s::int) FROM w
                   ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
                   RETURNING hits, ceil(extract(epoch FROM (expires_at - now())))::int AS ttl""",
                {'b': bucket_of(name, key), 'w': window_sec},
            ).fetchone()  # type: ignore[misc]
        hits = int(hits)
        return RateResult(hits <= limit, hits, limit, max(1, int(ttl)))

    def log(self, e: SecurityEvent) -> None:
        try:
            with self.pool.connection() as c:
                c.execute(
                    'INSERT INTO security_events (event, outcome, tenant_id, user_id, email, ip, user_agent, request_id, detail) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                    [
                        _clip(e.event, 64),
                        e.outcome,
                        _clip(e.tenant_id, 64),
                        _clip(e.user_id, 64),
                        _clip(e.email.lower() if e.email else None, 254),
                        _clip(e.ip, 64),
                        _clip(e.user_agent, 300),
                        _clip(e.request_id, 128),
                        json.dumps(e.detail) if e.detail else None,
                    ],
                )
        except Exception as err:  # noqa: BLE001
            if self.on_error:
                self.on_error(err, 'security_events insert')

    def mfa_owner(self, id_: str) -> dict[str, str] | None:
        with self.pool.connection() as c:
            r = c.execute("SELECT user_id, tenant_id FROM pending_tokens WHERE id = %s AND kind = 'mfa_login'", [id_]).fetchone()
        return {'user_id': str(r[0]), 'tenant_id': str(r[1])} if r else None

    def sweep(self) -> None:
        try:
            with self.pool.connection() as c:
                c.execute('DELETE FROM rate_limits WHERE expires_at < now()')
                c.execute('DELETE FROM security_events WHERE at < now() - make_interval(days => %s::int)', [self.retention_days])
        except Exception as err:  # noqa: BLE001
            if self.on_error:
                self.on_error(err, 'security sweep')


class MemorySecurityStore:
    def __init__(self, mfa_owner: Callable[[str], dict | None] | None = None) -> None:
        self.events: list[dict[str, Any]] = []
        self.buckets: dict[str, dict[str, int]] = {}
        self._lock = threading.Lock()
        self._mfa_owner = mfa_owner

    def hit(self, name: str, key: str, limit: int, window_sec: int) -> RateResult:
        now = time.time() * 1000
        start = math.floor(now / 1000 / window_sec) * window_sec * 1000
        b = bucket_of(name, key)
        with self._lock:
            cur = self.buckets.get(b)
            row = cur if cur and cur['start'] == start else {'start': start, 'hits': 0}
            row['hits'] += 1
            self.buckets[b] = row
        return RateResult(row['hits'] <= limit, row['hits'], limit, max(1, math.ceil((start + window_sec * 1000 - now) / 1000)))

    def log(self, e: SecurityEvent) -> None:
        self.events.append({**e.__dict__, 'at': time.time()})

    def mfa_owner(self, id_: str) -> dict[str, str] | None:
        return self._mfa_owner(id_) if self._mfa_owner else None

    def sweep(self) -> None:
        now = time.time() * 1000
        with self._lock:
            for k in [k for k, v in self.buckets.items() if v['start'] < now - 3600_000]:
                del self.buckets[k]


@dataclass
class LocalLimiter:
    """per-process fixed-window limiter for the global per-token/IP limit (the Node reference keeps it per instance in
    memory too; with N workers the effective limit is up to N × the value — documented)"""

    max: int
    window_sec: int = 60
    _b: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def hit(self, key: str) -> tuple[bool, int, int]:
        """(exceeded, remaining, ttl seconds)"""
        now = time.time()
        with self._lock:
            b = self._b.get(key)
            if b is None or now >= b[1]:
                b = [0, now + self.window_sec]
                self._b[key] = b
            b[0] += 1
            if len(self._b) > 100_000:
                for k in [k for k, v in self._b.items() if now >= v[1]]:
                    del self._b[k]
            return b[0] > self.max, max(0, self.max - int(b[0])), max(0, math.ceil(b[1] - now))
