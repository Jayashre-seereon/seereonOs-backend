// Golden vectors for app/engine/costing.py (port of src/mock/costing.ts) on the full demo seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/costing.mjs -> vectors/costing.json.gz (seed: vectors/engine_seed.json.gz,
//   written by gen/docs.mjs — run that first when the seed changes)
// Every case runs on a fresh copy of the seed with one ctx (pinned ctx.today, explicit permission set) and calls the
// engine in a fixed order (the per-ctx memo makes some results order dependent, exactly like the TS); the Python test
// replays the same calls in the same order. Routes are exercised through registerCostingRoutes with plain deps.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { VECTORS, install, loadTs, makeCtx, norm, safe, writeGz } from './_engine.mjs'

const M = await loadTs('costing', `export * as co from '@/mock/costing'\nexport * as an from '@/mock/analytics'\n`)
const { server, co, an } = M
const seed = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(VECTORS, 'engine_seed.json.gz'))).toString('utf8'))
const T = seed.tables

/* routes through a capturing router; deps: everyone sees every project, editors = manage_all or the PM with projects.edit */
const routes = []
const cap = (method) => (p, h) => routes.push({ method, p, h })
co.registerCostingRoutes({ get: cap('GET'), post: cap('POST'), put: cap('PUT'), patch: cap('PATCH'), delete: cap('DELETE') }, {
  canView: () => true,
  canEdit: (ctx, p) => server.has(ctx, 'projects.manage_all') || (server.has(ctx, 'projects.edit') && p.pm_id === ctx.user.id),
})
const route = (method, p) => routes.find((r) => r.method === method && r.p === p).h
const call = (ctx, method, p, { params = {}, query = {}, body } = {}) => {
  const before = ctx.warnings.length
  const res = safe(() => route(method, p)({ ctx, params, query, body, ifMatch: undefined, headers: {} }))
  return { res, warnings: ctx.warnings.slice(before) }
}

const TODAYS = ['2026-10-15', '2026-07-01', '2027-01-20']
const ADMINS = { tn_seereon: ['u_santosh', 'u_subhankar', 'u_hritesh', 'u_priya'], tn_kalinga: ['u_k_ananya', 'u_k_rakesh'] }
/** permissionsOf(user) on the currently installed copy */
const perms = (db, uid) => server.permissionsOf(db.users.find((u) => u.id === uid))
const VARIANTS = [
  ['full', (p) => p],
  ['no_rates', (p) => p.filter((x) => x !== 'cost_rates.view')],
  ['no_margins', (p) => p.filter((x) => x !== 'margins.view')],
  ['neither', (p) => p.filter((x) => x !== 'cost_rates.view' && x !== 'margins.view')],
  ['plus_both', (p) => [...new Set([...p, 'cost_rates.view', 'margins.view', 'projects.create', 'projects.edit'])]],
]

/* ---------------- 1. read cases: analysis, row info, summary, plan, portfolio, rates, routes ---------------- */
const out = { generated_on: seed.generated_on, year: new Date().getFullYear(), cases: [] }
for (const today of TODAYS)
  for (const [tid, users] of Object.entries(ADMINS))
    users.forEach((uid, ui) => {
      for (const [vname, vf] of ui === 0 ? VARIANTS : [VARIANTS[0], VARIANTS[4]]) {
        const db2 = install(server, T)
        const ctx = makeCtx(server, db2, uid, vf(perms(db2, uid)), today)
        const projects = () => server.rows(ctx, 'projects')
        const c = { today, tenant: tid, user: uid, variant: vname, perms: [...ctx.perms], r: {} }
        const R = c.r
        R.rates = safe(() => co.costRateDays(ctx))
        R.an = {}
        R.row = {}
        R.sum = {}
        for (const p of projects()) {
          R.an[p.id] = safe(() => co.publicAnalysis(ctx, co.analyse(ctx, p)))
          R.row[p.id] = safe(() => co.projectRowInfo(ctx, p))
          R.sum[p.id] = safe(() => co.projectSummary(ctx, p))
        }
        R.portfolio = ['active', 'open', 'all'].map((s) => safe(() => co.portfolio(ctx, projects(), s)))
        R.routes = []
        for (const p of projects()) {
          R.routes.push(call(ctx, 'GET', '/projects/:id/costing', { params: { id: p.id } }))
          R.routes.push(call(ctx, 'GET', '/projects/:id/summary', { params: { id: p.id } }))
        }
        R.routes.push(call(ctx, 'GET', '/projects/:id/costing', { params: { id: 'p_nope' } }))
        R.routes.push(call(ctx, 'GET', '/finance/margins', { query: { scope: 'all' } }))
        R.routes.push(call(ctx, 'GET', '/finance/margins', { query: { scope: 'x' } }))
        R.routes.push(call(ctx, 'GET', '/costing/rates'))
        R.routes.push(call(ctx, 'GET', '/projects/next-code'))
        R.routes.push(call(ctx, 'GET', '/projects/calendar-summary', { query: { from: '2026-10-01', to: '2027-03-31' } }))
        R.routes.push(call(ctx, 'GET', '/projects/calendar-summary', { query: { from: '2026-10-01' } }))
        // the analytics metrics override (list / dashboard numbers) — last: project metrics sweep milestones
        R.metrics = {}
        for (const p of projects()) R.metrics[p.id] = safe(() => an.projectMetrics(ctx, p))
        out.cases.push(c)
      }
    })

