"""SMTP delivery of the email outbox — port of server/src/email.ts.

The shared code renders and stores every message in email_outbox; with SMTP_URL set the flush also queues a
`pending` row in email_deliveries (same transaction) and this worker sends pending messages (claimed with SKIP LOCKED,
so every worker process / instance can run it) with retries (back-off 1, 2, 4, 8 minutes; 5 attempts). Without
SMTP_URL nothing is queued and nothing is sent — the outbox stays the record."""

from __future__ import annotations

import logging
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Any
from urllib.parse import unquote, urlparse

MAX_ATTEMPTS = 5
log = logging.getLogger('seereonos.email')


class Mailer:
    def __init__(self, smtp_url: str, mail_from: str) -> None:
        self.url = urlparse(smtp_url)
        self.mail_from = mail_from

    def send(self, to: str, subject: str, text: str) -> None:
        u = self.url
        secure = u.scheme == 'smtps'
        port = u.port or (465 if secure else 587)
        host = u.hostname or 'localhost'
        msg = EmailMessage()
        msg['From'] = self.mail_from
        msg['To'] = to
        msg['Subject'] = subject
        msg.set_content(text)
        ctx = ssl.create_default_context()
        if secure:
            s: smtplib.SMTP = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)
        else:
            s = smtplib.SMTP(host, port, timeout=30)
        try:
            s.ehlo()
            if not secure and s.has_extn('starttls'):
                s.starttls(context=ctx)
                s.ehlo()
            if u.username:
                s.login(unquote(u.username), unquote(u.password or ''))
            s.send_message(msg, from_addr=parseaddr(self.mail_from)[1] or None)
        finally:
            try:
                s.quit()
            except Exception:  # noqa: BLE001
                pass


def create_mailer(smtp_url: str | None, mail_from: str) -> Mailer | None:
    return Mailer(smtp_url, mail_from) if smtp_url else None


class EmailWorker:
    def __init__(self, pool: Any, mailer: Mailer, interval_s: float = 5.0) -> None:
        self.pool = pool
        self.mailer = mailer
        self.interval = interval_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._busy = threading.Lock()

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, name='email-worker', daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            self.tick()

    def tick(self) -> None:
        if not self._busy.acquire(blocking=False):
            return
        try:
            self._drain()
        except Exception:  # noqa: BLE001
            log.exception('email worker failed')
        finally:
            self._busy.release()

    def _drain(self) -> None:
        with self.pool.connection() as c:
            claimed = c.execute(
                """UPDATE email_deliveries d SET attempts = d.attempts + 1, updated_at = now()
                    WHERE d.message_id IN (
                      SELECT message_id FROM email_deliveries
                       WHERE status = 'pending' AND attempts < %s AND updated_at <= now() - make_interval(mins => CASE WHEN attempts = 0 THEN 0 ELSE power(2, attempts - 1)::int END)
                       ORDER BY updated_at LIMIT 20 FOR UPDATE SKIP LOCKED)
                    RETURNING d.message_id, d.attempts""",
                [MAX_ATTEMPTS],
            ).fetchall()
        for message_id, attempts in claimed:
            with self.pool.connection() as c:
                m = c.execute('SELECT "to", subject, body FROM email_outbox WHERE id = %s', [message_id]).fetchone()
                if not m:
                    c.execute(
                        "UPDATE email_deliveries SET status = 'skipped', last_error = 'message deleted', updated_at = now() WHERE message_id = %s", [message_id]
                    )
                    continue
            try:
                self.mailer.send(m[0], m[1], m[2])
                with self.pool.connection() as c:
                    c.execute("UPDATE email_deliveries SET status = 'sent', last_error = NULL, updated_at = now() WHERE message_id = %s", [message_id])
            except Exception as e:  # noqa: BLE001
                failed = attempts >= MAX_ATTEMPTS
                with self.pool.connection() as c:
                    c.execute(
                        'UPDATE email_deliveries SET status = %s, last_error = %s, updated_at = now() WHERE message_id = %s',
                        ['failed' if failed else 'pending', str(e)[:500], message_id],
                    )
                log.warning('email delivery failed', extra={'message_id': message_id, 'attempts': attempts})
