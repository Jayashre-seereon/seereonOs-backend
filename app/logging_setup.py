"""Structured JSON logging (pino-compatible fields: level, time, msg, reqId, req, res, responseTime) with redaction of
secrets: reset / invite tokens in URLs, and passwords / tokens / data URLs never reach the logs."""

from __future__ import annotations

import logging
import os
import re
import socket
import sys
from typing import Any

import orjson

LEVELS = {
    'trace': 5,
    'debug': logging.DEBUG,
    'info': logging.INFO,
    'warn': logging.WARNING,
    'warning': logging.WARNING,
    'error': logging.ERROR,
    'fatal': logging.CRITICAL,
}
PINO = {logging.DEBUG: 20, logging.INFO: 30, logging.WARNING: 40, logging.ERROR: 50, logging.CRITICAL: 60}
REDACT_KEYS = frozenset({'password', 'current', 'next', 'token', 'data_url', 'temp_password', 'authorization', 'cookie', 'idempotency-key', 'mfa_token'})
_STD = frozenset(logging.LogRecord('x', 0, '', 0, '', None, None).__dict__) | {'message', 'asctime'}


def redact_url(url: str) -> str:
    """paths whose last segment is a secret (reset / invite tokens) are never logged as-is"""
    url = re.sub(r'(/auth/reset-info/|/invites/)[^/?#]+', r'\1[redacted]', url)
    return re.sub(r'([?&](token|mfa_token)=)[^&#]*', r'\1[redacted]', url, flags=re.I)


def redact(v: Any, depth: int = 0) -> Any:
    if depth > 6:
        return v
    if isinstance(v, dict):
        return {k: '[redacted]' if str(k).lower() in REDACT_KEYS else redact(x, depth + 1) for k, x in v.items()}
    if isinstance(v, list):
        return [redact(x, depth + 1) for x in v]
    return v


class JsonFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__()
        self.host = socket.gethostname()
        self.pid = os.getpid()

    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {'level': PINO.get(record.levelno, 30), 'time': int(record.created * 1000), 'pid': self.pid, 'hostname': self.host}
        for k, v in record.__dict__.items():
            if k not in _STD:
                out[k] = redact(v)
        out['msg'] = record.getMessage()
        if record.exc_info:
            out['err'] = {
                'type': record.exc_info[0].__name__ if record.exc_info[0] else None,
                'message': str(record.exc_info[1]),
                'stack': self.formatException(record.exc_info),
            }
        return orjson.dumps(out, default=str).decode()


def configure_logging(level: str = 'info') -> None:
    root = logging.getLogger('seereonos')
    root.handlers.clear()
    root.propagate = False
    if level == 'silent':
        root.setLevel(logging.CRITICAL + 10)
        return
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root.addHandler(h)
    root.setLevel(LEVELS.get(level, logging.INFO))
