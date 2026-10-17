// Golden vectors for app/routes/invoices.py (port of src/mock/routes/invoices.ts):
//   TZ=Asia/Kolkata node backend/tests/golden/gen/invoices.mjs -> vectors/invoices.json.gz
// (seed: vectors/engine_seed.json.gz). Two parts:
//   1. pure GST maths, exhaustively: computeTotals over a deterministic matrix of lines (qty / rate / discount / GST
//      rate incl. fractional, junk and boundary values) × tax mode × reverse charge; amountInWords / indianWords over
//      every magnitude; taxModeOf, stateCodeOf, stateName, clientParty, defaultInvoiceSettings, normalise.
//   2. scenarios on the full seed: sequences of route calls (and the legacy exports raiseMilestoneInvoice /
//      recordRevenuePayment) on a fresh copy, recording each response, the warnings and the rows written. The Python
//      test replays the same concrete calls (ids are deterministic on both sides).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { VECTORS, install, loadTs, makeCtx, norm, safe, writeGz } from './_engine.mjs'

// a frozen clock: every nowISO() is the same instant, so sorts on timestamps keep insertion order on both sides
const RealDate = Date
const FIXED = RealDate.parse('2026-10-15T06:30:00.000Z')
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (a.length) super(...a)
    else super(FIXED)
  }
  static now() {
    return FIXED
  }
}
const M = await loadTs('invoices', `export * as inv from '@/mock/routes/invoices'\n`)
const { server, inv } = M
const seed = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(VECTORS, 'engine_seed.json.gz'))).toString('utf8'))
const T = seed.tables

/* ---------------- 1. pure ---------------- */
let rnd = 12345
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rand() * a.length)]
const QTY = [1, 1, 2, 3, 0.5, 1.5, 3.333, 7.25, 12, 0.1, 160, 0, -1, '2', 'abc', null, undefined, true, 1e-7, 22.75]
const RATE = [0, 1, 49, 50, 99, 100, 101, 149, 150, 12345, 100050, 150000, 999999, 1000000007, 33.5, 2.5, '1500', null, 15000000, 105000000, 6690600, 10000001]
const DISC = [0, 0, 0, 5, 10, 12.5, 33.33, 50, 99.99, 100, 150, -10, null, 'x', '7.5', undefined]
const GSTR = [0, 5, 12, 18, 18, 18, 28, 3, '18', null, undefined]
const MODES = ['intra', 'inter', 'export']
const totals = []
for (let n = 0; n < 2400; n++) {
  const k = 1 + Math.floor(rand() * 4)
  const lines = Array.from({ length: k }, (_, i) => {
    const l = { id: `l${i + 1}`, qty: pick(QTY), rate_paise: pick(RATE), discount_pct: pick(DISC), gst_rate: pick(GSTR) }
    if (rand() < 0.05) delete l.id
    for (const key of ['qty', 'rate_paise', 'discount_pct', 'gst_rate']) if (l[key] === undefined) delete l[key]
    return l
  })
  const mode = MODES[n % 3]
  const rc = n % 7 === 0
  totals.push({ lines, mode, rc, r: safe(() => inv.computeTotals(lines, mode, rc)) })
}
// round-off boundaries: before_round ending in 49 / 50 / 51 paise, single lines
for (const base of [0, 1, 49, 50, 51, 99, 100, 149, 150, 151, 9950, 9949, 123456749, 123456750])
  for (const mode of MODES) {
    const lines = [{ id: 'l1', qty: 1, rate_paise: base, discount_pct: 0, gst_rate: 0 }]
    totals.push({ lines, mode, rc: false, r: safe(() => inv.computeTotals(lines, mode, false)) })
  }
// CGST/SGST half-paise splits (odd taxable × rate / 200)
for (const taxable of [1, 3, 11, 101, 111, 1001, 9999, 12345, 33333, 55555, 100001])
  for (const rate of [5, 12, 18, 28])
    for (const mode of MODES) {
      const lines = [{ id: 'a', qty: 1, rate_paise: taxable, discount_pct: 0, gst_rate: rate }, { id: 'b', qty: 3, rate_paise: taxable, discount_pct: 33.33, gst_rate: rate }]
      totals.push({ lines, mode, rc: false, r: safe(() => inv.computeTotals(lines, mode, false)) })
      totals.push({ lines, mode, rc: true, r: safe(() => inv.computeTotals(lines, mode, true)) })
    }

