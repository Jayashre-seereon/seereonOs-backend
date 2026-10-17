// Golden vectors for app/routes/estimates.py (port of src/mock/routes/estimates.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/estimates.mjs -> vectors/estimates.json.gz
// The estimate calculator (computeEstimate via /estimates/preview) over many bodies — role and named rows, salary
// privacy, milestone billing above / below the price, markup and price modes, contingency, invalid rows — plus list,
// compare, detail (redacted and not), every write route and the scenario / delete re-rooting rules.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('estimates', `export * as es from '@/mock/routes/estimates'\nexport * as co from '@/mock/costing'\n`)
const { server, es } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['cost_estimates', 'deals', 'projects', 'activity_log', 'number_sequences']
const K = kit({
  server, T, modules: [es], tables: TABLES,
  fns: {
    calcInputFromBody: (_ctx, a) => es.calcInputFromBody(a.b),
    estimatesForDeal: (ctx, a) => es.estimatesForDeal(ctx, a.deal),
    costingHidden: (ctx, a) => es.costingHidden(ctx, a.resources),
  },
})
const TODAY = seed.generated_on
const S = []
const perms = (uid, f = (p) => p) => f(server.permissionsOf(T.users.find((u) => u.id === uid)))
const NO_SAL = (p) => p.filter((x) => x !== 'cost_rates.view')

