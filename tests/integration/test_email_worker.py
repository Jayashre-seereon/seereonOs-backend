"""Email outbox: with SMTP configured the flush queues a delivery in the same transaction and the worker sends it
(claim with SKIP LOCKED, retries with back-off, 'failed' after 5 attempts)."""

from __future__ import annotations

import psycopg
import pytest

from app.ctx import build_ctx
from app.engine.email import render_template, send_email
from app.workers.email import EmailWorker
from tests.conftest import OWNER

pytestmark = pytest.mark.usefixtures('fresh')


class FakeMailer:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[tuple[str, str, str]] = []
        self.fail = fail

    def send(self, to: str, subject: str, text: str) -> None:
        if self.fail:
            raise OSError('smtp down')
        self.sent.append((to, subject, text))


def test_render_template():
    assert render_template('Hi {{ name }}, {{x}}{{missing}}!', {'name': 'Asha', 'x': 0, 'missing': None}) == 'Hi Asha, 0!'


def test_outbox_delivery(app):  # type: ignore[no-untyped-def]
    rt = app.state.rt
    rt.backend.queue_emails = True
    try:

        def fn(s):  # type: ignore[no-untyped-def]
            ctx = build_ctx(s.find_by('users', 'id', 'u_santosh'), 'tn_seereon', {})
            return send_email(
                ctx,
                'task_assigned',
                {'email': 'hritesh@seereon.co.in', 'user_id': 'u_hritesh'},
                {'employee_name': 'Hritesh', 'manager_name': 'Santosh', 'task_title': 'Ship it', 'due_date': '2026-10-20'},
                {'entity': 'task', 'id': 't1'},
            )

        msg = rt.run_scoped('tenant', 'tn_seereon', fn, is_write=True)
    finally:
        rt.backend.queue_emails = False
    assert msg['subject'] == 'New task: Ship it' and 'Seereon' in msg['body'] and msg['status'] == 'sent'
    with psycopg.connect(OWNER, autocommit=True) as c:
        assert c.execute('SELECT status FROM email_deliveries WHERE message_id = %s', [msg['id']]).fetchone()[0] == 'pending'
    w = EmailWorker(rt.backend.pools.owner, FakeMailer(fail=True))  # type: ignore[arg-type]
    w.tick()
    with psycopg.connect(OWNER, autocommit=True) as c:
        st, attempts, last = c.execute('SELECT status, attempts, last_error FROM email_deliveries WHERE message_id = %s', [msg['id']]).fetchone()
        assert (st, attempts, last) == ('pending', 1, 'smtp down')
        c.execute("UPDATE email_deliveries SET updated_at = now() - interval '10 minutes' WHERE message_id = %s", [msg['id']])
    ok = FakeMailer()
    EmailWorker(rt.backend.pools.owner, ok).tick()  # type: ignore[arg-type]
    assert ok.sent == [('hritesh@seereon.co.in', 'New task: Ship it', msg['body'])]
    with psycopg.connect(OWNER, autocommit=True) as c:
        assert c.execute('SELECT status FROM email_deliveries WHERE message_id = %s', [msg['id']]).fetchone()[0] == 'sent'