const WORDS = [0, 1, 5, 9, 10, 11, 19, 20, 21, 50, 99, 100, 101, 110, 119, 120, 199, 999, 1000, 1001, 1010, 1099, 9999, 10000, 10001, 10099, 99999, 100000, 100001, 100100, 101000, 110000, 999999, 1000000,
  1999999, 9999999, 10000000, 10000001, 12345678, 99999999, 100000000, 123456789, 1000000000, 9876543210, 99999999999, 100000000000, 123456789012, 1000000000000, 10000000000000, 999999999999999,
  1180505, 11805050, 11800000, 17700000, 105000000, 6690600, 35400000, 50, 7, 1234567, -1, -100, -12345, -11805050, 0.4, 0.5, 0.6, 99.5, 100.49, 100.5, -0.5, -0.6, 2.5, 1e3]
const words = WORDS.map((p) => ({ p, w: safe(() => inv.amountInWords(p)), n: safe(() => inv.indianWords(p)) }))
for (let i = 0; i < 400; i++) {
  const p = Math.floor(rand() * 10 ** (1 + Math.floor(rand() * 13)))
  words.push({ p, w: safe(() => inv.amountInWords(p)), n: safe(() => inv.indianWords(p)) })
}

const CODES = ['', '21', '29', '96', '07', '99', null, undefined, 'xx', '01', '38', '97']
const COUNTRIES = [undefined, null, '', 'India', 'india', ' INDIA ', 'IN', 'in', 'Bharat', 'USA', 'Germany', 'Saudi Arabia', 'Indiana']
const taxModes = []
for (const s of ['', '21', '29']) for (const pos of CODES) for (const c of COUNTRIES) taxModes.push({ s, pos, c, r: safe(() => inv.taxModeOf(s, pos, c)) })
const STATES = [...inv.GST_STATES.map((s) => s.name), ...inv.GST_STATES.map((s) => s.name.toUpperCase()), ...inv.GST_STATES.map((s) => `  ${s.name.toLowerCase()} `), 'Orissa', 'ORISSA', 'orissa ', '', null, undefined, 'Nowhere', 'Odisha State']
const stateCodes = STATES.map((n) => ({ n, r: safe(() => inv.stateCodeOf(n)) }))
const stateNames = [...inv.GST_STATES.map((s) => s.code), ...CODES].map((c) => ({ c, r: safe(() => inv.stateName(c)) }))
const PARTY_CLIENTS = [
  null,
  ...T.clients,
  { id: 'c1', name: 'X', country: 'India', gstin: '29AABCI1681G1ZF', billing_address: 'A', primary_contact: 'P', email: 'e@x.in', phone: '1', payment_terms_days: 15 },
  { id: 'c2', name: 'Y', country: '', gstin: '', billing_address: 'B', primary_contact: '', email: '', phone: '', payment_terms_days: 30, state: 'Orissa' },
  { id: 'c3', name: 'Z', country: 'USA', gstin: '', billing_address: 'C', primary_contact: '', email: '', phone: '', payment_terms_days: 30 },
  { id: 'c4', name: 'W', country: 'India', gstin: 'X9ABC', billing_address: null, primary_contact: null, email: null, phone: null, payment_terms_days: 30, pan: 'ABCDE1234F', state_code: '27' },
  { id: 'c5', name: 'V', country: 'Bharat', gstin: null, billing_address: '', primary_contact: '', email: '', phone: '', payment_terms_days: 30, state: 'Kerala', city: 'Kochi', pincode: '682001' },
]
const parties = PARTY_CLIENTS.map((c) => ({ c, r: safe(() => inv.clientParty(c, 'Fallback Co')) }))
const settingsTenants = [...T.tenants, { id: 't0', name: 'acme 2 corp & co', org: null }, { id: 't1', name: '', org: { legal_name: 'Ödd Näme Ltd' } }, { id: 't2', name: 'One', org: { employee_code_prefix: 'EMP', legal_name: '', bank_name: null, ifsc: undefined } }, { id: 't3', name: '123', org: {} }]
const defaults = settingsTenants.map((t) => ({ t, r: safe(() => inv.defaultInvoiceSettings(t)) }))
const BODIES = [
  {}, { lines: 'x' }, { project_id: '  p_crm ', milestone_ids: ['a', ' a', 'b', '', null, 3, 'b'], client_id: '', ship_to: {}, reverse_charge: 'yes', tds_pct: '7.5', terms: 5, number: ' 42 ' },
  { seller: { name: ' S ', state_code: '21', gstin: '21aakcs4821m1z5', pan: 'aakcs4821m', cin: 'u1', website: ' w ' }, bill_to: { country: 'USA', state_code: '21' }, ship_to: null },
  { lines: [{}, { id: '', qty: '2', rate_paise: '1500.5', discount_pct: null, gst_rate: '18', unit: '', source: { kind: 'hours', user_id: 'u', from: 'a', to: 'b' } }, { qty: 'x', rate_paise: 'y', discount_pct: 'z', gst_rate: 'w' }] },
  { bank: { account_number: ' 5020 0071 8248 21 ', ifsc: 'hdfc0001827' }, signatory: { name: 1, title: true }, notes: 12, po_date: '2026-13-01', invoiced_on: 20261015 },
  { bill_to: { name: 'B', state: '', state_code: '29' }, seller: 'str', place_of_supply: 96 },
]
const normalised = BODIES.map((b) => ({ b, r: safe(() => inv.normalise(b)) }))

