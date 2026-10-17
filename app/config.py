"""Environment configuration (port of server/src/config.ts), validated once at startup with clear messages.

Same variable names as the Node reference. APP_ENV (development | production | test) replaces NODE_ENV; NODE_ENV is
still read when APP_ENV is not set. Production refuses: DEMO_MODE=true, the development MFA key / CHANGE_ME
placeholders, and the default database passwords.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

DEV_MFA_KEY = 'development-only-mfa-key--never-use-in-production--0000'


class ConfigError(Exception):
    pass


def _load_local_env() -> None:
    """Load backend/.env for local development; real process env vars always take precedence."""
    if os.environ.get('APP_ENV', os.environ.get('NODE_ENV', 'development')) != 'development':
        return
    env_path = Path(__file__).resolve().parents[1] / '.env'
    try:
        lines = env_path.read_text(encoding='utf-8-sig').splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        key, sep, value = line.partition('=')
        key = key.strip()
        if not sep or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ[key] = value


@dataclass(frozen=True)
class Config:
    env: str = 'development'
    host: str = '0.0.0.0'
    port: int = 8000
    database_url: str = 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos'
    database_app_url: str = 'postgres://seereon_app:seereon_app@localhost:5432/seereonos'
    pool_max: int = 10
    app_pool_max: int = 20
    cors_origins: tuple[str, ...] = ()
    trust_proxy: bool = False
    demo_mode: bool = False
    smtp_url: str | None = None
    mail_from: str = 'SeereonOS <no-reply@seereonos.com>'
    app_url: str = 'http://localhost:8000'
    static_dir: str | None = 'dist'
    log_level: str = 'info'
    tenant_cache_max: int = 50
    tenant_cache_max_mb: int = 512
    rate_limit_global: int = 600
    rate_limit_auth: int = 10
    session_idle_hours: int = 12
    session_absolute_days: int = 30
    shutdown_grace_ms: int = 10000
    mfa_encryption_key: str = DEV_MFA_KEY
    mfa_encryption_keys_previous: tuple[str, ...] = ()
    mfa_key_is_default: bool = True
    security_events_retention_days: int = 400
    # Python-specific
    seed_json: str | None = None  # demo seed exported by backend/tools/export_seed.mjs
    freeze_rows: bool = True  # deep-freeze cached rows (development/test): illegal in-place mutations fail loudly
    statement_timeout_ms: int = 30000
    # performance (PERFORMANCE.md "Tuning knobs")
    memo_max_mb: int = 64  # response memo per worker (0 = off)
    memo_ttl_s: int = 60
    memo_verify: bool = False  # every memo hit is also computed and compared (tests / parity)
    request_threads: int = 4  # handler threads per worker process (CPU-bound handlers: more only adds GIL contention)
    scrypt_concurrency: int = 1  # password hashes computed at once per worker (scrypt: ~100 ms CPU + 32 MB each)
    pg_prepare_threshold: int | None = 5  # server-side prepared statements after N runs; None (PG_PREPARE_THRESHOLD=off) for PgBouncer < 1.21
    delta_max_rows: int = 2000  # incremental cache refresh from the change log up to this many changed rows (0 = off)
    write_threads: int = 2  # handler threads per worker for non-GET requests (separate from REQUEST_THREADS: reads never wait behind writes)
    lease_mode: str = 'adaptive'  # write requests take the tenant lease first: adaptive (after a lost race) | optimistic | pessimistic
    contention_window_s: int = 10
    extra: dict = field(default_factory=dict)

    @property
    def production(self) -> bool:
        return self.env == 'production'


def _int(env: dict, key: str, default: int, lo: int = 0, hi: int = 2**53 - 1) -> int:
    raw = env.get(key)
    if raw is None or raw == '':
        return default
    from app.js import is_integer, js_number

    n = js_number(raw)  # Number(raw) like the reference: ' 12 ', '1e3' are accepted
    if not is_integer(n) or n < lo or n > hi:
        raise ConfigError(f'{key} must be an integer between {lo} and {hi} (got "{raw}").')
    return int(n)


def _bool(env: dict, key: str, default: bool) -> bool:
    raw = env.get(key)
    if raw is None or raw == '':
        return default
    if re.fullmatch(r'(1|true|yes|on)', raw, re.I):
        return True
    if re.fullmatch(r'(0|false|no|off)', raw, re.I):
        return False
    raise ConfigError(f'{key} must be true or false (got "{raw}").')


def _url(env: dict, key: str, default: str | None, schemes: tuple[str, ...]) -> str | None:
    raw = env.get(key) or default
    if not raw:
        return None
    try:
        u = urlparse(raw)
        ok = u.scheme in schemes and bool(u.netloc or u.path)
    except ValueError:
        ok = False
    if not ok:
        shown = re.sub(r'//[^@/]*@', '//***@', raw)
        raise ConfigError(f'{key} must be a {" or ".join(s + ":" for s in schemes)} URL (got "{shown}").')
    return raw


def load_config(env: dict | None = None) -> Config:
    if env is None:
        _load_local_env()
    env = dict(os.environ if env is None else env)
    errors: list[str] = []

    def get(f, fallback):  # type: ignore[no-untyped-def]
        try:
            return f()
        except ConfigError as e:
            errors.append(str(e))
            return fallback

    app_env = env.get('APP_ENV') or env.get('NODE_ENV') or 'development'
    if app_env not in ('development', 'production', 'test'):
        errors.append(f'APP_ENV must be development, production or test (got "{app_env}").')
    pg = ('postgres', 'postgresql')
    mfa_key = env.get('MFA_ENCRYPTION_KEY') or DEV_MFA_KEY
    static = env.get('STATIC_DIR')
    cfg = Config(
        env=app_env,
        host=env.get('HOST') or '0.0.0.0',
        port=get(lambda: _int(env, 'PORT', 8000, 1, 65535), 8000),
        database_url=get(lambda: _url(env, 'DATABASE_URL', 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos', pg), ''),
        database_app_url=get(lambda: _url(env, 'DATABASE_APP_URL', 'postgres://seereon_app:seereon_app@localhost:5432/seereonos', pg), ''),
        pool_max=get(lambda: _int(env, 'PG_POOL_MAX', 10, 1, 500), 10),
        app_pool_max=get(lambda: _int(env, 'PG_APP_POOL_MAX', 20, 1, 500), 20),
        cors_origins=tuple(s.strip() for s in (env.get('CORS_ORIGINS') or '').split(',') if s.strip()),
        trust_proxy=get(lambda: _bool(env, 'TRUST_PROXY', False), False),
        demo_mode=get(lambda: _bool(env, 'DEMO_MODE', False), False),
        smtp_url=get(lambda: _url(env, 'SMTP_URL', None, ('smtp', 'smtps')), None),
        mail_from=env.get('MAIL_FROM') or 'SeereonOS <no-reply@seereonos.com>',
        app_url=get(lambda: _url(env, 'APP_URL', 'http://localhost:8000', ('http', 'https')), 'http://localhost:8000'),
        static_dir=None if static == '' else (static or 'dist'),
        log_level=env.get('LOG_LEVEL') or ('silent' if app_env == 'test' else 'info'),
        tenant_cache_max=get(lambda: _int(env, 'TENANT_CACHE_MAX', 50, 0, 100000), 50),
        tenant_cache_max_mb=get(lambda: _int(env, 'TENANT_CACHE_MAX_MB', 512, 0, 1_000_000), 512),
        rate_limit_global=get(lambda: _int(env, 'RATE_LIMIT_GLOBAL', 600, 1), 600),
        rate_limit_auth=get(lambda: _int(env, 'RATE_LIMIT_AUTH', 10, 1), 10),
        session_idle_hours=get(lambda: _int(env, 'SESSION_IDLE_HOURS', 12, 1, 24 * 365), 12),
        session_absolute_days=get(lambda: _int(env, 'SESSION_ABSOLUTE_DAYS', 30, 1, 3650), 30),
        shutdown_grace_ms=get(lambda: _int(env, 'SHUTDOWN_GRACE_MS', 10000, 0, 600000), 10000),
        mfa_encryption_key=mfa_key,
        mfa_encryption_keys_previous=tuple(s.strip() for s in (env.get('MFA_ENCRYPTION_KEY_PREVIOUS') or '').split(',') if s.strip()),
        mfa_key_is_default=not env.get('MFA_ENCRYPTION_KEY'),
        security_events_retention_days=get(lambda: _int(env, 'SECURITY_EVENTS_RETENTION_DAYS', 400, 1, 3650), 400),
        seed_json=env.get('SEED_JSON') or None,
        freeze_rows=get(lambda: _bool(env, 'FREEZE_ROWS', app_env != 'production'), app_env != 'production'),
        statement_timeout_ms=get(lambda: _int(env, 'STATEMENT_TIMEOUT_MS', 30000, 100, 3_600_000), 30000),
        memo_max_mb=get(lambda: _int(env, 'MEMO_MAX_MB', 64, 0, 100_000), 64),
        memo_ttl_s=get(lambda: _int(env, 'MEMO_TTL_S', 60, 1, 60), 60),
        memo_verify=get(lambda: _bool(env, 'MEMO_VERIFY', False), False),
        request_threads=get(lambda: _int(env, 'REQUEST_THREADS', 4, 1, 256), 4),
        scrypt_concurrency=get(lambda: _int(env, 'SCRYPT_CONCURRENCY', 1, 1, 64), 1),
        pg_prepare_threshold=None if (env.get('PG_PREPARE_THRESHOLD') or '').strip().lower() in ('off', 'none', 'never') else get(lambda: _int(env, 'PG_PREPARE_THRESHOLD', 5, 0, 1000), 5),
        delta_max_rows=get(lambda: _int(env, 'DELTA_MAX_ROWS', 2000, 0, 1_000_000), 2000),
        write_threads=get(lambda: _int(env, 'WRITE_THREADS', 2, 1, 256), 2),
        lease_mode=env.get('LEASE_MODE') or 'adaptive',
        contention_window_s=get(lambda: _int(env, 'CONTENTION_WINDOW_S', 10, 0, 3600), 10),
    )
    if cfg.lease_mode not in ('adaptive', 'optimistic', 'pessimistic'):
        errors.append(f'LEASE_MODE must be adaptive, optimistic or pessimistic (got "{cfg.lease_mode}").')
    if len(cfg.mfa_encryption_key) < 32:
        errors.append('MFA_ENCRYPTION_KEY must be at least 32 characters (e.g. openssl rand -base64 48).')
    if cfg.production:
        if cfg.mfa_key_is_default or re.search('CHANGE_ME', cfg.mfa_encryption_key, re.I):
            errors.append('MFA_ENCRYPTION_KEY is required when APP_ENV=production and must not be the placeholder (e.g. openssl rand -base64 48).')
        for k, v in (('DATABASE_URL', cfg.database_url), ('DATABASE_APP_URL', cfg.database_app_url)):
            if re.search(r'CHANGE_ME|://seereon_owner:seereon_owner@|://seereon_app:seereon_app@', v or ''):
                errors.append(f'{k} still uses a default/placeholder password; set a real one in production.')
    for o in cfg.cors_origins:
        if not re.fullmatch(r'https?://[^/]+', o):
            errors.append(f'CORS_ORIGINS entries must be origins like https://app.example.com (got "{o}").')
    if cfg.production and cfg.demo_mode:
        errors.append('DEMO_MODE=true is not allowed when APP_ENV=production.')
    if errors:
        raise ConfigError('Invalid configuration:\n  - ' + '\n  - '.join(errors))
    return cfg


_CFG: Config | None = None


def settings() -> Config:
    """the process configuration (loaded on first use)"""
    global _CFG
    if _CFG is None:
        _CFG = load_config()
    return _CFG


def set_settings(cfg: Config | None) -> None:
    """tests / app factory: install a configuration"""
    global _CFG
    _CFG = cfg
