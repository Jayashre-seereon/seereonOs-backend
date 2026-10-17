// Golden vectors for app/routes/spend.py (port of src/mock/routes/spend.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/spend.mjs -> vectors/spend.json.gz
// Reads for several users / days, every write route with valid + invalid bodies and allowed + denied users (expense
// workflow incl. second approval, vendors through maker-checker, POs over/under budget, bills vs PO tolerance,
// budgets + copy, leakage), and the exports used by reports/clients (budgetStatement, leakageRows, poTotal,
// monthRemaining).
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

// clients.ts is registered too (as in the app): it late-binds contractRenewals into /spend/summary
const M = await loadTs('spend', `export * as sp from '@/mock/routes/spend'\nexport * as cl from '@/mock/routes/clients'\nexport * as mc from '@/mock/makerChecker'\n`)
const { server, sp, cl, mc } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['expense_claims', 'vendors', 'purchase_orders', 'vendor_bills', 'budgets', 'revenue_leakage', 'ledger_entries', 'files', 'activity_log', 'notifications', 'change_sets', 'number_sequences']
const K = kit({
  server, T, modules: [sp, cl, mc], tables: TABLES,
  fns: {
    budgetStatement: (ctx, a) => sp.budgetStatement(ctx, a.fy),
    leakageRows: (ctx) => sp.leakageRows(ctx),
    poTotals: (ctx) => server.rows(ctx, 'purchase_orders').map((p) => sp.poTotal(p)),
    monthRemaining: (ctx, a) => sp.monthRemaining(ctx, a.category, a.date, a.exclude),
    adminId: (ctx) => [sp.adminId(ctx), sp.spendAuthority(ctx)],
    maskAccount: (_ctx, a) => a.values.map((v) => sp.maskAccount(v)),
  },
})
const TODAY = seed.generated_on
const S = []
const file = (name = 'r.pdf', size = 1000) => ({ name, mime: 'application/pdf', size_bytes: size, data_url: 'data:application/pdf;base64,JVBERi0xLjQK' })

// ---------- reads ----------
const READERS = { tn_seereon: ['u_santosh', 'u_debasish', 'u_subhankar', 'u_hritesh', 'u_priya', 'u_baishali'], tn_kalinga: ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha'] }
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2027-04-02', '2026-04-01'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        a.call(u, 'GET', '/spend/meta')
        for (const tab of ['mine', 'approve', 'pay', 'all', 'xyz', undefined]) a.call(u, 'GET', '/expenses', { query: tab === undefined ? {} : { tab } })
        a.call(u, 'GET', '/expenses', { query: { tab: 'all', status: 'submitted', q: 'TRAV' } })
        a.call(u, 'GET', '/expenses', { query: { tab: 'mine', q: 'hritesh' } })
        for (const e of a.db.expense_claims.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/expenses/:id', { params: { id: e.id } })
        a.call(u, 'GET', '/expenses/:id', { params: { id: 'nope' } })
        a.call(u, 'GET', '/purchases')
        for (const fy of [undefined, '2025', '2026', '2027', 'abc', '2026.5']) a.call(u, 'GET', '/budgets', { query: fy === undefined ? {} : { fy } })
        for (const fy of [undefined, '2025', '2026', 'x']) a.call(u, 'GET', '/leakage', { query: fy === undefined ? {} : { fy } })
        a.call(u, 'GET', '/spend/summary')
      }
      a.fn(users[0], 'budgetStatement', { fy: 2026 })
      a.fn(users[0], 'budgetStatement', { fy: 2025 })
      a.fn(users[0], 'leakageRows')
      a.fn(users[0], 'poTotals')
      a.fn(users[0], 'adminId')
      for (const c of ['Travel', 'travel ', 'Equipment', 'Nope']) for (const d of [today, '2026-10-01', '2027-03-31']) a.fn(users[0], 'monthRemaining', { category: c, date: d, exclude: 'exp_01od' })
      a.fn(users[0], 'maskAccount', { values: ['', null, '1234', '12345', '50200071824821'] })
    }, [
      { kind: 'insert', table: 'change_requests', row: { id: 'cr_rej', tenant_id: 'tn_seereon', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', version: 1, project_id: 'p_mgs', title: 'Extra report pack', hours: 40, value_paise: 600000, status: 'rejected', decided_at: '2026-09-02T10:00:00Z', raised_by: 'u_subhankar' } },
    ]))