/* ---------------- 2. scenarios ---------------- */
const routes = []
const cap = (method) => (p, h) => routes.push({ method, p, h })
inv.register({ get: cap('GET'), post: cap('POST'), put: cap('PUT'), patch: cap('PATCH'), del: cap('DELETE') })
const route = (method, p) => routes.find((r) => r.method === method && r.p === p).h
const perms = (db, uid) => server.permissionsOf(db.users.find((u) => u.id === uid))
const TABLES = ['invoices', 'payments', 'ledger_entries', 'milestones', 'clients', 'activity_log', 'email_outbox', 'tenants', 'notifications', 'files']
const keyOf = (r) => JSON.stringify(norm(r))

function snapshot(db, tid) {
  const out = {}
  for (const t of TABLES) out[t] = new Map((db[t] ?? []).filter((r) => (t === 'tenants' ? r.id === tid : r.tenant_id === tid)).map((r) => [r.id, keyOf(r)]))
  return out
}
function diffOf(db, tid, before) {
  const out = {}
  for (const t of TABLES) {
    const now = (db[t] ?? []).filter((r) => (t === 'tenants' ? r.id === tid : r.tenant_id === tid))
    const ids = new Set(now.map((r) => r.id))
    out[t] = { changed: norm(now.filter((r) => before[t].get(r.id) !== keyOf(r))), removed: [...before[t].keys()].filter((i) => !ids.has(i)) }
  }
  return out
}

/** a scenario: fresh db, pinned today, setup ops, then steps; every step's result + the final diff are recorded */
function scenario(name, tid, today, build, setup = []) {
  const db = install(server, T)
  for (const op of setup) applySetup(db, op)
  const before = snapshot(db, tid)
  const steps = []
  const ctxOf = (uid, permsOverride) => makeCtx(server, db, uid, permsOverride ?? perms(db, uid), today)
  const api = {
    db,
    call(uid, method, p, { params = {}, query = {}, body = {}, ifMatch, perms: po } = {}) {
      const ctx = ctxOf(uid, po)
      const res = safe(() => route(method, p)({ ctx, params, query, body: structuredClone(body), ifMatch, headers: {} }))
      steps.push({ op: 'call', uid, perms: [...ctx.perms], method, p, params, query, body, ifMatch: ifMatch ?? null, res, warnings: ctx.warnings })
      return res
    },
    fn(uid, name, args) {
      const ctx = ctxOf(uid)
      let res
      if (name === 'raiseMilestoneInvoice') res = safe(() => inv.raiseMilestoneInvoice(ctx, server.find(ctx, 'milestones', args.milestone_id), args.b))
      else if (name === 'recordRevenuePayment') res = safe(() => inv.recordRevenuePayment(ctx, server.find(ctx, 'invoices', args.invoice_id), args.amount, args.paid_on, args.reference))
      else if (name === 'nextInvoiceNumber') res = safe(() => inv.nextInvoiceNumber(ctx, args.date))
      else if (name === 'ensureGstAll') res = safe(() => server.rows(ctx, 'invoices').map((i) => inv.ensureGst(ctx, i)))
      steps.push({ op: 'fn', uid, perms: [...ctx.perms], name, args, res, warnings: ctx.warnings })
      return res
    },
  }
  build(api)
  return { name, tenant: tid, today, setup, steps, diff: diffOf(db, tid, before) }
}
function applySetup(db, op) {
  if (op.kind === 'strip') {
    const r = db[op.table].find((x) => x.id === op.id)
    for (const k of op.keys) delete r[k]
  } else if (op.kind === 'set') {
    const r = db[op.table].find((x) => x.id === op.id)
    Object.assign(r, structuredClone(op.values))
  } else if (op.kind === 'settings') {
    const t = db.tenants.find((x) => x.id === op.id)
    t.settings = { ...t.settings, ...op.values }
  }
}

