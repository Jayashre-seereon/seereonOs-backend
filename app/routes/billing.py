"""Port of src/mock/routes/billing.ts — billing (UI-23). Razorpay is simulated: checkout creates a billing invoice and
activates the subscription. A read-only tenant may call these (the router allows /billing)."""

from __future__ import annotations

import random
import re
from typing import Any

from app.catalog import cat
from app.ctx import Ctx, Req, err, find, get_db, insert, log_activity, notify, now_iso, patch, require_action, rows, update, users_with
from app.domain.calendar import add_days, add_months, month_of, today_iso
from app.js import coalesce, date_parse, is_integer, js_max, js_min, js_number, js_round, js_str, js_truthy, locale_key, mark_volatile, now_ms
from app.routes.auth import tenant_of

GST_PCT = cat('mock/routes/billing')['GST_PCT']
PLANS = cat('mock/routes/billing')['PLANS']


def plan(code: Any) -> dict | None:
    return next((p for p in PLANS if p['code'] == code), None)


def _rand36(n: int) -> str:
    """Math.random().toString(36).slice(2, 2 + n) (simulated provider ids)"""
    mark_volatile()
    alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
    return ''.join(random.choice(alphabet) for _ in range(n))


def sub_of(ctx: Ctx) -> dict:
    s = next(iter(rows(ctx, 'subscriptions')), None)
    if s is None:
        s = insert(
            ctx,
            'subscriptions',
            {'plan_code': 'trial', 'status': 'trialing', 'current_period_end': add_days(today_iso(), 14), 'seats': 5, 'razorpay_subscription_id': None},
        )
    return s


def quote(p: dict, seats: Any) -> dict[str, Any]:
    subtotal = p['price_per_user_paise'] * seats
    gst = js_round((subtotal * GST_PCT) / 100)
    return {
        'plan_code': p['code'],
        'seats': seats,
        'unit_paise': p['price_per_user_paise'],
        'subtotal_paise': subtotal,
        'gst_paise': gst,
        'total_paise': subtotal + gst,
    }


def seats_used(ctx: Ctx) -> int:
    now = now_iso()
    return sum(1 for u in rows(ctx, 'users') if u.get('status') == 'active') + sum(
        1 for i in rows(ctx, 'invites') if not i.get('accepted_at') and i['expires_at'] > now
    )


def get_billing(req: Req) -> Any:
    ctx = req.ctx
    require_action(ctx, 'billing.manage', 'Only admins can see billing.')
    t = tenant_of(ctx)
    s = sub_of(ctx)
    p = plan(s.get('plan_code')) or PLANS[0]
    return {
        'tenant': {
            'id': t['id'],
            'name': t['name'],
            'status': t['status'],
            'trial_ends_on': t.get('trial_ends_on'),
            'plan_code': t.get('plan_code'),
            'seats': t.get('seats'),
        },
        'subscription': s,
        'plan': p,
        'plans': PLANS,
        'gst_pct': GST_PCT,
        'seats_used': seats_used(ctx),
        'next_charge': None if s['status'] == 'trialing' else quote(p, s['seats']),
        'invoices': sorted(rows(ctx, 'billing_invoices'), key=lambda x: locale_key(x['issued_on']), reverse=True),
    }


def post_quote(req: Req) -> Any:
    ctx = req.ctx
    require_action(ctx, 'billing.manage')
    p = plan(req.b('plan_code'))
    if not p or p['code'] == 'trial':
        err(422, 'VALIDATION', 'Choose a paid plan.', 'plan_code')
    assert p is not None
    n = js_number(req.b('seats'))
    return quote(p, js_max(1, n if js_truthy(n) else 1))