// ---------- expenses ----------
S.push(K.scenario('expenses', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  // validation
  for (const body of [{}, { category: 'nope' }, { category: 'travel', description: 'ab' }, { category: 'travel', description: 'Cab', amount_paise: 0 }, { category: 'travel', description: 'Cab', amount_paise: 12.5 },
    { category: 'travel', description: 'Cab', amount_paise: 1e14 }, { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: '2026-02-30' }, { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: '2099-01-01' },
    { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: '2026-05-01' }, { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: TODAY, billable_to_client: true },
    { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: TODAY, project_id: 'nope' }, { category: 'travel', description: 'Cab', amount_paise: 60000, spent_on: TODAY, submit: true },
    { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: TODAY, receipt: { name: '', data_url: '' } }, { category: 'travel', description: 'Cab', amount_paise: 1000, spent_on: TODAY, receipt: file('big.pdf', 20 * 1024 * 1024) },
    { category: 'travel', description: 'x'.repeat(201), amount_paise: 1000, spent_on: TODAY }])
    C('u_hritesh', 'POST', '/expenses', { body })
  // drafts + duplicates + submit with receipt
  const d1 = C('u_hritesh', 'POST', '/expenses', { body: { category: 'internet_phone', description: 'Broadband Oct', amount_paise: 99900, spent_on: '2026-10-01' } })
  const d2 = C('u_hritesh', 'POST', '/expenses', { body: { category: 'travel', description: 'Client visit cab', amount_paise: 64000, spent_on: '2026-10-14', project_id: 'p_hrms', billable_to_client: true, receipt: file(), submit: true } })
  const d3 = C('u_jagannath', 'POST', '/expenses', { body: { category: 'hardware', description: 'Laptop docking station', amount_paise: 3200000, spent_on: '2026-10-10', receipt: file('dock.pdf'), submit: true } })
  C('u_santosh', 'POST', '/expenses', { body: { category: 'software', description: 'Figma seat', amount_paise: 120000, spent_on: '2026-10-12', receipt: file('f.pdf'), submit: true } })
  if (d1.v) {
    const id = d1.v.id
    C('u_subhankar', 'PATCH', '/expenses/:id', { params: { id }, body: { description: 'not mine' } })
    C('u_hritesh', 'PATCH', '/expenses/:id', { params: { id }, body: { amount_paise: 99000, receipt: file('bill.pdf') }, ifMatch: 1 })
    C('u_hritesh', 'PATCH', '/expenses/:id', { params: { id }, body: { amount_paise: 99000 }, ifMatch: 1 })
    C('u_hritesh', 'PATCH', '/expenses/:id', { params: { id }, body: { remove_receipt: true, amount_paise: 60000, submit: true } })
    C('u_hritesh', 'PATCH', '/expenses/:id', { params: { id }, body: { amount_paise: 40000, submit: true } })
    C('u_hritesh', 'PATCH', '/expenses/:id', { params: { id }, body: { amount_paise: 40000 } })
    C('u_hritesh', 'DELETE', '/expenses/:id', { params: { id } })
  }
  // submit route
  C('u_subham', 'POST', '/expenses/:id/submit', { params: { id: 'exp_01nt' }, ifMatch: 9 })
  C('u_hritesh', 'POST', '/expenses/:id/submit', { params: { id: 'exp_01nt' } })
  C('u_subham', 'POST', '/expenses/:id/submit', { params: { id: 'exp_01nt' } })
  C('u_subham', 'POST', '/expenses/:id/submit', { params: { id: 'exp_01nt' } })
  C('u_bijaya', 'POST', '/expenses/:id/submit', { params: { id: 'exp_01ny' } })
  // approvals: single step (manager), two steps (> 25k), self, wrong person
  C('u_hritesh', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01n8' } })
  C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01n8' }, body: { note: 'ok' } })
  C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01n8' } })
  C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01nd' }, ifMatch: 5 })
  C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01ni' } })
  C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01p4' } })
  C('u_santosh', 'POST', '/expenses/:id/approve', { params: { id: 'exp_01od' }, body: { note: 'Approved for client travel' } })
  if (d3.v) {
    C('u_subhankar', 'POST', '/expenses/:id/approve', { params: { id: d3.v.id } })
    C('u_subhankar', 'GET', '/expenses/:id', { params: { id: d3.v.id } })
    C('u_santosh', 'POST', '/expenses/:id/approve', { params: { id: d3.v.id } })
  }
  if (d2.v) {
    C('u_subhankar', 'POST', '/expenses/:id/reject', { params: { id: d2.v.id }, body: { reason: 'no' } })
    C('u_subhankar', 'POST', '/expenses/:id/reject', { params: { id: d2.v.id }, body: { reason: 'Attach the toll receipt too' } })
    C('u_hritesh', 'GET', '/expenses/:id', { params: { id: d2.v.id } })
    C('u_hritesh', 'POST', '/expenses/:id/submit', { params: { id: d2.v.id } })
  }
  C('u_hritesh', 'POST', '/expenses/:id/reject', { params: { id: 'exp_01os' }, body: { reason: 'Duplicate of the 1 Oct claim' } })
  C('u_santosh', 'POST', '/expenses/:id/reject', { params: { id: 'exp_01os' }, body: { reason: 'Duplicate of the 1 Oct claim' } })
  C('u_santosh', 'POST', '/expenses/:id/reject', { params: { id: 'exp_01os' }, body: { reason: 'again' } })
  // pay
  C('u_hritesh', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01mn' } })
  C('u_priya', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01mn' }, body: { paid_on: '2099-01-01' } })
  C('u_priya', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01mn' }, body: { paid_on: 'bad' } })
  C('u_priya', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01mn' }, body: { paid_on: '2026-10-14' } })
  C('u_priya', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01mn' } })
  C('u_santosh', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01nn' }, ifMatch: 1 })
  C('u_santosh', 'POST', '/expenses/:id/pay', { params: { id: 'exp_01n8' } })
  C('u_santosh', 'DELETE', '/expenses/:id', { params: { id: 'exp_01n8' } })
  C('u_bijaya', 'DELETE', '/expenses/:id', { params: { id: 'exp_01ny' }, ifMatch: 1 })
  for (const u of ['u_santosh', 'u_subhankar', 'u_hritesh', 'u_priya']) C(u, 'GET', '/expenses', { query: { tab: u === 'u_hritesh' ? 'mine' : 'approve' } })
  C('u_santosh', 'GET', '/budgets')
  C('u_santosh', 'GET', '/spend/summary')
}))
// ---------- vendors (maker-checker on in Seereon, off in Kalinga) ----------
for (const tid of ['tn_seereon', 'tn_kalinga'])
  S.push(K.scenario(`vendors ${tid}`, tid, TODAY, (a) => {
    const admin = tid === 'tn_seereon' ? 'u_priya' : 'u_k_ananya'
    const C = (u, m, p, o) => a.call(u, m, p, o)
    for (const body of [{}, { name: 'X' }, { name: 'Dell International Services India' }, { name: 'New Co', gstin: 'bad' }, { name: 'New Co', gstin: '21AAKFM9876Q1ZP', pan: 'AAAAA1111A' }, { name: 'New Co', pan: 'abc' },
      { name: 'New Co', payment_terms_days: 181 }, { name: 'New Co', email: 'x@' }, { name: 'New Co', bank_account: '123' }, { name: 'New Co', bank_account: '1234-5678 9012' }, { name: 'New Co', bank_account: '123456789012', ifsc: 'HDFC0001234' },
      { name: 'New Co', bank_account: '123456789012', ifsc: 'bad' }])
      C(admin, 'POST', '/vendors', { body })
    const created = C(admin, 'POST', '/vendors', { body: { name: '  Utkal Print House ', gstin: '21aabcu1234d1z5', category: '', contact: 'Rao', phone: '99', email: 'a@b.in', bank_name: 'SBI', bank_account: '1234 5678 9012', ifsc: 'sbin0001234', payment_terms_days: '15' } })
    C(tid === 'tn_seereon' ? 'u_hritesh' : 'u_k_sneha', 'POST', '/vendors', { body: { name: 'Nope' } })
    const vid = tid === 'tn_seereon' ? 'v_ca' : created.v?.result?.id
    if (vid) {
      C(admin, 'PATCH', '/vendors/:id', { params: { id: vid }, body: {}, ifMatch: 9 })
      C(admin, 'PATCH', '/vendors/:id', { params: { id: vid }, body: {} })
      C(admin, 'PATCH', '/vendors/:id', { params: { id: vid }, body: { contact: 'New contact', phone: '12345' } })
      C(admin, 'PATCH', '/vendors/:id', { params: { id: vid }, body: { bank_name: 'ICICI', bank_account: '000111222333', ifsc: 'ICIC0000001' } })
      C(admin, 'PATCH', '/vendors/:id', { params: { id: vid }, body: { contact: 'Again' } })
      C(admin, 'POST', '/vendors/:id/block', { params: { id: vid }, body: { reason: 'bad' } })
      C(admin, 'POST', '/vendors/:id/block', { params: { id: vid }, body: { reason: 'Quality issues on two invoices' } })
      C(admin, 'POST', '/vendors/:id/unblock', { params: { id: vid } })
    }
    C(admin, 'GET', '/purchases')
    if (tid === 'tn_seereon') {
      const pend = a.db.change_sets.filter((c) => c.status === 'pending' && c.entity === 'vendor')
      for (const c of pend) {
        C('u_priya', 'POST', '/changes/:id/approve', { params: { id: c.id }, body: {} })
        C('u_santosh', 'POST', '/changes/:id/approve', { params: { id: c.id }, body: {} })
      }
      C('u_santosh', 'GET', '/purchases')
    }
  }))
// ---------- purchase orders + bills ----------
S.push(K.scenario('purchase orders + bills', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = 'u_priya'
  for (const body of [{}, { vendor_id: 'nope' }, { vendor_id: 'v_dell' }, { vendor_id: 'v_dell', lines: [] }, { vendor_id: 'v_dell', lines: [{ description: '', qty: 1, rate_paise: 100 }] },
    { vendor_id: 'v_dell', lines: [{ description: 'x', qty: 0, rate_paise: 100 }] }, { vendor_id: 'v_dell', lines: [{ description: 'x', qty: 1, rate_paise: 0 }] },
    { vendor_id: 'v_dell', lines: [{ description: 'x', qty: 1, rate_paise: 100 }], gst_pct: 7 }, { vendor_id: 'v_dell', lines: [{ description: 'x', qty: 1, rate_paise: 100 }] },
    { vendor_id: 'v_dell', lines: [{ description: 'x', qty: 1, rate_paise: 100 }], budget_category: 'Equipment', project_id: 'nope' }])
    C(P, 'POST', '/purchase-orders', { body })
  const po1 = C(P, 'POST', '/purchase-orders', { body: { vendor_id: 'v_stationery', lines: [{ description: 'Printer paper', qty: 20, rate_paise: 35000 }, { description: 'Toner', qty: 1.5, rate_paise: 333333 }], gst_pct: 12, budget_category: 'Office supplies', needed_by: '2026-11-01', title: '' } })
  C(P, 'POST', '/purchase-orders', { body: { vendor_id: 'v_dell', lines: [{ description: 'Workstations', qty: 4, rate_paise: 9500000 }], budget_category: 'Equipment', submit: true } })
  const po3 = C(P, 'POST', '/purchase-orders', { body: { vendor_id: 'v_dell', lines: [{ description: 'Workstations', qty: 4, rate_paise: 9500000 }], budget_category: 'Equipment', justification: 'Two new developers join on 1 Nov', submit: true } })
  C(P, 'POST', '/purchase-orders', { body: { vendor_id: 'v_aws', lines: [{ description: 'Reserved instances', qty: 1, rate_paise: 1000000 }], budget_category: 'Hosting', submit: true, justification: 'No hosting budget line yet' } })
  if (po1.v) {
    const id = po1.v.id
    C(P, 'PATCH', '/purchase-orders/:id', { params: { id }, body: { lines: [{ description: 'Printer paper', qty: 25, rate_paise: 35000 }] }, ifMatch: 1 })
    C(P, 'PATCH', '/purchase-orders/:id', { params: { id }, body: { title: 'Q3 stationery' }, ifMatch: 1 })
    C(P, 'POST', '/purchase-orders/:id/submit', { params: { id }, body: { justification: '  ' } })
    C(P, 'POST', '/purchase-orders/:id/submit', { params: { id }, body: {} })
    C(P, 'POST', '/purchase-orders/:id/submit', { params: { id }, body: {} })
    C(P, 'PATCH', '/purchase-orders/:id', { params: { id }, body: {} })
    C(P, 'POST', '/purchase-orders/:id/approve', { params: { id } })
    C('u_hritesh', 'POST', '/purchase-orders/:id/approve', { params: { id } })
    C('u_santosh', 'POST', '/purchase-orders/:id/approve', { params: { id }, body: { note: 'Fine' } })
    C('u_santosh', 'POST', '/purchase-orders/:id/close', { params: { id } })
    C(P, 'POST', '/purchase-orders/:id/close', { params: { id } })
  }
  if (po3.v) {
    C('u_santosh', 'POST', '/purchase-orders/:id/reject', { params: { id: po3.v.id }, body: { reason: 'no' } })
    C('u_santosh', 'POST', '/purchase-orders/:id/reject', { params: { id: po3.v.id }, body: { reason: 'Use the existing pending PO' } })
    C(P, 'PATCH', '/purchase-orders/:id', { params: { id: po3.v.id }, body: { lines: [{ description: 'Workstations', qty: 2, rate_paise: 9500000 }] } })
    C(P, 'DELETE', '/purchase-orders/:id', { params: { id: po3.v.id } })
  }
  C(P, 'DELETE', '/purchase-orders/:id', { params: { id: 'po_po2' } })
  C('u_santosh', 'POST', '/purchase-orders/:id/approve', { params: { id: 'po_po6' } })
  C('u_santosh', 'POST', '/purchase-orders/:id/approve', { params: { id: 'po_po2' } })
  // bills
  for (const body of [{}, { vendor_id: 'v_aws' }, { vendor_id: 'v_aws', number: 'X1' }, { vendor_id: 'v_aws', number: 'X1', bill_date: '2099-01-01' }, { vendor_id: 'v_aws', number: 'X1', bill_date: TODAY },
    { vendor_id: 'v_aws', number: 'X1', bill_date: TODAY, amount_paise: 100, tds_paise: 200 }, { vendor_id: 'v_aws', number: 'euinaws26-0931', bill_date: TODAY, amount_paise: 100 },
    { vendor_id: 'v_aws', number: 'X1', bill_date: TODAY, amount_paise: 100, po_id: 'po_po4' }, { vendor_id: 'v_dell', number: 'X1', bill_date: TODAY, amount_paise: 100, po_id: 'po_po6' },
    { vendor_id: 'v_aws', number: 'X1', bill_date: TODAY, amount_paise: 100000, po_id: 'po_po2' }, { vendor_id: 'v_aws', number: 'X1', bill_date: TODAY, amount_paise: 100, due_on: 'bad' }])
    C(P, 'POST', '/vendor-bills', { body })
  const b1 = C(P, 'POST', '/vendor-bills', { body: { vendor_id: 'v_ca', number: 'MA/130/26-27', bill_date: '2026-10-10', amount_paise: 6100000, gst_paise: 1098000, tds_paise: 610000, po_id: 'po_po4', file: file('bill.pdf') } })
  const b2 = C(P, 'POST', '/vendor-bills', { body: { vendor_id: 'v_landlord', number: 'KBC/RENT/OCT', bill_date: '2026-10-01', amount_paise: 4600000, gst_paise: 828000, tds_paise: 460000, description: 'October rent' } })
  C(P, 'POST', '/vendor-bills', { body: { vendor_id: 'v_stationery', number: 'KSM-2300', bill_date: '2026-10-11', amount_paise: 50000, category: '' } })
  if (b2.v) {
    const id = b2.v.id
    C(P, 'PATCH', '/vendor-bills/:id', { params: { id }, body: { amount_paise: 4700000 }, ifMatch: 9 })
    C(P, 'PATCH', '/vendor-bills/:id', { params: { id }, body: { amount_paise: 4700000, due_on: '2026-10-05' } })
    C('u_hritesh', 'POST', '/vendor-bills/:id/approve', { params: { id } })
    C('u_santosh', 'POST', '/vendor-bills/:id/approve', { params: { id } })
    C('u_santosh', 'POST', '/vendor-bills/:id/approve', { params: { id } })
    C(P, 'PATCH', '/vendor-bills/:id', { params: { id }, body: { amount_paise: 1 } })
    C(P, 'POST', '/vendor-bills/:id/pay', { params: { id }, body: { paid_on: '2026-10-12' } })
    C(P, 'POST', '/vendor-bills/:id/pay', { params: { id } })
    C(P, 'POST', '/vendor-bills/:id/dispute', { params: { id }, body: { reason: 'Rent was wrong' } })
  }
  if (b1.v) {
    const id = b1.v.id
    C(P, 'POST', '/vendor-bills/:id/dispute', { params: { id }, body: { reason: 'short' } })
    C(P, 'POST', '/vendor-bills/:id/dispute', { params: { id }, body: { reason: 'Hours billed do not match the timesheet' } })
    C('u_santosh', 'POST', '/vendor-bills/:id/approve', { params: { id } })
    C(P, 'POST', '/vendor-bills/:id/resolve', { params: { id } })
    C(P, 'POST', '/vendor-bills/:id/resolve', { params: { id } })
  }
  C('u_santosh', 'POST', '/vendor-bills/:id/approve', { params: { id: 'bill_01qz' } })
  C(P, 'POST', '/vendor-bills/:id/pay', { params: { id: 'bill_01qz' } })
  C(P, 'POST', '/vendor-bills/:id/pay', { params: { id: 'bill_01qi' }, ifMatch: 1 })
  C(P, 'POST', '/vendor-bills/:id/pay', { params: { id: 'bill_01r4' } })
  C('u_hritesh', 'POST', '/vendor-bills/:id/pay', { params: { id: 'bill_01r4' } })
  C('u_santosh', 'GET', '/purchases')
  C('u_santosh', 'GET', '/budgets')
  C('u_santosh', 'GET', '/spend/summary')
}))
// ---------- budgets ----------
S.push(K.scenario('budgets', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const m12 = (x) => Array.from({ length: 12 }, (_, i) => x + i * 1000)
  for (const body of [{}, { fy_start_year: 1999 }, { fy_start_year: 2026 }, { fy_start_year: 2026, category: 'X' }, { fy_start_year: 2026, kind: 'revenue', category: 'Hosting' }, { fy_start_year: 2026, category: 'Hosting', monthly_paise: [1, 2] },
    { fy_start_year: 2026, category: 'Hosting', monthly_paise: [...m12(0).slice(0, 11), -1] }, { fy_start_year: 2026, category: 'Hosting', monthly_paise: [...m12(0).slice(0, 11), 1.5] }])
    C('u_santosh', 'PUT', '/budgets', { body })
  C('u_hritesh', 'PUT', '/budgets', { body: { fy_start_year: 2026, category: 'Hosting', monthly_paise: m12(100000) } })
  C('u_santosh', 'PUT', '/budgets', { body: { fy_start_year: 2026, category: 'Hosting', monthly_paise: m12(100000), notes: 'AWS + GCP', owner_id: 'u_priya' } })
  C('u_santosh', 'PUT', '/budgets', { body: { fy_start_year: 2026, category: 'travel', monthly_paise: m12(3000000) }, ifMatch: 7 })
  C('u_santosh', 'PUT', '/budgets', { body: { fy_start_year: 2026, category: 'travel', monthly_paise: m12(3000000) }, ifMatch: 1 })
  C('u_santosh', 'PUT', '/budgets', { body: { fy_start_year: '2026', kind: 'revenue', category: 'saas', monthly_paise: m12(4000000) } })
  C('u_santosh', 'DELETE', '/budgets/:id', { params: { id: 'bud_01rw' }, ifMatch: 3 })
  C('u_santosh', 'DELETE', '/budgets/:id', { params: { id: 'bud_01rw' } })
  C('u_santosh', 'DELETE', '/budgets/:id', { params: { id: 'nope' } })
  for (const body of [{ to_fy: 2027, growth_pct: 300 }, { to_fy: 2030 }, { to_fy: 'x', from_fy: 2026 }, { to_fy: 2027, growth_pct: 10 }, { to_fy: 2027, growth_pct: -5.5, overwrite: true }, { to_fy: 2026, from_fy: 2025 }, { to_fy: 2026, from_fy: 2025, overwrite: true, growth_pct: 0 }])
    C('u_santosh', 'POST', '/budgets/copy', { body })
  C('u_santosh', 'GET', '/budgets', { query: { fy: '2027' } })
  C('u_santosh', 'GET', '/budgets')
}))
S.push(K.scenario('budgets maker-checker', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  C('u_santosh', 'PUT', '/budgets', { body: { fy_start_year: 2026, category: 'Hosting', monthly_paise: Array(12).fill(250000) } })
  C('u_santosh', 'DELETE', '/budgets/:id', { params: { id: 'bud_01rg' } })
  C('u_santosh', 'POST', '/budgets/copy', { body: { to_fy: 2027 } })
  C('u_santosh', 'GET', '/budgets')
  for (const c of a.db.change_sets.filter((x) => x.status === 'pending' && x.entity === 'budget')) C('u_debasish', 'POST', '/changes/:id/approve', { params: { id: c.id }, body: {} })
  C('u_santosh', 'GET', '/budgets')
  C('u_santosh', 'GET', '/budgets', { query: { fy: '2027' } })
}, [{ kind: 'set', table: 'tenants', id: 'tn_seereon', values: { maker_checker: { enabled: true, entities: ['vendor', 'budget'], sla_days: 2 } } }]))
// ---------- leakage ----------
S.push(K.scenario('leakage', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  for (const body of [{}, { kind: 'lost_deal' }, { kind: 'discount' }, { kind: 'discount', amount_paise: 1000 }, { kind: 'discount', amount_paise: 1000, date: '2099-01-01' }, { kind: 'discount', amount_paise: 1000, date: TODAY, reason: 'short' },
    { kind: 'discount', amount_paise: 1000, date: TODAY, reason: 'Long enough reason' }, { kind: 'discount', amount_paise: 1000, date: TODAY, reason: 'Long enough reason', client: 'X', status: 'odd' },
    { kind: 'discount', amount_paise: 1000, date: TODAY, reason: 'Long enough reason', client: 'X', recovered_paise: 2000 }, { kind: 'penalty', amount_paise: 1000, date: TODAY, reason: 'Long enough reason', project_id: 'nope' }])
    C('u_santosh', 'POST', '/leakage', { body })
  const l1 = C('u_santosh', 'POST', '/leakage', { body: { kind: 'penalty', amount_paise: 250000, date: '2026-10-02', reason: 'SLA breach penalty on AMS ticket backlog', project_id: 'p_rcu' } })
  C('u_santosh', 'POST', '/leakage', { body: { kind: 'churn', amount_paise: 990000, date: '2026-04-10', reason: 'Client moved the SaaS plan to a competitor', client: ' Kalinga Hospital ', status: 'recovered', recoverable: 0, deal_id: 'd_x' } })
  C('u_hritesh', 'POST', '/leakage', { body: { kind: 'discount' } })
  if (l1.v) {
    C('u_santosh', 'PATCH', '/leakage/:id', { params: { id: l1.v.id }, body: { status: 'recovered' }, ifMatch: 1 })
    C('u_santosh', 'PATCH', '/leakage/:id', { params: { id: l1.v.id }, body: { recovered_paise: 100000, status: 'open' } })
    C('u_santosh', 'DELETE', '/leakage/:id', { params: { id: l1.v.id }, ifMatch: 1 })
    C('u_santosh', 'DELETE', '/leakage/:id', { params: { id: l1.v.id } })
  }
  C('u_santosh', 'PATCH', '/leakage/:id', { params: { id: 'auto_deal_x' }, body: {} })
  C('u_santosh', 'DELETE', '/leakage/:id', { params: { id: 'auto_deal_x' } })
  C('u_santosh', 'PATCH', '/leakage/:id', { params: { id: 'leak_01ss' }, body: { recovered_paise: 1800000 } })
  C('u_santosh', 'GET', '/leakage')
  C('u_santosh', 'GET', '/leakage', { query: { fy: '2025' } })
  C('u_santosh', 'GET', '/spend/summary')
}))

const size = writeGz('spend.json.gz', { generated_on: seed.generated_on, scenarios: S })
console.log(`spend vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
