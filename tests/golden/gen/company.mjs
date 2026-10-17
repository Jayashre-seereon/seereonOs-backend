// Golden vectors for app/routes/company.py (port of src/mock/routes/company.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/company.mjs -> vectors/company.json.gz
// The approvals inbox (+ summary, my requests) for every user of both tenants on several days (with the lazy lock /
// escalation sweeps it writes), OKRs (views, every write route valid + invalid, allowed + denied, auto metrics),
// the audit trail with every filter, permission holders, and inboxItems as an export.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('company', `export * as co from '@/mock/routes/company'\nexport * as cost from '@/mock/costing'\n`)
const { server, co } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['objectives', 'key_results', 'activity_log', 'notifications', 'timesheet_weeks', 'leave_requests', 'expense_claims', 'purchase_orders', 'vendor_bills', 'tasks', 'wf_instances', 'approval_workflows']
const K = kit({ server, T, modules: [co], tables: TABLES, fns: { inboxItems: (ctx) => co.inboxItems(ctx) } })
const TODAY = seed.generated_on
const S = []

const READERS = { tn_seereon: ['u_santosh', 'u_debasish', 'u_subhankar', 'u_hritesh', 'u_priya', 'u_baishali', 'u_subham', 'u_jayashree', 'u_bijaya'], tn_kalinga: ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha', 'u_k_meera'] }
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2026-10-26', '2027-01-11'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        a.call(u, 'GET', '/inbox')
        a.call(u, 'GET', '/inbox/summary')
        a.call(u, 'GET', '/inbox/mine')
        for (const query of [{}, { period: 'Q2 FY26-27' }, { period: 'Q9 FY99', owner: 'u_baishali' }, { owner: 'u_hritesh' }, { period: 'Q4 FY26-27' }]) a.call(u, 'GET', '/okrs', { query })
        for (const query of [{}, { perm: 'bogus, x' }, { perm: 'deals.edit_own' }, { perm: ' projects.edit ,timesheet.approve' }]) a.call(u, 'GET', '/directory/holders', { query })
        for (const query of [{}, { q: 'stage' }, { actor: 'u_baishali', entity: 'deal' }, { from: '2026-09-01', to: '2026-09-30', page: '2' }, { all: '1' }, { page: 'abc' }, { entity: 'objective', q: 'SANTOSH' }])
          a.call(u, 'GET', '/audit', { query })
        a.call(u, 'GET', '/workflows')
      }
      a.fn(users[0], 'inboxItems')
    }))