/* ---------------- 2. calculator pieces (one ctx per tenant / today) ---------------- */
out.pieces = []
for (const today of TODAYS)
  for (const tid of Object.keys(ADMINS)) {
    const uid = ADMINS[tid][0]
    const db2 = install(server, T)
    const ctx2 = makeCtx(server, db2, uid, perms(db2, uid), today)
    const P = { today, tenant: tid, user: uid, perms: [...ctx2.perms], r: [] }
    const push = (name, f) => P.r.push({ name, v: safe(f) })
    const users = server.rows(ctx2, 'users').map((u) => u.id)
    const dates = ['2026-04-01', '2026-04-15', '2026-09-30', '2026-10-15', '2027-02-28', '2025-12-31', '2026-02-01']
    for (const u of users) for (const d of dates) push(`cph ${u} ${d}`, () => [co.costPerHourFor(ctx2, u, d), co.costPerDayFor(ctx2, u, d)])
    for (const a of server.rows(ctx2, 'allocations')) push(`rc ${a.id}`, () => [co.rangeCost(ctx2, a.user_id, a.pct, a.from_on, a.to_on), co.personRangeCost(ctx2, a.user_id, a.pct, a.from_on, a.to_on)])
    push('rc edge', () => [co.rangeCost(ctx2, users[0], 50, '', '2026-10-10'), co.rangeCost(ctx2, users[0], 0, '2026-10-01', '2026-10-10'), co.rangeCost(ctx2, 'u_nobody', 100, '2026-10-01', '2026-12-10'), co.rangeCost(ctx2, users[1], 33, '2026-10-05', '2026-10-01')])
    const ranges = [['2026-10-01', '2026-10-31'], ['2026-04-01', '2027-03-31'], ['2026-12-20', '2027-01-10'], ['2026-10-15', '2026-10-15'], ['2026-10-18', '2026-10-17'], ['2026-02-29', '2026-03-10'], ['2025-01-01', '2029-12-31'], ['', ''], ['2026-10-11', '2026-10-11']]
    for (const [f, t] of ranges) push(`range ${f} ${t}`, () => [co.wd(ctx2, f, t), co.slipDays(ctx2, f || '2026-10-01', t || '2026-10-01'), co.calendarSummary(ctx2, f, t)])
    for (const ctc of [0, -5, 6000000, 12345678.9, 25000000])
      for (const pct of [0, 1, 50, 100, 33.3])
        for (const [f, t] of ranges.slice(0, 4)) push(`ctc ${ctc} ${pct} ${f} ${t}`, () => co.rangeCostAtCtc(ctx2, ctc, pct, f, t))
    for (const total of [0, 1, 99999, 12345678, 100000000])
      for (const [mode, mk, pr] of [['markup', null, null], ['markup', 15, null], ['markup', 12.345, null], ['markup', -100, null], ['price', null, 15000000], ['price', 10, 0], ['price', null, -1], ['price', 5, null], ['markup', 0.005, 99.5]])
        push(`pm ${total} ${mode} ${mk} ${pr}`, () => co.priceAndMarkup(total, mode, mk, pr))
    const msLists = [
      [],
      [{ name: 'A', billing_amount_paise: 100000 }],
      [{ name: 'A', billing_amount_paise: 300000 }, { name: 'B', billing_amount_paise: 100000 }, { name: 'C', billing_amount_paise: 600000 }],
      [{ name: 'A', billing_amount_paise: 0 }, { name: 'B', billing_amount_paise: 100000 }, { name: 'C', billing_amount_paise: 1 }],
      Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, billing_amount_paise: (i + 1) * 1000 })),
    ]
    for (const l of msLists) for (const [f, t] of ranges) push(`spread ${l.length} ${f} ${t}`, () => co.spreadMilestones(ctx2, f, t, l))
    push('spread short', () => co.spreadMilestones(ctx2, '2026-10-11', '2026-10-12', msLists[2]))
    push('spread 1day', () => co.spreadMilestones(ctx2, '2026-10-14', '2026-10-14', msLists[4]))
    for (const d of dates) push(`avgwd ${d}`, () => co.avgWorkingDaysPerMonth(ctx2, d))
    for (const ym of ['2026-02', '2026-10', '2026-12', '2027-01']) push(`wdm ${ym}`, () => co.wdMonth(ctx2, ym))
    for (const p of server.rows(ctx2, 'projects')) push(`pct ${p.id}`, () => co.pctComplete(server.rows(ctx2, 'tasks').filter((t) => t.project_id === p.id), p))
    push('minHours/loading', () => [co.minHours(ctx2), co.loadingPct(ctx2), co.canPlanCost(ctx2)])
    out.pieces.push(P)
  }

