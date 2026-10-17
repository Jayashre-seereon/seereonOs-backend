// Golden vectors for app/routes/sales.py (port of src/mock/routes/sales.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/sales.mjs -> vectors/sales.json.gz
// Reads for every user of both tenants on several days (every deal's detail, every query variant), every write route
// with valid + invalid bodies and allowed + denied users, the stage-history repair, and the exports (viewDeal,
// closedInMonth, compFor) for every deal / sales person / month.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

Math.random = () => 0.5 // project colour hue of create-project (Python: random.randrange patched to 180)
const M = await loadTs('sales', `export * as sa from '@/mock/routes/sales'\n`)
const { server, sa } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['deals', 'deal_activities', 'deal_stage_history', 'projects', 'project_status_history', 'activity_log', 'notifications', 'number_sequences']
const fns = {
  viewDeals: (ctx) => server.rows(ctx, 'deals').map((d) => sa.viewDeal(ctx, d)),
  closedInMonth: (ctx, a) => a.users.flatMap((u) => a.months.map((m) => sa.closedInMonth(server.rows(ctx, 'deals'), u, m))),
  compFor: (ctx, a) => a.users.flatMap((u) => a.months.map((m) => sa.compFor(ctx, u, m))),
  products: () => sa.PRODUCTS,
}
const K = kit({ server, T, modules: [sa], tables: TABLES, fns })
// the repair of bad stage-history rows is transient in the reference server (in-place mutation without persist()),
// so the repair scenarios compare responses only (no stage-history rows in the diff)
const KR = kit({ server, T, modules: [sa], tables: ['deals', 'notifications'], fns })
const TODAY = seed.generated_on
const S = []
const months = (y0, m0, n) => Array.from({ length: n }, (_, i) => { const t = y0 * 12 + m0 - 1 + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}` })
const MONTHS = months(2025, 10, 16)

const READERS = { tn_seereon: ['u_santosh', 'u_debasish', 'u_baishali', 'u_subham', 'u_subhankar', 'u_hritesh', 'u_priya'], tn_kalinga: ['u_k_ananya', 'u_k_meera', 'u_k_rakesh'] }
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2027-04-02', '2026-04-01'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        for (const query of [{}, { q: ' School ' }, { stage: 'proposal' }, { source: 'bni', product: 'EduReon' }, { owner_id: 'u_subham' }, { owner_id: 'u_baishali', q: 'zzz' }])
          a.call(u, 'GET', '/sales/deals', { query })
        for (const query of [{}, { owner_id: 'u_subham' }, { owner_id: '' }, { week: '2026-09-02' }, { week: 'bad' }]) a.call(u, 'GET', '/sales/summary', { query })
        for (const query of [{}, { days: '90' }, { days: '0' }, { days: '400' }, { days: 'x' }, { from: '2026-05-01', to: '2026-09-30' }, { from: '2026-09-30', to: '2026-05-01' }, { user_id: 'u_subham', days: '365' }, { to: '2026-06-30' }])
          a.call(u, 'GET', '/sales/activity', { query })
        for (const d of a.db.deals.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/sales/deals/:id', { params: { id: d.id } })
        a.call(u, 'GET', '/sales/deals/:id', { params: { id: 'nope' } })
        for (const query of [{}, { kind: 'quarter' }, { kind: 'fy' }, { kind: 'year', anchor: '2025-06-15' }, { month: '2026-07' }, { from: '2026-01-01', to: '2026-12-31' }, { from: '2026-12-31', to: '2026-01-01' }, { from: '2026-01-01' }, { anchor: '2026-02-30' }])
          a.call(u, 'GET', '/sales/performance', { query })
        for (const query of [{}, { kind: 'quarter', anchor: '2026-04-10' }, { kind: 'fy' }, { month: '2026-08' }, { kind: 'year' }, { kind: 'month', anchor: '2027-03-01' }])
          a.call(u, 'GET', '/sales/compensation', { query })
      }
      a.fn(users[0], 'viewDeals')
      a.fn(users[0], 'products')
      const people = a.db.users.filter((u) => u.tenant_id === tid).map((u) => u.id)
      a.fn(users[0], 'closedInMonth', { users: people, months: MONTHS })
      a.fn(users[0], 'compFor', { users: people, months: MONTHS })
    }))

// ---------- writes ----------
S.push(K.scenario('deals lifecycle', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const base = { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01' }
  for (const [u, body] of [
    ['u_hritesh', base], ['u_baishali', { client: 'X', expected_close: '2026-12-01' }], ['u_baishali', { ...base, title: '   ' }], ['u_baishali', { ...base, client: 5 }],
    ['u_baishali', { ...base, expected_close: '2026-02-30' }], ['u_baishali', { title: 'A', client: 'B' }], ['u_baishali', { ...base, value_paise: -5 }], ['u_baishali', { ...base, value_paise: 1.5 }],
    ['u_baishali', { ...base, mrr_paise: '100' }], ['u_baishali', { ...base, value_paise: true }], ['u_baishali', { ...base, phone: '12ab' }], ['u_baishali', { ...base, phone: '123' }], ['u_baishali', { ...base, email: 'x@' }],
    ['u_baishali', { ...base, source: 'tv' }], ['u_baishali', { ...base, product: 'Toaster' }], ['u_baishali', { ...base, owner_id: 'u_hritesh' }], ['u_baishali', { ...base, owner_id: 'u_ankit' }],
    ['u_baishali', { ...base, owner_id: 'u_nobody' }], ['u_subham', { ...base, owner_id: 'u_baishali' }], ['u_baishali', { ...base, stage: 'won' }], ['u_baishali', { ...base, stage: 'nope' }],
    ['u_baishali', { ...base, next_step_on: 'soon', next_step: 'Call' }], ['u_baishali', { ...base, first_conversation: 'x'.repeat(2001) }], ['u_baishali', { ...base, owner_id: '' }],
  ]) C(u, 'POST', '/sales/deals', { body })
  const c1 = C('u_baishali', 'POST', '/sales/deals', {
    body: {
      title: '  ERP rollout ', client: ' DAV School ', contact: ' Mr Rao ', phone: '+91 98765-43210', email: 'rao@dav.example', product: 'EduReon', source: 'bni', owner_id: 'u_subham',
      value_paise: 12000000, mrr_paise: 500000, expected_close: '2026-12-01', notes: ' warm ', next_step: ' Demo ', next_step_on: '2026-10-20', first_conversation: ' Met at the BNI meeting and talked about fees, transport and the parent app for their three campuses, which is a long story worth more than one hundred and twenty characters. ',
    },
  })
  const c2 = C('u_subham', 'POST', '/sales/deals', { body: { title: 'Payroll pilot', client: 'Kalinga Steel', expected_close: '2026-11-15', stage: 'qualified', next_step: '  ', next_step_on: '2026-10-30' } })
  C('u_santosh', 'POST', '/sales/deals', { body: { title: 'SAP AMS renewal', client: 'Semtech', expected_close: '2026-10-31', product: 'SAP consulting', value_paise: 0, mrr_paise: 0 } })
  const id1 = c1.v?.id ?? 'x'
  const id2 = c2.v?.id ?? 'x'
  const P = (id) => ({ params: { id } })
  C('u_subham', 'GET', '/sales/deals/:id', P(id1))
  C('u_hritesh', 'GET', '/sales/deals/:id', P(id1))
  C('u_baishali', 'GET', '/sales/deals/:id', P(id2))
  // edit
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { title: '' } })
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { mrr_paise: 'lots' } })
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { owner_id: 'u_baishali' } })
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { notes: 'x' }, ifMatch: 9 })
  C('u_hritesh', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { notes: 'x' } })
  C('u_baishali', 'PATCH', '/sales/deals/:id', { ...P(id2), body: { title: ' Payroll pilot v2 ', contact: ' Ms Das ', next_step: '', next_step_on: '2026-10-25', value_paise: 0, stage: 'won', owner_id: 'u_baishali', product: '', id: 'zz', version: 99, last_activity_on: '2020-01-01' } })
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id2), body: { notes: 'mine?' } })
  C('u_baishali', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { expected_close: '' } })
  C('u_baishali', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { next_step: ' Proposal ', next_step_on: '' } })
  C('u_santosh', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { owner_id: 'u_baishali', source: '' } })
  C('u_santosh', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { owner_id: 'u_subham' } })
  // stage moves
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'archived' } })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'lost', reason: ' no ' } })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'lead' } })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'proposal' }, ifMatch: 1 })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'proposal' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id2), body: { stage: 'won' } })
  C('u_baishali', 'PATCH', '/sales/deals/:id', { ...P(id2), body: { value_paise: 2500000 } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id2), body: { stage: 'won' } })
  C('u_baishali', 'PATCH', '/sales/deals/:id', { ...P(id2), body: { value_paise: 0, mrr_paise: 0 } })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'won' } })
  C('u_subham', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'negotiation' } })
  C('u_subham', 'PATCH', '/sales/deals/:id', { ...P(id1), body: { notes: 'closed now' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'negotiation' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'lost', reason: 'Went with a cheaper vendor' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'lead', reason: 'They came back' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'lost', reason: 'Again' } })
  C('u_baishali', 'POST', '/sales/deals/:id/stage', { ...P(id1), body: { stage: 'demo' } })
  C('u_santosh', 'POST', '/sales/deals/:id/stage', { ...P('d_mgs'), body: { stage: 'won' } })
  // activities
  for (const body of [{ type: 'telegram', note: 'Called them' }, { note: 'Called them' }, { type: 'call', note: 'ok' }, { type: 'call', note: 'Called them', date: '2099-01-01' }, { type: 'call', note: 'Called them', date: 'yesterday' }])
    C('u_subham', 'POST', '/sales/deals/:id/activities', { ...P(id1), body })
  C('u_hritesh', 'POST', '/sales/deals/:id/activities', { ...P(id1), body: { type: 'call', note: 'Called them' } })
  C('u_subham', 'POST', '/sales/deals/:id/activities', { ...P(id1), body: { type: 'meeting', note: ' Walked the principal through the fees module ', date: '2026-10-01', next_step: ' Send proposal ' } })
  C('u_subham', 'POST', '/sales/deals/:id/activities', { ...P(id1), body: { type: 'email', note: 'Sent the proposal', next_step: '' } })
  C('u_subham', 'POST', '/sales/deals/:id/activities', { ...P(id1), body: { type: 'whatsapp', note: 'Pinged the bursar', next_step: 'Call back', next_step_on: '2026-11-02', date: '2026-09-01' } })
  C('u_subham', 'GET', '/sales/deals/:id', P(id1))
  // project from a won deal
  C('u_subham', 'POST', '/sales/deals/:id/create-project', { ...P(id2), body: { name: 'X', client: 'Y' } })
  C('u_santosh', 'POST', '/sales/deals/:id/create-project', { ...P(id1), body: { name: 'X', client: 'Y' } })
  for (const body of [{ name: ' ', client: 'Y' }, { name: 'Payroll pilot', client: '' }, { name: 'Payroll pilot', client: 'Kalinga Steel', contract_value_paise: -1 }, { name: 'Payroll pilot', client: 'Kalinga Steel', contract_value_paise: 'x' },
    { name: 'Payroll pilot', client: 'Kalinga Steel', type: 'retainer' }, { name: 'Payroll pilot', client: 'Kalinga Steel', start_on: '2026-11-01', end_on: '2026-10-01' }, { name: 'Payroll pilot', client: 'Kalinga Steel', pm_id: 'u_hritesh' }])
    C('u_santosh', 'POST', '/sales/deals/:id/create-project', { ...P(id2), body })
  C('u_santosh', 'POST', '/sales/deals/:id/create-project', { ...P(id2), body: { name: 'Payroll pilot', client: 'Kalinga Steel', pm_id: 'u_subhankar', start_on: '2026-11-01', stream: 'ams', billing_model: 'tm' } })
  C('u_santosh', 'POST', '/sales/deals/:id/create-project', { ...P(id2), body: { name: 'Payroll pilot', client: 'Kalinga Steel' } })
  C('u_santosh', 'POST', '/sales/deals/:id/create-project', { ...P('d_mgs'), body: { name: 'MGS rollout', client: 'Mother’s Group', contract_value_paise: '2500000' } })
  C('u_santosh', 'GET', '/sales/deals/:id', P(id2))
  // delete
  C('u_subham', 'DELETE', '/sales/deals/:id', P(id1))
  C('u_santosh', 'DELETE', '/sales/deals/:id', { ...P(id1), ifMatch: 1 })
  C('u_santosh', 'DELETE', '/sales/deals/:id', P(id2))
  C('u_santosh', 'GET', '/sales/deals/:id', P(id2))
  C('u_santosh', 'DELETE', '/sales/deals/:id', P('d_mgs'))
  for (const u of ['u_santosh', 'u_baishali', 'u_subham']) {
    C(u, 'GET', '/sales/deals')
    C(u, 'GET', '/sales/summary')
    C(u, 'GET', '/sales/activity', { query: { days: '60' } })
    C(u, 'GET', '/sales/performance')
    C(u, 'GET', '/sales/compensation')
  }
}))

// stale-deal notifications once a day (GET /sales/deals writes NTF-12)
S.push(K.scenario('stale notices', 'tn_seereon', '2026-12-20', (a) => {
  a.call('u_baishali', 'GET', '/sales/deals')
  a.call('u_santosh', 'GET', '/sales/deals')
  a.call('u_baishali', 'GET', '/sales/deals')
}))

// rows written by the old stage-move bug ("Won → Won · Reopened by admin") are repaired on read
const bad = (id, deal, from, to, at, reason) => ({ kind: 'insert', table: 'deal_stage_history', row: { id, tenant_id: 'tn_seereon', created_at: at, updated_at: at, created_by: null, version: 1, deal_id: deal, from_stage: from, to_stage: to, by: 'u_santosh', at, reason } })
const firstDeal = T.deals.find((d) => d.tenant_id === 'tn_seereon')
S.push(KR.scenario('stage repair', 'tn_seereon', TODAY, (a) => {
  for (const u of ['u_santosh', 'u_baishali']) {
    a.call(u, 'GET', '/sales/activity', { query: { days: '366' } })
    for (const d of a.db.deals.filter((x) => x.tenant_id === 'tn_seereon')) a.call(u, 'GET', '/sales/deals/:id', { params: { id: d.id } })
  }
}, [
  bad('h_bad1', firstDeal.id, 'won', 'won', '2026-10-10T10:00:00.000Z', 'Reopened by admin'),
  bad('h_bad2', firstDeal.id, 'lost', 'lost', '2026-10-11T10:00:00.000Z', 'Reopened by admin'),
  bad('h_bad3', 'd_mgs', 'lead', 'lead', '2020-01-01T00:00:00.000Z', 'Reopened by admin'),
  bad('h_bad4', 'd_mgs', 'demo', 'demo', '2026-10-12T00:00:00.000Z', 'Other'),
]))

writeGz('sales.json.gz', { scenarios: S })
console.log(`sales: ${S.length} scenarios, ${S.reduce((n, s) => n + s.steps.length, 0)} steps`)