const MS3 = [{ name: 'Discovery', billing_amount_paise: 3000000 }, { name: 'Build', billing_amount_paise: 9000000 }, { name: 'Go-live', billing_amount_paise: 3000000 }]
const base = { name: 'Kalinga Public School — EduReon rollout', client: 'Kalinga Public School', type: 'product', billing_model: 'fixed', start_on: '2026-11-02', end_on: '2027-02-26', milestones: MS3, contingency_pct: 10, markup_pct: 35, price_mode: 'markup' }
const role = (i, ctc, pct = 100, extra = {}) => ({ key: `r${i}`, user_id: null, role_label: `Role ${i}`, monthly_ctc_paise: ctc, milestone_index: i % 3, pct, from_on: null, to_on: null, ...extra })
const person = (i, uid, pct = 50, extra = {}) => ({ key: `p${i}`, user_id: uid, role_label: null, monthly_ctc_paise: null, milestone_index: i % 3, pct, from_on: null, to_on: null, ...extra })
const PREVIEWS = [
  {}, { start_on: '2026-11-02' }, { ...base, resources: [] }, { ...base, resources: [role(0, 9000000), role(1, 6000000, 50), role(2, 12000000, 25)] },
  { ...base, resources: [role(0, 9000000)], additional_costs: [{ category: 'travel', description: 'Site visits', amount_paise: 450000 }, { category: 'nope', description: '', amount_paise: 0 }], maintenance_paise: 1200000 },
  { ...base, resources: [role(0, 9000000)], price_mode: 'price', price_paise: 10000000 }, { ...base, resources: [role(0, 9000000)], price_mode: 'price', price_paise: 500000 },
  { ...base, resources: [role(0, 9000000)], price_mode: 'price', price_paise: 50000000 }, { ...base, resources: [role(0, 9000000)], markup_pct: '' }, { ...base, resources: [role(0, 9000000)], markup_pct: -20 },
  { ...base, resources: [role(0, 9000000)], markup_pct: 2.345, contingency_pct: 150 }, { ...base, resources: [role(0, 9000000)], milestones: [{ name: 'All', billing_amount_paise: 0 }] },
  { ...base, resources: [role(0, 9000000)], milestones: [{ name: '  ' }, null, 'x', { name: 'Only', billing_amount_paise: -5 }] },
  { ...base, resources: [role(0, null), role(1, 0), { ...role(2, 5000000), role_label: '' }, { ...role(3, 5000000), milestone_index: null }, { ...role(4, 5000000), milestone_index: 9 }, { ...role(5, 5000000), pct: 0 }, { ...role(6, 5000000), pct: 'x' }] },
  { ...base, resources: [role(0, 5000000, 100, { from_on: '2026-12-01', to_on: '2026-11-15' }), role(1, 5000000, 100, { from_on: '2026-10-01', to_on: '2026-11-15' }), role(2, 5000000, 100, { from_on: '2026-12-01', to_on: '2027-06-01' }), role(3, 5000000, 100, { from_on: '2026-12-01', to_on: '2027-01-15' })] },
  { ...base, resources: [person(0, 'u_hritesh'), person(1, 'u_jagannath', 100), person(2, 'u_ankit'), person(3, 'u_nobody'), role(4, 7000000)] },
  { ...base, end_on: '2026-10-01', resources: [role(0, 9000000)] }, { ...base, start_on: 'x', resources: [role(0, 9000000)] },
  { ...base, start_on: '2026-11-02', end_on: '2026-11-04', milestones: [{ name: 'A', billing_amount_paise: 1 }, { name: 'B', billing_amount_paise: 1 }, { name: 'C', billing_amount_paise: 1 }, { name: 'D', billing_amount_paise: 1 }], resources: [role(0, 9000000)] },
  { ...base, contingency_pct: 7.5, maintenance_paise: '250000', resources: [role(0, '9000000.4', '33.3'), person(1, 'u_bijaya', 66.6)] },
]
// ---------- reads + previews ----------
for (const [tid, users] of Object.entries({ tn_seereon: ['u_santosh', 'u_subhankar', 'u_baishali', 'u_hritesh'], tn_kalinga: ['u_k_ananya', 'u_k_rakesh'] }))
  for (const variant of ['full', 'no_salary'])
    S.push(K.scenario(`reads ${tid} ${variant}`, tid, TODAY, (a) => {
      for (const u of users) {
        const po = variant === 'full' ? undefined : perms(u, NO_SAL)
        a.call(u, 'GET', '/estimates', { perms: po })
        for (const q of [{ status: 'draft' }, { status: 'converted' }, { q: 'est-00' }, { q: 'kalinga' }, { owner_id: u }]) a.call(u, 'GET', '/estimates', { query: q, perms: po })
        a.call(u, 'GET', '/estimates/options', { perms: po })
        for (const e of a.db.cost_estimates.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/estimates/:id', { params: { id: e.id }, perms: po })
        a.call(u, 'GET', '/estimates/:id', { params: { id: 'nope' }, perms: po })
        for (const ids of ['', 'est_kps', 'est_kps,est_utkal', 'est_kps,est_utkal,est_utkal_b,est_crm', ' est_kps , est_kps ,est_utkal', 'est_kps,nope', 'est_k_1,est_k_1']) a.call(u, 'GET', '/estimates/compare', { query: { ids }, perms: po })
        if (u === users[0]) for (const body of PREVIEWS) a.call(u, 'POST', '/estimates/preview', { body, perms: po })
      }
      a.fn(users[0], 'calcInputFromBody', { b: PREVIEWS[19] })
      a.fn(users[0], 'estimatesForDeal', { deal: 'd_kps' })
      a.fn(users[0], 'costingHidden', { resources: [{ user_id: null }, { user_id: 'u' }] })
    }))
// ---------- writes ----------
S.push(K.scenario('estimate writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const U = 'u_santosh'
  for (const body of [{}, { name: 'x'.repeat(141) }, { name: 'N' }, { name: 'N', client_id: 'nope' }, { name: 'N', deal_id: 'd_kps', type: 'odd' }, { name: 'N', client: 'C', billing_model: 'odd' }, { name: 'N', client: 'C' },
    { name: 'N', client: 'C', start_on: '2026-11-02' }, { name: 'N', client: 'C', start_on: '2026-11-02', end_on: '2026-11-01' }, { name: 'N', client: 'C', start_on: '2026-01-01', end_on: '2031-12-31' },
    { ...base, milestones: [{ name: 'A' }, { name: 'a' }] }, { ...base, milestones: Array.from({ length: 31 }, (_, i) => ({ name: `M${i}` })) }, { ...base, additional_costs: [{ amount_paise: -1 }] },
    { ...base, additional_costs: [{ amount_paise: 100 }] }, { ...base, contingency_pct: 120 }, { ...base, maintenance_paise: -1 }, { ...base, price_mode: 'price', price_paise: -1 }, { ...base, markup_pct: -100 },
    { ...base, resources: Array.from({ length: 81 }, (_, i) => role(i, 5000000)) }, { ...base, resources: [role(0, null)] }])
    C(U, 'POST', '/estimates', { body })
  C('u_subhankar', 'POST', '/estimates', { body: { ...base, resources: [person(0, 'u_hritesh')] } })
  C('u_hritesh', 'POST', '/estimates', { body: base })
  const e1 = C(U, 'POST', '/estimates', { body: { ...base, deal_id: 'd_kps', client: '', stream: 'products', resources: [role(0, 9000000), person(1, 'u_hritesh', 40)], notes: ' n ', description: ' d ' } })
  const e2 = C(U, 'POST', '/estimates', { body: { ...base, client_id: 'cl_mgs', markup_pct: 5, resources: [role(0, 9000000)] } })
  if (e1.v) {
    const id = e1.v.id
    C(U, 'PUT', '/estimates/:id', { params: { id }, body: { ...base, resources: [role(0, 9500000)] }, ifMatch: 9 })
    C(U, 'PUT', '/estimates/:id', { params: { id }, body: { ...base, resources: [role(0, 9500000)], revision_note: '  Repriced after call  ' }, ifMatch: 1 })
    C(U, 'POST', '/estimates/:id/duplicate', { params: { id }, body: { as_scenario: true } })
    C(U, 'POST', '/estimates/:id/duplicate', { params: { id }, body: { as_scenario: true } })
    C(U, 'POST', '/estimates/:id/duplicate', { params: { id }, body: {} })
    C('u_subhankar', 'POST', '/estimates/:id/duplicate', { params: { id: 'est_kps' }, body: {}, perms: perms('u_subhankar', NO_SAL) })
    C(U, 'GET', '/estimates/:id', { params: { id } })
    for (const body of [{ status: 'converted' }, { status: 'draft' }, { status: 'lost' }, { status: 'lost', reason: 'Budget moved to next year' }, { status: 'shared' }, { status: 'won' }])
      C(U, 'POST', '/estimates/:id/status', { params: { id }, body })
    C(U, 'POST', '/estimates/:id/convert', { params: { id }, body: {} })
    C(U, 'POST', '/estimates/:id/status', { params: { id }, body: { status: 'draft' } })
    C('u_baishali', 'POST', '/estimates/:id/convert', { params: { id }, body: { project_id: 'p_hrms' } })
    C(U, 'POST', '/estimates/:id/convert', { params: { id }, body: {} })
    C(U, 'POST', '/estimates/:id/convert', { params: { id }, body: { project_id: 'p_crm' } })
    C(U, 'POST', '/estimates/:id/convert', { params: { id }, body: { project_id: 'p_hrms' } })
    C(U, 'POST', '/estimates/:id/convert', { params: { id }, body: { project_id: 'p_hrms' } })
    C(U, 'PUT', '/estimates/:id', { params: { id }, body: base })
    C(U, 'POST', '/estimates/:id/status', { params: { id }, body: { status: 'draft' } })
    C(U, 'DELETE', '/estimates/:id', { params: { id } })
  }
  if (e2.v) {
    C(U, 'POST', '/estimates/:id/status', { params: { id: e2.v.id }, body: { status: 'shared' } })
    C(U, 'POST', '/estimates/:id/status', { params: { id: e2.v.id }, body: { status: 'lost', reason: 'Went with a cheaper vendor' } })
    C(U, 'POST', '/estimates/:id/convert', { params: { id: e2.v.id }, body: { project_id: 'p_hrms' } })
  }
  C(U, 'POST', '/estimates/:id/status', { params: { id: 'est_kps' }, body: { status: 'won' } })
  C(U, 'GET', '/estimates')
}))
S.push(K.scenario('scenario delete re-rooting', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const U = 'u_santosh'
  for (let i = 0; i < 3; i++) C(U, 'POST', '/estimates/:id/duplicate', { params: { id: 'est_utkal_b' }, body: { as_scenario: true } })
  C(U, 'DELETE', '/estimates/:id', { params: { id: 'est_utkal' } })
  C(U, 'POST', '/estimates/:id/status', { params: { id: 'est_utkal' }, body: { status: 'draft' } })
  C(U, 'DELETE', '/estimates/:id', { params: { id: 'est_utkal' }, ifMatch: 1 })
  C(U, 'DELETE', '/estimates/:id', { params: { id: 'est_utkal' } })
  C(U, 'GET', '/estimates')
  C(U, 'DELETE', '/estimates/:id', { params: { id: 'est_kps' } })
  const kid = a.db.cost_estimates.find((x) => x.tenant_id === 'tn_seereon' && x.scenario_of === null && x.id !== 'est_crm' && x.status === 'draft')
  if (kid) C(U, 'GET', '/estimates/:id', { params: { id: kid.id } })
}))

const size = writeGz('estimates.json.gz', { generated_on: seed.generated_on, year: new Date().getFullYear(), scenarios: S })
console.log(`estimates vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