const S = []
const TODAY = seed.generated_on
const ADMIN = 'u_santosh'
const draftOf = (res) => res.v.draft
// --- reads for several users (finance and not) ---
for (const [tid, users] of [['tn_seereon', ['u_santosh', 'u_debasish', 'u_subhankar', 'u_hritesh', 'u_baishali', 'u_priya']], ['tn_kalinga', ['u_k_ananya', 'u_k_rakesh']]])
  for (const today of [TODAY, '2027-04-02'])
    S.push(scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        a.call(u, 'GET', '/finance/invoices')
        a.call(u, 'GET', '/finance/invoices/meta')
        a.call(u, 'GET', '/finance/invoices/settings')
        for (const d of ['', today, '2027-04-01', '2026-03-31', 'bad', '2026-02-30', '2030-01-01']) a.call(u, 'GET', '/finance/invoices/next-number', { query: { date: d } })
        for (const i of a.db.invoices.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/finance/invoices/:id', { params: { id: i.id } })
        a.call(u, 'GET', '/finance/invoices/:id', { params: { id: 'nope' } })
        for (const p of a.db.projects.filter((x) => x.tenant_id === tid)) {
          a.call(u, 'GET', '/finance/invoices/project-milestones', { query: { project_id: p.id } })
          a.call(u, 'GET', '/finance/invoices/project-milestones', { query: { project_id: p.id, invoice_id: 'inv_ms_mgs_2' } })
          const ms = a.db.milestones.filter((m) => m.project_id === p.id).map((m) => m.id)
          a.call(u, 'GET', '/finance/invoices/prefill', { query: { project_id: p.id, milestone_ids: ms.join(',') } })
          a.call(u, 'GET', '/finance/invoices/prefill', { query: { project_id: p.id, milestone_ids: ` ${ms[0] ?? ''} ,, x` } })
          for (const [f, t] of [['2026-04-01', today], ['2026-09-01', '2026-09-30'], ['2026-10-10', '2026-10-01'], ['x', '2026-10-01']])
            a.call(u, 'GET', '/finance/invoices/billable-hours', { query: { project_id: p.id, from: f, to: t } })
        }
        a.call(u, 'GET', '/finance/invoices/prefill', { query: {} })
        a.call(u, 'GET', '/finance/invoices/prefill', { query: { project_id: 'nope' } })
        for (const c of a.db.clients.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/finance/invoices/client-party', { query: { client_id: c.id } })
        a.call(u, 'GET', '/finance/invoices/client-party', { query: { client_id: 'nope' } })
      }
    }))