def checkout(req: Req) -> Any:
    ctx = req.ctx
    require_action(ctx, 'billing.manage', 'Only admins can change the plan.')
    p = plan(req.b('plan_code'))
    if not p or p['code'] == 'trial':
        err(422, 'VALIDATION', 'Choose a paid plan.', 'plan_code')
    assert p is not None
    seats = js_number(req.b('seats'))
    used = seats_used(ctx)
    if not is_integer(seats) or seats < 1:
        err(422, 'VALIDATION', 'Enter the number of seats.', 'seats')
    if seats < used:
        err(409, 'SEATS_BELOW_USAGE', f'You have {used} people and pending invites. Buy at least {used} seats, or deactivate people first.', 'seats')
    if p.get('max_users') and seats > p['max_users']:
        err(409, 'PLAN_LIMIT', f'{p["name"]} supports up to {js_str(p["max_users"])} people. Choose a bigger plan.', 'seats')
    method = 'upi' if req.b('method') == 'upi' else 'card'
    if method == 'upi' and not re.match(r'^[\w.-]+@[a-z]{2,}$', js_str(coalesce(req.b('upi_id'), '')), re.I | re.ASCII):
        err(422, 'VALIDATION', 'Enter a UPI ID like name@okhdfc.', 'upi_id')
    if method == 'card':
        num = re.sub(r'\s', '', js_str(coalesce(req.b('card_number'), '')))
        if not re.fullmatch(r'\d{12,19}', num, re.ASCII):
            err(422, 'VALIDATION', 'Enter a valid card number.', 'card_number')
        if not re.fullmatch(r'(0[1-9]|1[0-2])/\d{2}', js_str(coalesce(req.b('expiry'), '')), re.ASCII):
            err(422, 'VALIDATION', 'Expiry must be MM/YY.', 'expiry')
        if not re.fullmatch(r'\d{3,4}', js_str(coalesce(req.b('cvv'), '')), re.ASCII):
            err(422, 'VALIDATION', 'Enter the CVV.', 'cvv')
    q = quote(p, seats)
    t = tenant_of(ctx)
    s = sub_of(ctx)
    d = get_db()
    seq_no = len(d.billing_invoices) + 101
    today = today_iso()
    if js_truthy(req.b('simulate_failure')):
        inv = insert(
            ctx,
            'billing_invoices',
            {'number': f'SOS-{today[:4]}-{seq_no}', 'period': month_of(today), 'amount_paise': q['total_paise'], 'status': 'failed', 'issued_on': today},
        )
        update(ctx, 'subscriptions', s['id'], {'status': 'trialing' if s['status'] == 'trialing' else 'past_due'})
        for a in users_with(ctx, 'billing.manage'):
            notify(
                ctx,
                a['id'],
                'NTF-16',
                'Payment failed',
                f'We couldn’t charge {"your UPI ID" if method == "upi" else "your card"} for {p["name"]}. Update the payment method to keep the workspace active.',
                '/billing',
            )
        log_activity(ctx, 'billing', inv['id'], 'payment_failed', f'Payment failed for {p["name"]} × {js_str(seats)}')
        err(402, 'PAYMENT_FAILED', 'The bank declined this payment. Try another card or UPI ID. Nothing was charged.')
    base = s['current_period_end'] if s['current_period_end'] > today and s['status'] == 'active' else today
    end = add_months(base, 1)
    inv = insert(
        ctx,
        'billing_invoices',
        {'number': f'SOS-{today[:4]}-{seq_no}', 'period': month_of(today), 'amount_paise': q['total_paise'], 'status': 'paid', 'issued_on': today},
    )
    update(
        ctx,
        'subscriptions',
        s['id'],
        {
            'plan_code': p['code'],
            'status': 'active',
            'seats': seats,
            'current_period_end': end,
            'razorpay_subscription_id': coalesce(s.get('razorpay_subscription_id'), 'sub_' + _rand36(10)),
        },
    )
    t = patch('tenants', t, {'status': 'active', 'plan_code': p['code'], 'seats': seats, 'trial_ends_on': None, 'version': t['version'] + 1})
    log_activity(ctx, 'billing', inv['id'], 'checkout', f'Paid {p["name"]} × {js_str(seats)} seats')
    return {'invoice': inv, 'tenant': t, 'payment_id': 'pay_' + _rand36(12), 'method': method}


def change_seats(req: Req) -> Any:
    ctx = req.ctx
    require_action(ctx, 'billing.manage', 'Only admins can change seats.')
    t = tenant_of(ctx)
    s = sub_of(ctx)
    if s['status'] == 'trialing' or t['status'] != 'active':
        err(409, 'PLAN_REQUIRED', 'Choose a paid plan first; seats are set during checkout.')
    seats = js_number(req.b('seats'))
    used = seats_used(ctx)
    p = plan(s.get('plan_code'))
    assert p is not None
    if not is_integer(seats) or seats < 1:
        err(422, 'VALIDATION', 'Enter the number of seats.', 'seats')
    if seats < used:
        err(409, 'SEATS_BELOW_USAGE', f'You have {used} people and pending invites. Keep at least {used} seats.', 'seats')
    if p.get('max_users') and seats > p['max_users']:
        err(409, 'PLAN_LIMIT', f'{p["name"]} supports up to {js_str(p["max_users"])} people. Upgrade the plan.', 'seats')
    added = seats - s['seats']
    invoice = None
    if added > 0:
        # prorated for the rest of the period
        days_left = js_max(1, js_round((date_parse(s['current_period_end']) - now_ms()) / 86400000))
        sub = js_round((p['price_per_user_paise'] * added * js_min(30, days_left)) / 30)
        today = today_iso()
        invoice = insert(
            ctx,
            'billing_invoices',
            {
                'number': f'SOS-{today[:4]}-{len(get_db().billing_invoices) + 101}',
                'period': month_of(today),
                'amount_paise': sub + js_round((sub * GST_PCT) / 100),
                'status': 'paid',
                'issued_on': today,
            },
        )
    update(ctx, 'subscriptions', s['id'], {'seats': seats})
    t = patch('tenants', tenant_of(ctx), {'seats': seats, 'version': t['version'] + 1})
    log_activity(ctx, 'billing', s['id'], 'seats', f'Seats changed {js_str(s["seats"])} → {js_str(seats)}')
    return {'tenant': t, 'invoice': invoice}


def get_invoice(req: Req) -> Any:
    require_action(req.ctx, 'billing.manage')
    return find(req.ctx, 'billing_invoices', req.params['id'], 'Invoice')


def register(r: Any) -> None:
    r.get('/billing', get_billing)
    r.post('/billing/quote', post_quote)
    r.post('/billing/checkout', checkout)
    r.post('/billing/seats', change_seats)
    r.get('/billing/invoices/:id', get_invoice)