/* ---------------- 3. pure validators ---------------- */
const ADD = [
  undefined, null, 'x', {}, [], [null, 5, 'a', [], {}],
  [{ category: 'travel', description: '  Flights  ', amount_paise: 1234.6 }, { category: 'nope', amount_paise: '500' }, { id: 'keep', category: 'hardware', amount_paise: -5, description: 'x' }],
  [{ amount_paise: 'abc' }, { amount_paise: 'Infinity' }, { amount_paise: 1e21 }, { description: 'é'.repeat(250), amount_paise: 1 }, { description: '😀'.repeat(150), amount_paise: 1 }],
  [{ category: 'licences', description: '', amount_paise: 100 }],
  [{ category: 'other', description: { a: 1 }, amount_paise: [7] }, { id: '', amount_paise: true }, { id: 7, amount_paise: '12.0' }],
]
out.additional = ADD.map((x) => ({ x: x === undefined ? '$undef' : x, clean: safe(() => co.cleanAdditional(x)), valid: safe(() => (co.validateAdditional(x), 'ok')) }))
const DOCS = [
  undefined, null, 'x', [], Array.from({ length: 21 }, () => ({})),
  [{ name: 'a.PDF', size_bytes: 10, data_url: 'data:x' }], [{ name: 'noext', size_bytes: 10, data_url: 'data:x' }], [{ name: 'x.exe', size_bytes: 1, data_url: 'data:' }],
  [{ name: '  ', size_bytes: 1 }], [{ name: 'a.png', size_bytes: 0, data_url: 'data:' }], [{ name: 'a.png', size_bytes: 20 * 1024 * 1024 + 1, data_url: 'data:' }],
  [{ name: 'a.png', size_bytes: '12', data_url: 'http://x' }], [{ name: 'a.b.CSV', size_bytes: 3, data_url: 'data:text/csv,1' }, { name: 'r.md', size_bytes: 5, data_url: 'data:a' }],
  [null], [{ name: 'x'.repeat(200) + '.txt', size_bytes: 1, data_url: 'data:' }], [{ name: 'a.svg', size_bytes: 'abc', data_url: 'data:' }],
]
out.docs = DOCS.map((x) => ({ x: x === undefined ? '$undef' : x, v: safe(() => co.validateCreateDocuments(x)) }))

