"""Process-wide singletons of the running API (set by app.main.create_app): the runtime and its configuration."""

from __future__ import annotations

from typing import Any

RUNTIME: Any = None


def runtime() -> Any:
    if RUNTIME is None:
        raise RuntimeError('the API runtime is not initialised')
    return RUNTIME


def reset_db() -> None:
    """resetDb() of src/mock/server.ts on the server: POST /demo/reset (DEMO_MODE only) — atomic in-place reseed,
    then this process's cache is dropped (other processes see the bumped table versions)."""
    from app.db.uow import maybe_scope
    from app.errors import ApiError

    sc = maybe_scope()
    rt = sc.rt if sc is not None else runtime()  # the runtime serving this request (several apps may live in one process)
    if rt.demo_reset is None:
        raise ApiError(404, 'ROUTE_NOT_FOUND', 'No route for POST /demo/reset')
    rt.demo_reset()
    if rt.cache is not None:
        rt.cache.clear()
    if rt.memo is not None:
        rt.memo.clear()
