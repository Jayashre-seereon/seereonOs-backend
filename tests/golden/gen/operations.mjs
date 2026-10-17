// Golden vectors for app/routes/operations.py (port of src/mock/routes/operations.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/operations.mjs -> vectors/operations.json.gz
// The register (filters, overdue NTF-13 reminders at most once a day), the summary for several users / days, every
// write (valid + invalid, allowed + denied): create, edit, mark done with roll-forward (weekly … yearly, very late),
// delete; and the exports periodOf / nextDue / opsSummary.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('operations', `export * as op from '@/mock/routes/operations'\n`)
const { server, op } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['ops_items', 'notifications', 'activity_log']
const K = kit({
  server, T, modules: [op], tables: TABLES,
  fns: {
    periodOf: (_ctx, a) => a.dates.map((d) => ['none', 'weekly', 'monthly', 'quarterly', 'yearly', 'x'].map((r) => [op.periodOf(d, r), op.periodOf(d, r, 1), op.nextDue(d, r)])),
    opsSummary: (ctx) => op.opsSummary(ctx),
  },
})
const TODAY = seed.generated_on
const S = []
const USERS = ['u_santosh', 'u_subhankar', 'u_hritesh', 'u_priya', 'u_debasish', 'u_baishali']
for (const today of [TODAY, '2026-11-02', '2027-01-15', '2026-07-01'])
  S.push(K.scenario(`reads ${today}`, 'tn_seereon', today, (a) => {
    for (const u of USERS) {
      a.call(u, 'GET', '/ops')
      a.call(u, 'GET', '/ops')
      a.call(u, 'GET', '/ops', { query: { owner_id: 'u_priya' } })
      a.call(u, 'GET', '/ops', { query: { category: 'compliance', q: ' GST ' } })
      a.call(u, 'GET', '/ops', { query: { q: 'zzz' } })
      a.call(u, 'GET', '/ops/summary')
      a.fn(u, 'opsSummary')
    }
    a.fn('u_santosh', 'periodOf', { dates: ['2026-01-01', '2026-03-31', '2026-04-01', '2026-10-15', '2026-12-31', '2027-02-28', '2024-02-29'] })
  }))
S.push(K.scenario('reads kalinga', 'tn_kalinga', TODAY, (a) => {
  for (const u of ['u_k_ananya', 'u_k_rakesh', 'u_k_meera']) {
    a.call(u, 'GET', '/ops')
    a.call(u, 'GET', '/ops/summary')
  }
}))
S.push(K.scenario('writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  for (const body of [{}, { item: 'ab' }, { item: 'TDS return' }, { item: 'TDS return', category: 'tax' }, { item: 'TDS return', category: 'compliance' },
    { item: 'TDS return', category: 'compliance', recurring: 'daily' }, { item: 'TDS return', category: 'compliance', recurring: 'quarterly' },
    { item: 'TDS return', category: 'compliance', recurring: 'quarterly', due_on: '2026/10/31' }, { item: 'TDS return', category: 'compliance', recurring: 'quarterly', due_on: '2026-10-31' },
    { item: 'TDS return', category: 'compliance', recurring: 'quarterly', due_on: '2026-10-31', owner_id: 'u_ankit' }, { item: 12345, category: 'compliance', recurring: 'none', due_on: '2026-10-31', owner_id: 'u_priya' }])
    C('u_priya', 'POST', '/ops', { body })
  C('u_hritesh', 'POST', '/ops', { body: { item: 'Nope', category: 'it', recurring: 'none', due_on: TODAY, owner_id: 'u_hritesh' } })
  const w = C('u_priya', 'POST', '/ops', { body: { item: '  Weekly backup check ', category: 'it', recurring: 'weekly', due_on: '2026-09-01', owner_id: 'u_hritesh', notes: '  NAS + cloud  ' } })
  const m = C('u_priya', 'POST', '/ops', { body: { item: 'Monthly PF filing', category: 'payroll', recurring: 'monthly', due_on: '2026-01-31', owner_id: 'u_priya' } })
  const q = C('u_priya', 'POST', '/ops', { body: { item: 'Quarterly GST', category: 'compliance', recurring: 'quarterly', due_on: '2026-10-20', owner_id: 'u_debasish' } })
  const y = C('u_priya', 'POST', '/ops', { body: { item: 'Annual audit', category: 'finance', recurring: 'yearly', due_on: '2026-06-30', owner_id: 'u_santosh' } })
  const n = C('u_priya', 'POST', '/ops', { body: { item: 'One-off licence renewal', category: 'admin', recurring: 'none', due_on: '2026-10-01', owner_id: 'u_priya' } })
  C('u_priya', 'GET', '/ops')
  C('u_priya', 'GET', '/ops')
  for (const r of [w, m, q, y, n]) {
    const id = r.v?.id
    if (!id) continue
    C('u_hritesh', 'POST', '/ops/:id/done', { params: { id } })
    C('u_priya', 'POST', '/ops/:id/done', { params: { id }, body: { done_on: '2099-01-01' } })
    C('u_priya', 'POST', '/ops/:id/done', { params: { id }, ifMatch: 9 })
    C('u_priya', 'POST', '/ops/:id/done', { params: { id }, body: { done_on: 'bad' } })
    C('u_priya', 'POST', '/ops/:id/done', { params: { id }, body: { done_on: '2026-10-10' } })
    C('u_priya', 'POST', '/ops/:id/done', { params: { id } })
  }
  if (n.v?.id) {
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { status: 'open', due_on: '2026-12-01', notes: '  reopened ', item: '  Renewal  ' } })
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { status: 'weird', category: 'nope' } })
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { owner_id: 'u_nope' } })
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { item: 'x' } })
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { recurring: 'monthly', status: 'done' }, ifMatch: 1 })
    C('u_priya', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: { recurring: 'monthly', status: 'done' } })
    C('u_hritesh', 'PATCH', '/ops/:id', { params: { id: n.v.id }, body: {} })
    C('u_hritesh', 'DELETE', '/ops/:id', { params: { id: n.v.id } })
    C('u_priya', 'DELETE', '/ops/:id', { params: { id: n.v.id }, ifMatch: 99 })
    C('u_priya', 'DELETE', '/ops/:id', { params: { id: n.v.id } })
    C('u_priya', 'DELETE', '/ops/:id', { params: { id: n.v.id } })
  }
  C('u_priya', 'PATCH', '/ops/:id', { params: { id: 'nope' }, body: {} })
  for (const o of a.db.ops_items.filter((x) => x.tenant_id === 'tn_seereon').slice(0, 6)) C('u_santosh', 'POST', '/ops/:id/done', { params: { id: o.id } })
  C('u_priya', 'GET', '/ops')
  C('u_priya', 'GET', '/ops/summary')
}))

const size = writeGz('operations.json.gz', { generated_on: seed.generated_on, scenarios: S })
console.log(`operations vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