S.push(K.scenario('okrs', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const O = (body) => ({ body })
  for (const [u, body] of [
    ['u_hritesh', { level: 'galaxy', title: 'Something big' }], ['u_hritesh', { level: 'person', title: 'ab' }], ['u_hritesh', { level: 'person', title: 'x'.repeat(161) }],
    ['u_hritesh', { level: 'company', title: 'Rule the market' }], ['u_hritesh', { level: 'team', title: 'My own team goal' }], ['u_hritesh', { level: 'person', title: 'Learn Rust', owner_id: 'u_bijaya' }],
    ['u_hritesh', { level: 'person', title: 'Learn Rust', owner_id: 'u_nobody' }], ['u_hritesh', { level: 'person', title: 'Learn Rust', parent_id: 'okr_hritesh' }],
    ['u_hritesh', { level: 'person', title: 'Learn Rust', parent_id: 'okr_p_ontime' }], ['u_hritesh', { level: 'person', title: 'Learn Rust', parent_id: 'okr_nope' }],
    ['u_santosh', { level: 'company', title: 'Expand again', parent_id: 'okr_rev' }], ['u_subhankar', { level: 'team', title: 'Team goal', parent_id: 'okr_delivery' }],
  ]) C(u, 'POST', '/okrs/objectives', O(body))
  const o1 = C('u_hritesh', 'POST', '/okrs/objectives', O({ level: 'person', title: '  Learn Rust properly  ', parent_id: 'okr_delivery' }))
  const o2 = C('u_subhankar', 'POST', '/okrs/objectives', O({ level: 'team', title: 'Zero escaped defects', owner_id: 'u_subhankar', period: 'Q2 FY26-27' }))
  const o3 = C('u_santosh', 'POST', '/okrs/objectives', O({ level: 'company', title: 'Expand to two new cities', period: 'nope' }))
  const o4 = C('u_subhankar', 'POST', '/okrs/objectives', O({ level: 'person', title: 'Hritesh leads HRMS', owner_id: 'u_hritesh', parent_id: 'okr_delivery', period: 'Q4 FY26-27' }))
  const P = (r) => ({ params: { id: r.v?.id ?? 'x' } })
  C('u_bijaya', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { title: 'Not mine' } })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { status: 'paused' } })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { parent_id: 'okr_rev' } })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { parent_id: o1.v?.id } })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { parent_id: 'okr_hritesh' } })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { title: 'Learn Rust and ship it', parent_id: null }, ifMatch: 7 })
  C('u_hritesh', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { title: 'Learn Rust and ship it', parent_id: null } })
  C('u_subhankar', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { status: 'done' } })
  C('u_subhankar', 'PATCH', '/okrs/objectives/:id', { ...P(o1), body: { status: 'on_track' } })
  C('u_santosh', 'PATCH', '/okrs/objectives/:id', { ...P(o3), body: { parent_id: 'okr_rev' } })
  C('u_santosh', 'PATCH', '/okrs/objectives/:id', { params: { id: 'nope' }, body: {} })
  // key results
  const KR = (u, o, body) => C(u, 'POST', '/okrs/objectives/:id/key-results', { ...P(o), body })
  for (const body of [{ title: 'Something', metric: 'vibes', target: 5 }, { title: 'ok', target: 5 }, { title: 'Ship modules', target: 'lots' }, { title: 'Ship modules', target: '' }, { title: 'Ship modules', target: null },
    { title: 'Ship modules', target: 0 }, { title: 'Ship modules', target: '7', start_value: '7' }, { title: 'On-time share', metric: 'on_time_task_pct', target: 120 }, { title: 'Ship modules', target: 4, owner_id: 'u_nobody' }])
    KR('u_hritesh', o1, body)
  const k1 = KR('u_hritesh', o1, { title: ' Ship modules ', target: 4, unit: ' modules in production ' })
  const k2 = KR('u_hritesh', o1, { title: 'On-time share', metric: 'on_time_task_pct', start_value: 60, target: 90 })
  for (const t of ['Third KR', 'Fourth KR', 'Fifth KR', 'Sixth KR', 'Seventh KR']) KR('u_hritesh', o1, { title: t, target: 3, unit: '%' })
  KR('u_bijaya', o1, { title: 'Bijaya adds', target: 3 })
  KR('u_subhankar', o2, { title: 'Escaped defects', start_value: 10, target: 0, unit: '₹' })
  KR('u_subhankar', o2, { title: 'Hiring done', metric: 'headcount', start_value: 5, target: 9 })
  KR('u_subhankar', o4, { title: 'HRMS compliance', metric: 'timesheet_compliance', start_value: 50, target: 95 })
  for (const body of [{ title: 'Revenue from new cities', metric: 'revenue_billed', target: 1000000 }, { title: 'Collected', metric: 'revenue_collected', target: 900000 }, { title: 'Leakage down', metric: 'leakage', start_value: 500000, target: 0 },
    { title: 'Margin', metric: 'margin_pct', start_value: 10, target: 30 }, { title: 'Deals won', metric: 'deals_won_value', target: 5000000 }, { title: 'Compliance', metric: 'timesheet_compliance', start_value: 50, target: 95 }])
    KR('u_santosh', o3, body)
  const Q = (r) => ({ params: { id: r.v?.id ?? 'x' } })
  C('u_bijaya', 'PATCH', '/okrs/key-results/:id', { ...Q(k1), body: { target: 6 } })
  C('u_hritesh', 'PATCH', '/okrs/key-results/:id', { ...Q(k1), body: { target: 0 } })
  C('u_hritesh', 'PATCH', '/okrs/key-results/:id', { ...Q(k1), body: { target: 6, title: 'Ship six modules' } })
  C('u_hritesh', 'PATCH', '/okrs/key-results/:id', { ...Q(k1), body: { metric: 'headcount' } })
  C('u_hritesh', 'POST', '/okrs/key-results/:id/check-in', { ...Q(k2), body: { value: 70, note: 'Going well' } })
  C('u_bijaya', 'POST', '/okrs/key-results/:id/check-in', { ...Q(k1), body: { value: 2, note: 'Two modules done' } })
  for (const body of [{ value: 'two', note: 'Two modules done' }, { value: '', note: 'Two modules done' }, { note: 'Two modules done' }, { value: 2, note: 'ok' }]) C('u_hritesh', 'POST', '/okrs/key-results/:id/check-in', { ...Q(k1), body })
  C('u_hritesh', 'POST', '/okrs/key-results/:id/check-in', { ...Q(k1), body: { value: 2.5, note: ' Two and a half modules done ' } })
  C('u_hritesh', 'POST', '/okrs/key-results/:id/check-in', { ...Q(k1), body: { value: '3', note: 'Three done now' }, ifMatch: 1 })
  C('u_subhankar', 'POST', '/okrs/key-results/:id/check-in', { params: { id: 'okr_delivery_kr3' }, body: { value: 3, note: 'Three defects this sprint' } })
  C('u_hritesh', 'POST', '/okrs/key-results/:id/check-in', { params: { id: 'okr_delivery_kr3' }, body: { value: 2, note: 'Two defects now, fixed one' } })
  C('u_santosh', 'POST', '/okrs/key-results/:id/check-in', { params: { id: 'okr_sales_kr1' }, body: { value: 35, note: 'Pipeline report shared' } })
  for (const u of ['u_hritesh', 'u_subhankar', 'u_santosh', 'u_priya', 'u_baishali']) {
    C(u, 'GET', '/okrs')
    C(u, 'GET', '/okrs', { query: { period: 'Q4 FY26-27' } })
  }
  C('u_hritesh', 'DELETE', '/okrs/key-results/:id', Q(k2))
  C('u_bijaya', 'DELETE', '/okrs/key-results/:id', Q(k1))
  C('u_subhankar', 'DELETE', '/okrs/objectives/:id', { params: { id: 'okr_delivery' } })
  C('u_hritesh', 'DELETE', '/okrs/objectives/:id', { params: { id: 'okr_bijaya' } })
  C('u_hritesh', 'DELETE', '/okrs/objectives/:id', P(o1))
  C('u_santosh', 'DELETE', '/okrs/objectives/:id', P(o3))
  C('u_santosh', 'GET', '/okrs')
  C('u_santosh', 'GET', '/audit', { query: { q: 'objective' } })
  C('u_santosh', 'GET', '/audit', { query: { entity: 'key_result', all: '1' } })
}))

writeGz('company.json.gz', { scenarios: S })
console.log(`company: ${S.length} scenarios, ${S.reduce((n, s) => n + s.steps.length, 0)} steps`)