/* ---------------- 4. calculator routes: preview + save ---------------- */
function bodiesFor(db, tid) {
  const projs = db.projects.filter((p) => p.tenant_id === tid && !p.id.startsWith('p_general'))
  const users = db.users.filter((u) => u.tenant_id === tid)
  const active = users.filter((u) => u.status === 'active')
  const out = []
  for (const p of projs) {
    const allocs = db.allocations.filter((a) => a.project_id === p.id)
    const res = allocs.map((a) => ({ key: a.id, id: a.id, user_id: a.user_id, milestone_id: a.milestone_id, pct: a.pct, from_on: a.from_on, to_on: a.to_on }))
    const ms = db.milestones.filter((m) => m.project_id === p.id && !m.deleted_at).sort((a, b) => a.no - b.no)
    out.push({ project_id: p.id, resources: res, price_mode: 'price', price_paise: p.contract_value_paise, contingency_pct: 5, maintenance_paise: 100000, additional_costs: [{ category: 'travel', description: 'Visits', amount_paise: 250000 }] })
    out.push({ project_id: p.id, resources: res.map((r, i) => (i === 0 ? { ...r, pct: 100, id: undefined, key: 'new' } : r)), price_mode: 'markup', markup_pct: 25 })
    if (ms.length) {
      out.push({ project_id: p.id, resources: [...res, { key: 'n1', user_id: active[1 % active.length].id, milestone_id: ms[0].id, pct: 100, from_on: ms[0].planned_start, to_on: ms[0].planned_end }], markup_pct: '', price_paise: '' })
      out.push({ project_id: p.id, resources: [{ user_id: active[0].id, milestone_id: ms[ms.length - 1].id, pct: '60' }], markup_pct: 10 })
    }
    out.push({ project_id: p.id, resources: res.slice(1), price_mode: 'price', price_paise: 1 })
    if (p === projs[0]) {
      out.push({ project_id: p.id, resources: res, contingency_pct: 150 })
      out.push({ project_id: p.id, resources: res, maintenance_paise: -1 })
      out.push({ project_id: p.id, resources: res, price_mode: 'price', price_paise: -5 })
      out.push({ project_id: p.id, resources: res, markup_pct: 'abc' })
      out.push({ project_id: p.id, resources: [{ user_id: res[0]?.user_id, pct: 50 }] })
      out.push({ project_id: p.id, resources: res, additional_costs: [{ amount_paise: 1.5 }] })
      out.push({ project_id: p.id, resources: res, additional_costs: [{ amount_paise: 100 }] })
      out.push({ project_id: p.id, resources: res.length ? [...res, { ...res[0], pct: 10 }] : res, price_mode: 'price', price_paise: 2 })
      out.push({ project_id: p.id, resources: [] })
    }
  }
  const u0 = active[0].id, u1 = active[1 % active.length].id
  const inactive = users.find((u) => u.status !== 'active')
  const mss = [{ name: 'Design', billing_amount_paise: 500000 }, { name: ' Build ', billing_amount_paise: 1500000 }, { name: '', billing_amount_paise: 9 }, { name: 'Go-live', billing_amount_paise: '700000' }, null, 'x', { name: 42 }]
  const base = { start_on: '2026-11-02', end_on: '2027-03-31', milestones: mss }
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 50 }, { user_id: u1, milestone_index: 1, pct: 100, from_on: '2026-12-01', to_on: '2027-01-15' }], markup_pct: 20 })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 9, pct: 50 }], markup_pct: 20 })
  out.push({ ...base, resources: [{ user_id: u0, pct: 50 }] })
  out.push({ ...base, milestones: [], resources: [{ user_id: u0, pct: 50 }] })
  out.push({ ...base, resources: [{ user_id: '', milestone_index: 0, pct: 50 }, { user_id: 'u_nobody', milestone_index: 0, pct: 0 }] })
  if (inactive) out.push({ ...base, resources: [{ user_id: inactive.id, milestone_index: 0, pct: 50 }] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 101 }, { user_id: u0, milestone_index: 1, pct: 'abc' }] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 50, from_on: '2027-01-10', to_on: '2027-01-01' }] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 50, from_on: '2026-10-01', to_on: '2026-12-01' }] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 1.5, pct: 50 }, { user_id: u0, milestone_index: -1, pct: 50 }, { user_id: u0, milestone_index: '0', pct: 50 }] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 99.6, from_on: 'bad', to_on: '2027-02-30' }] })
  out.push({ start_on: 'x', end_on: '2027-01-01', milestones: mss, resources: [{ user_id: u0, milestone_index: 0, pct: 50 }] })
  out.push({ start_on: '2027-01-01', end_on: '2026-01-01', milestones: mss, resources: [] })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 100 }, { user_id: u0, milestone_index: 0, pct: 100 }, { user_id: u1, milestone_index: 1, pct: 100 }], contingency_pct: 150, maintenance_paise: -5, markup_pct: -200 })
  out.push({ ...base, resources: [{ user_id: u0, milestone_index: 0, pct: 100 }], price_mode: 'price', price_paise: 0 })
  out.push({ ...base, resources: 'nope', additional_costs: 'x', contingency_pct: 'abc', maintenance_paise: '12.7', price_mode: 'price', price_paise: '100000' })
  out.push({ ...base, resources: ['str', 5, []] })
  out.push({ ...base, resources: [null] })
  out.push({ project_id: 'p_nope' })
  out.push({ project_id: 5, start_on: '2026-10-05', end_on: '2026-10-30', milestones: [{ name: 'Only' }], resources: [{ user_id: u0, milestone_index: 0, pct: 40, key: 7 }] })
  out.push(null)
  out.push([1, 2])
  return out
}
out.preview = []
out.save = []
for (const today of TODAYS.slice(0, 2))
  for (const [tid, users] of Object.entries(ADMINS))
    for (const uid of [users[0], users[1]]) {
      const db0 = install(server, T)
      const p0 = perms(db0, uid)
      const bodies = bodiesFor(db0, tid)
      for (const [vname, vf] of [VARIANTS[0], VARIANTS[1], VARIANTS[3], VARIANTS[4]]) {
        // previews share one ctx (memo) in this order
        const db = install(server, T)
        const ctx = makeCtx(server, db, uid, vf(p0), today)
        const list = bodies.map((b) => call(ctx, 'POST', '/projects/costing/preview', { body: b }))
        out.preview.push({ today, tenant: tid, user: uid, variant: vname, perms: [...ctx.perms], bodies, list })
        if (vname === 'neither' || today !== TODAYS[0]) continue
        // saves: each on a fresh copy (rows written are recorded)
        for (const b of bodies) {
          if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.project_id !== 'string') continue
          for (const block of [false, true]) {
            const dbs = install(server, T)
            const t = dbs.tenants.find((x) => x.id === tid)
            if (block) t.settings = { ...t.settings, 'allocation.block_over': true, 'allocation.max_pct_per_person': 100 }
            const sctx = makeCtx(server, dbs, uid, vf(p0), today)
            const TB = ['allocations', 'projects', 'activity_log', 'notifications']
            const before = Object.fromEntries(TB.map((k) => [k, new Map(dbs[k].filter((r) => r.tenant_id === tid).map((r) => [r.id, JSON.stringify(r)]))]))
            const r = call(sctx, 'PUT', '/projects/:id/costing', { params: { id: b.project_id }, body: b })
            const diff = {}
            for (const k of TB) {
              const now = dbs[k].filter((r) => r.tenant_id === tid)
              const ids = new Set(now.map((r) => r.id))
              diff[k] = { changed: norm(now.filter((r) => before[k].get(r.id) !== JSON.stringify(r))), removed: [...before[k].keys()].filter((id) => !ids.has(id)) }
            }
            out.save.push({ today, tenant: tid, user: uid, variant: vname, perms: [...sctx.perms], block, body: b, ...r, diff })
          }
        }
      }
    }
const size = writeGz('costing.json.gz', out)
console.log(`costing vectors: ${out.cases.length} read cases, ${out.pieces.length} piece sets (${out.pieces.reduce((s, p) => s + p.r.length, 0)} calls), ${out.preview.reduce((s, p) => s + p.list.length, 0)} previews, ${out.save.length} saves -> ${size} bytes`)