// --- full life cycle: prefill -> create draft -> preview -> issue -> partial (TDS) -> full; intra (MMG Odisha) ---
const lifecycle = (tid, today, pid, mids, extra = {}) => (a) => {
  const pf = a.call(ADMIN, 'GET', '/finance/invoices/prefill', { query: { project_id: pid, milestone_ids: mids.join(',') } })
  if (!pf.v) return
  const body = { ...draftOf(pf), ...extra }
  a.call(ADMIN, 'POST', '/finance/invoices/preview', { body })
  const created = a.call(ADMIN, 'POST', '/finance/invoices', { body })
  if (!created.v) return
  const id = created.v.invoice.id
  a.call(ADMIN, 'POST', '/finance/invoices/preview', { body: { ...body, id } })
  a.call(ADMIN, 'PATCH', '/finance/invoices/:id', { params: { id }, body: { ...body, notes: 'Edited draft', po_reference: 'PO-77' }, ifMatch: 1 })
  a.call(ADMIN, 'PATCH', '/finance/invoices/:id', { params: { id }, body: { ...body, notes: 'stale' }, ifMatch: 1 })
  const issued = a.call(ADMIN, 'POST', '/finance/invoices/:id/issue', { params: { id }, body: {} })
  if (!issued.v) return
  const total = issued.v.invoice.total_paise
  const tds = issued.v.suggested_tds_paise
  a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id }, body: { received_paise: Math.round(total / 3), tds_paise: Math.round(tds / 2), paid_on: today, reference: 'UTR-1', mode: 'NEFT' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id }, body: { received_paise: total, tds_paise: 0, paid_on: today, reference: 'UTR-x' } })
  const d = a.call(ADMIN, 'GET', '/finance/invoices/:id', { params: { id } })
  if (d.v) a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id }, body: { received_paise: d.v.balance_paise - Math.round(tds / 2), tds_paise: Math.round(tds / 2), paid_on: today, reference: 'UTR-2' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id }, body: { received_paise: 100, paid_on: today } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id }, body: { reason: 'Client asked to cancel' } })
  a.call(ADMIN, 'GET', '/finance/invoices')
}
S.push(scenario('lifecycle intra hrms', 'tn_seereon', TODAY, lifecycle('tn_seereon', TODAY, 'p_hrms', ['ms_hrms_2', 'ms_hrms_3'])))
S.push(scenario('lifecycle export rcu', 'tn_seereon', TODAY, lifecycle('tn_seereon', TODAY, 'p_rcu', ['ms_rcu_3'])))
S.push(scenario('lifecycle inter (Karnataka bill-to)', 'tn_seereon', TODAY, lifecycle('tn_seereon', TODAY, 'p_crm', ['ms_crm_1'], {
  bill_to: { name: 'Infosys', address: 'Electronics City', city: 'Bengaluru', state: 'Karnataka', state_code: '29', pincode: '560100', country: 'India', gstin: '29AABCI1681G1ZF', pan: 'AABCI1681G', email: 'ap@infosys.com', phone: '', contact: 'AP' },
  place_of_supply: '29', client_id: 'cl_infy',
})))
S.push(scenario('lifecycle reverse charge + discounts', 'tn_seereon', TODAY, lifecycle('tn_seereon', TODAY, 'p_mgs', ['ms_mgs_3'], { reverse_charge: true, lines: [
  { id: 'a', item: 'Licences', description: '', hsn_sac: '997331', qty: 37, unit: 'Users', rate_paise: 123457, discount_pct: 12.5, gst_rate: 18, source: { kind: 'manual' } },
  { id: 'b', item: 'Training', description: 'x', hsn_sac: '999293', qty: 2.5, unit: 'Days', rate_paise: 1500001, discount_pct: 0, gst_rate: 5, source: { kind: 'manual' } },
  { id: 'c', item: 'Hardware', description: '', hsn_sac: '8471', qty: 3, unit: 'Nos', rate_paise: 3333333, discount_pct: 33.33, gst_rate: 28, source: { kind: 'manual' } },
  { id: 'd', item: 'Exempt', description: '', hsn_sac: '9992', qty: 1, unit: 'Lot', rate_paise: 99, discount_pct: 0, gst_rate: 0, source: { kind: 'manual' } },
] })))
S.push(scenario('lifecycle kalinga default settings', 'tn_kalinga', TODAY, (a) => {
  const pf = a.call('u_k_ananya', 'GET', '/finance/invoices/prefill', { query: { project_id: 'p_k_1', milestone_ids: 'ms_k_1,ms_k_2' } })
  const body = draftOf(pf)
  a.call('u_k_ananya', 'POST', '/finance/invoices', { body: { ...body, issue: true } })
  a.call('u_k_ananya', 'POST', '/finance/invoices', { body })
  a.call('u_k_ananya', 'PUT', '/finance/invoices/settings', { body: { bank: { bank_name: 'SBI', account_name: 'Kalinga', account_number: '123456789012', ifsc: 'SBIN0001234' }, signatory_name: 'Ananya' } })
  const t = a.db.tenants.find((x) => x.id === 'tn_kalinga')
  a.call('u_k_ananya', 'POST', '/finance/invoices', { body: { ...body, issue: true, seller: { ...body.seller, gstin: t.org?.gstin || '21AAATK7781H1Z9', state_code: '21' }, bank: { bank_name: 'SBI', account_name: 'Kalinga', account_number: '123456789012', ifsc: 'SBIN0001234' }, signatory: { name: 'Ananya', title: 'CEO' } } })
  a.call('u_k_ananya', 'GET', '/finance/invoices')
}))
// --- FY roll-over numbering and credit notes ---
S.push(scenario('fy rollover + credit notes', 'tn_seereon', '2027-04-02', (a) => {
  const mk = (pid, mids, date, extra = {}) => {
    const pf = a.call(ADMIN, 'GET', '/finance/invoices/prefill', { query: { project_id: pid, milestone_ids: mids.join(',') } })
    return a.call(ADMIN, 'POST', '/finance/invoices', { body: { ...draftOf(pf), invoiced_on: date, due_on: '2027-05-30', issue: true, ...extra } })
  }
  const x1 = mk('p_hrms', ['ms_hrms_2'], '2027-03-31')
  const x2 = mk('p_hrms', ['ms_hrms_3'], '2027-04-01')
  const x3 = mk('p_crm', ['ms_crm_1'], '2027-04-02', { number: 'sci/27-28/0001' })
  mk('p_crm', ['ms_crm_2'], '2027-04-02', { number: 'CUSTOM-9' })
  mk('p_rcu', ['ms_rcu_3'], '2027-04-02', { number: 'bad number!' })
  for (const x of [x1, x2, x3]) if (x.v) a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: x.v.invoice.id }, body: { reason: 'Raised against the wrong PO' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_ms_dms_1' }, body: { reason: 'short' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_ms_dms_1' }, body: { reason: '  Duplicate of an older invoice  ' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_ms_dms_1' }, body: { reason: 'Again cancelling it' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_ms_mgs_2' }, body: { reason: 'Has payments on it' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_draft_crm_cr1' }, body: { reason: 'Drafts are discarded' } })
  for (const d of ['2027-04-02', '2027-03-31', '2028-04-01']) a.fn(ADMIN, 'nextInvoiceNumber', { date: d })
  a.call(ADMIN, 'GET', '/finance/invoices')
}))
S.push(scenario('fy start january', 'tn_seereon', TODAY, (a) => {
  for (const d of [TODAY, '2026-01-01', '2025-12-31', '2027-01-01']) a.fn(ADMIN, 'nextInvoiceNumber', { date: d })
  a.call(ADMIN, 'GET', '/finance/invoices')
  a.call(ADMIN, 'POST', '/finance/invoices/:id/cancel', { params: { id: 'inv_ms_dms_1' }, body: { reason: 'Calendar-year credit note' } })
}, [{ kind: 'settings', id: 'tn_seereon', values: { 'company.fy_start_month': 1 } }]))
// --- validation failures (create + preview) ---
S.push(scenario('validation', 'tn_seereon', TODAY, (a) => {
  const pf = a.call(ADMIN, 'GET', '/finance/invoices/prefill', { query: { project_id: 'p_hrms', milestone_ids: 'ms_hrms_2' } })
  const b = draftOf(pf)
  const variants = [
    {}, { project_id: '' }, { project_id: 'p_crm' }, { milestone_ids: ['ms_hrms_1'] }, { milestone_ids: ['ms_mgs_3'] }, { milestone_ids: ['nope', 'ms_hrms_2'] },
    { seller: { ...b.seller, gstin: '' } }, { seller: { ...b.seller, gstin: '29AAKCS4821M1Z5' } }, { seller: { ...b.seller, pan: 'AAAAA1111A' } }, { seller: { ...b.seller, gstin: 'BAD' } },
    { bill_to: { ...b.bill_to, name: '', address: '', state_code: '00', pincode: '75100', email: 'x@y' } }, { bill_to: { ...b.bill_to, country: 'USA' } }, { bill_to: { ...b.bill_to, pan: 'abc' } },
    { ship_to: { name: 'S' } }, { invoiced_on: '' }, { invoiced_on: '2026-02-30' }, { invoiced_on: '2099-01-01' }, { due_on: '2026-01-01' }, { due_on: 'x' },
    { place_of_supply: '' }, { place_of_supply: '96' }, { po_date: 'nope' }, { tds_pct: 25 }, { tds_pct: -1 }, { lines: [] },
    { lines: [{ item: '', hsn_sac: '12', qty: 0, rate_paise: -5, discount_pct: 101, gst_rate: 7 }] }, { lines: [{ ...b.lines[0], rate_paise: 0 }] },
    { bank: { ...b.bank, bank_name: '', account_number: '12', account_name: '', ifsc: 'bad' } }, { bank: { ...b.bank, ifsc: '' } }, { signatory: { name: '', title: '' } },
    { number: 'SCI/26-27/0001' }, { number: 'sci/26-27/0006' }, { number: 'X'.repeat(17) }, { number: 'ok/1' }, { reverse_charge: true, tds_pct: '12.5' },
  ]
  for (const v of variants) {
    a.call(ADMIN, 'POST', '/finance/invoices/preview', { body: { ...b, ...v } })
    a.call(ADMIN, 'POST', '/finance/invoices', { body: { ...b, ...v, issue: true } })
  }
  a.call(ADMIN, 'POST', '/finance/invoices', { body: { ...b, save_client: true, client_id: '' } })
  a.call('u_subhankar', 'POST', '/finance/invoices', { body: b })
  a.call('u_hritesh', 'POST', '/finance/invoices/preview', { body: b })
  a.call(ADMIN, 'POST', '/finance/invoices', { body: { ...b, save_client: true, bill_to: { ...b.bill_to, city: 'Cuttack', email: '', contact: 'New AP' } } })
  a.call(ADMIN, 'POST', '/finance/invoices', { body: { ...b, save_client: true, client_id: 'cl_mmg', milestone_ids: [] } , perms: ['finance.edit', 'finance.view'] })
}))
// --- payments edge cases on seeded invoices ---
S.push(scenario('payments', 'tn_seereon', TODAY, (a) => {
  const P = (id, body, ifMatch) => a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id }, body, ifMatch })
  P('inv_ms_mgs_2', { received_paise: 0, tds_paise: 0, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: -1, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 100.4, tds_paise: 0.5, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 'abc', paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 1000, tds_paise: -3, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 1000, paid_on: '2099-01-01' })
  P('inv_ms_mgs_2', { received_paise: 1000, paid_on: '2026-01-01' })
  P('inv_ms_mgs_2', { received_paise: 1000, paid_on: 'x' })
  P('inv_ms_mgs_2', { received_paise: 99999999, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 100, tds_paise: 9000000, paid_on: TODAY })
  P('inv_ms_mgs_2', { received_paise: 100, paid_on: TODAY }, 99)
  P('inv_ms_mgs_2', { received_paise: 4000000, tds_paise: 750000, paid_on: TODAY, reference: 'R', mode: '' }, 1)
  P('inv_ms_mgs_2', { received_paise: 100, paid_on: TODAY })
  P('inv_ms_hrms_1', { received_paise: 100, paid_on: TODAY })
  P('inv_draft_crm_cr1', { received_paise: 100, paid_on: TODAY })
  P('nope', { received_paise: 100, paid_on: TODAY })
  P('inv_ms_dms_1', { received_paise: 35400000, tds_paise: 0, paid_on: '2026-09-09' })
  a.call('u_subhankar', 'POST', '/finance/invoices/:id/payments', { params: { id: 'inv_ms_dms_1' }, body: { received_paise: 1 } })
  a.call(ADMIN, 'GET', '/finance/invoices')
}))
// --- legacy exports used by projects.ts ---
S.push(scenario('legacy milestone invoice + revenue payment', 'tn_seereon', TODAY, (a) => {
  a.fn(ADMIN, 'raiseMilestoneInvoice', { milestone_id: 'ms_hrms_2', b: { number: '', invoiced_on: TODAY, due_on: '2026-11-14', amount_paise: 45000000, file_id: null } })
  a.fn(ADMIN, 'raiseMilestoneInvoice', { milestone_id: 'ms_rcu_3', b: { number: 'SCI/26-27/0001', invoiced_on: '2026-10-01', due_on: '2026-10-31', amount_paise: 100000000, file_id: 'f1' } })
  a.fn(ADMIN, 'raiseMilestoneInvoice', { milestone_id: 'ms_crm_1', b: { number: ' RCX-1 ', invoiced_on: TODAY, due_on: TODAY, amount_paise: 20000000, file_id: null } })
  a.fn(ADMIN, 'raiseMilestoneInvoice', { milestone_id: 'ms_edureon_1', b: { number: '', invoiced_on: TODAY, due_on: TODAY, amount_paise: 1234567, file_id: null } })
  const ids = a.db.invoices.filter((i) => i.tenant_id === 'tn_seereon').map((i) => i.id)
  for (const id of ids.slice(-4)) {
    a.fn(ADMIN, 'recordRevenuePayment', { invoice_id: id, amount: 7777777, paid_on: TODAY, reference: 'legacy 1' })
    a.fn(ADMIN, 'recordRevenuePayment', { invoice_id: id, amount: 999999999, paid_on: TODAY, reference: 'too much' })
    a.fn(ADMIN, 'recordRevenuePayment', { invoice_id: id, amount: 45000000, paid_on: TODAY, reference: 'rest' })
  }
  a.fn(ADMIN, 'recordRevenuePayment', { invoice_id: 'inv_ms_mgs_2', amount: 3000000, paid_on: TODAY, reference: 'part' })
  a.fn(ADMIN, 'recordRevenuePayment', { invoice_id: 'inv_ms_hrms_1', amount: 1, paid_on: TODAY, reference: 'paid' })
  a.call(ADMIN, 'GET', '/finance/invoices')
}))
// --- legacy (pre-v7) invoices upgraded by ensureGst ---
const STRIP = ['lines', 'total_paise', 'seller', 'bill_to', 'tax_mode', 'subtotal_paise', 'discount_paise', 'taxable_paise', 'cgst_paise', 'sgst_paise', 'igst_paise', 'round_off_paise', 'received_paise', 'tds_received_paise', 'tds_pct', 'bank', 'signatory', 'place_of_supply', 'status', 'milestone_ids', 'client_id', 'emails', 'notes', 'terms', 'issued_on', 'ship_to', 'po_reference', 'reverse_charge']
S.push(scenario('legacy ensureGst', 'tn_seereon', TODAY, (a) => {
  a.call(ADMIN, 'GET', '/finance/invoices')
  for (const id of ['inv_ms_hrms_1', 'inv_ms_mgs_2', 'inv_ms_rcu_1', 'inv_ms_dms_1']) a.call(ADMIN, 'GET', '/finance/invoices/:id', { params: { id } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/payments', { params: { id: 'inv_ms_mgs_2' }, body: { received_paise: 500000, paid_on: TODAY } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/duplicate', { params: { id: 'inv_ms_rcu_1' } })
}, [
  ...['inv_ms_hrms_1', 'inv_ms_mgs_2', 'inv_ms_rcu_1', 'inv_ms_dms_1'].map((id) => ({ kind: 'strip', table: 'invoices', id, keys: STRIP })),
  ...T.payments.filter((p) => ['inv_ms_hrms_1', 'inv_ms_mgs_2', 'inv_ms_rcu_1'].includes(p.invoice_id)).map((p) => ({ kind: 'strip', table: 'payments', id: p.id, keys: ['gross_paise', 'tds_paise', 'mode'] })),
  { kind: 'set', table: 'invoices', id: 'inv_ms_rcu_1', values: { lines: [] } },
]))
// --- patch / issue / delete / duplicate / email / settings ---
S.push(scenario('drafts, email, duplicate, settings', 'tn_seereon', TODAY, (a) => {
  const id = 'inv_draft_crm_cr1'
  a.call(ADMIN, 'PATCH', '/finance/invoices/:id', { params: { id: 'inv_ms_dms_1' }, body: { notes: 'Thanks!', id: 'x' } })
  a.call(ADMIN, 'PATCH', '/finance/invoices/:id', { params: { id: 'inv_ms_dms_1' }, body: { notes: 'x', due_on: '2027-01-01' } })
  a.call(ADMIN, 'PATCH', '/finance/invoices/:id', { params: { id: 'inv_ms_dms_1' }, body: [] })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/issue', { params: { id: 'inv_ms_dms_1' }, body: {} })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/issue', { params: { id }, body: { number: 'SCI/26-27/0003' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/issue', { params: { id }, body: { number: 'SCI-9' } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/email', { params: { id: 'nope' }, body: {} })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/email', { params: { id: 'inv_draft_crm_cr1' }, body: {} })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/duplicate', { params: { id } })
  a.call(ADMIN, 'POST', '/finance/invoices/:id/duplicate', { params: { id: 'inv_ms_mgs_2' } })
  for (const body of [{ to: 'bad' }, { to: 'ap@mgs.in', cc: 'a@b.co; nope' }, { to: 'ap@mgs.in', message: 'hi' }, { to: 'ap@mgs.in', cc: 'a@b.co,  c@d.org ', message: 'Please find the invoice attached.', subject: '' }, { to: 'x@y.z', message: 'Second mail here' }])
    a.call(ADMIN, 'POST', '/finance/invoices/:id/email', { params: { id: 'inv_ms_mgs_2' }, body })
  a.call(ADMIN, 'DELETE', '/finance/invoices/:id', { params: { id: 'inv_ms_mgs_2' } })
  a.call(ADMIN, 'DELETE', '/finance/invoices/:id', { params: { id: 'inv_draft_crm_cr1' }, ifMatch: 7 })
  a.call(ADMIN, 'DELETE', '/finance/invoices/:id', { params: { id: 'inv_draft_crm_cr1' } })
  for (const body of [{ prefix: 'sci2' }, { prefix: 'TOOLONG7' }, { credit_note_prefix: '' }, { payment_terms_days: 181 }, { payment_terms_days: '45' }, { default_sac: '12' }, { default_gst_rate: 7 }, { default_tds_pct: 21 },
    { bank: { account_number: '12 34' } }, { bank: { ifsc: 'x' } }, { bank: { upi: 'a@1' } }, { bank: { account_number: '', upi: '' } },
    { prefix: 'SEER', credit_note_prefix: 'cr', payment_terms_days: 15, default_sac: '998313', default_gst_rate: '12', default_tds_pct: 2, default_unit: '', bank: { bank_name: ' ICICI ', account_number: '0011 2233 4455', ifsc: 'icic0000001', upi: 'pay@icici' }, signatory_name: ' S ', default_terms: '  T  ', lut_number: 5 }])
    a.call(ADMIN, 'PUT', '/finance/invoices/settings', { body })
  a.call('u_debasish', 'GET', '/finance/invoices/settings')
  a.call('u_hritesh', 'GET', '/finance/invoices/settings')
  a.call(ADMIN, 'GET', '/finance/invoices/meta')
  for (const d of [TODAY]) a.fn(ADMIN, 'nextInvoiceNumber', { date: d })
}))

const out = { generated_on: seed.generated_on, totals, words, taxModes, stateCodes, stateNames, parties, defaults, normalised, scenarios: S }
const size = writeGz('invoices.json.gz', out)
console.log(`invoices vectors: ${totals.length} totals, ${words.length} words, ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
