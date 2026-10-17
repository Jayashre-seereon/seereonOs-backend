// Golden vectors for app/routes/reports.py + app/reports/* (ports of src/mock/routes/reports.ts and src/reports/
// engine.ts, planner.ts, narrative.ts, datasets.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/reports.mjs -> vectors/reports.json.gz
// Every dataset for several users (row scoping, grant/finance field stripping), the spec executor over many specs
// (every measure / grouping / grain / filter op / period preset / compare / sort / limit, invalid input), saved
// reports CRUD with permissions, the rule-based planner on ~200 questions per role + /ai/answer narratives, the AI
// data tools, and the exports used by dashboards / operations (nameOf, teamOf, myProjects, weekHistory, …).
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs(
  'reports',
  `export * as rp from '@/mock/routes/reports'\nexport * as ds from '@/reports/datasets'\nexport * as en from '@/reports/engine'\nexport * as pl from '@/reports/planner'\nexport * as na from '@/reports/narrative'\n`,
)
const { server, rp, ds, en, pl, na } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['saved_reports', 'activity_log', 'notifications']
const K = kit({
  server, T, modules: [rp], tables: TABLES,
  fns: {
    exports: (ctx, a) => ({
      names: server.rows(ctx, 'users').map((u) => rp.nameOf(ctx)(u.id)).concat([rp.nameOf(ctx)(null), rp.nameOf(ctx)('u_nope')]),
      team: [...rp.teamOf(ctx, ctx.user.id)],
      teamTop: [...rp.teamOf(ctx, a.top)],
      myProjects: rp.myProjects(ctx).map((p) => p.id),
      rowScope: rp.rowScope(ctx),
      grants: rp.grantsOf(ctx),
      visible: rp.visibleDatasets(ctx).map((d) => [d.id, d.fields.length]),
      hist: server.rows(ctx, 'users').map((u) => [u.id, rp.isTimesheetUser(u), rp.weekHistory(ctx, u.id, 8), rp.weekHistory(ctx, u.id, 3, '2026-09-28')]),
      eff: server.rows(ctx, 'timesheet_weeks').slice(0, 40).map((w) => rp.effectiveWeekStatus(ctx, w, w.week_start)).concat([rp.effectiveWeekStatus(ctx, undefined, '2026-10-05'), rp.effectiveWeekStatus(ctx, undefined, '2026-10-12')]),
      codes: server.rows(ctx, 'tasks').slice(0, 30).map((t) => rp.taskCode(server.rows(ctx, 'milestones').find((m) => m.id === t.milestone_id), t)),
      entities: rp.plannerEntities(ctx),
    }),
    datasetRows: (ctx, a) => rp.datasetRows(ctx, a.id).rows,
    tools: (ctx) => [rp.toolProjectHealth(ctx), rp.toolApprovals(ctx)],
    plan: (ctx, a) => pl.planQuestion(a.q, { today: ctx.today, fyStart: ctx.tenant.settings['company.fy_start_month'], role: a.role ?? ctx.role, personal: a.personal, datasets: rp.visibleDatasets(ctx), entities: rp.plannerEntities(ctx), me: ctx.user.name }),
    parsePeriod: (ctx, a) => a.qs.map((q) => pl.parsePeriod(' ' + q + ' ', ctx.today, a.fy ?? 4)),
    engine: (ctx, a) => {
      const D = ds.DATASET_MAP[a.ds]
      return {
        presets: Object.keys(ds.PRESET_LABEL).map((p) => [en.presetRange(p, a.today, a.fy, false), en.presetRange(p, a.today, a.fy, true)]),
        prev: Object.keys(ds.PRESET_LABEL).map((p) => { const r = en.presetRange(p, a.today, a.fy, a.cap); return r ? en.previousRange(p, r, a.fy) : null }).concat([en.previousRange(undefined, { from: '2026-01-10', to: '2026-02-20', label: 'x', capped: false }, a.fy)]),
        buckets: ['day', 'week', 'month', 'quarter', 'fy'].map((g) => ['2026-01-01', '2026-03-31', '2026-04-01', '2026-10-15', '2027-02-28'].map((d) => en.bucketOf(d, g, a.fy))),
        labels: (D?.fields ?? []).map((f) => ['sum', 'avg', 'count', 'min', 'max', 'count_distinct'].map((agg) => en.measureLabel({ field: f.key, agg }, D))),
        describe: a.specs.map((s) => { try { return en.describeSpec(en.sanitizeSpec(s, D).spec) } catch (e) { return { throws: String(e.message) } } }),
        sanitize: a.specs.map((s) => en.sanitizeSpec(s, D)),
        filters: a.filters.map(([row, f, field]) => en.matchFilter(row, f, field)),
        aggs: a.aggs.map(([rows, m]) => en.aggregate(rows, m)),
        cells: a.cells.map(([v, c, compact]) => na.fmtCell(v, c, compact)),
      }
    },
  },
})
const TODAY = seed.generated_on
const S = []
const PERIOD_QS = ['all time', 'today', 'this week', 'last week', 'last 3 weeks', 'past two weeks', 'last 30 days', 'last 90 days', 'last 7 days', 'last 6 months', 'last 12 months', 'last 4 months', 'past year', 'ttm', 'this month', 'mtd', 'last month', 'this quarter', 'qtd', 'last quarter', 'ytd', 'last fy', 'last year', 'this fy', 'fy25-26', "fy '24/25", 'financial year', 'q1', 'q3 fy25', 'q2 2025', 'q4 of fy 26-27', 'in august', 'sep 2026', 'november', 'from july to september', 'august and september', 'may be later', 'in 2025', 'during 2024', 'nothing here', 'dec', 'jan to mar']
const SEEREON = ['u_santosh', 'u_subhankar', 'u_hritesh', 'u_baishali', 'u_subham', 'u_priya', 'u_debasish', 'u_jagannath']
const DS = ds.DATASETS
const PRESETS = Object.keys(ds.PRESET_LABEL)

// ---------- reads: datasets, every dataset for every user, exports ----------
for (const today of [TODAY, '2027-01-10'])
  S.push(K.scenario(`datasets ${today}`, 'tn_seereon', today, (a) => {
    for (const u of SEEREON) {
      a.call(u, 'GET', '/reports/datasets')
      a.fn(u, 'exports', { top: 'u_santosh' })
      for (const d of DS) a.fn(u, 'datasetRows', { id: d.id })
      a.fn(u, 'datasetRows', { id: 'nope' })
      a.call(u, 'GET', '/reports')
      a.call(u, 'GET', '/reports', { query: { q: 'MARGIN', preview: '0' } })
      a.call(u, 'GET', '/ai/context')
      for (const t of ['project_health', 'pipeline', 'approvals']) a.call(u, 'GET', `/ai/tools/${t}`)
      for (const kind of [undefined, 'people', 'projects', 'clients', 'products', 'ledger_categories', 'x']) a.call(u, 'GET', '/ai/tools/entities', { query: kind === undefined ? {} : { kind } })
    }
    for (const r of a.db.saved_reports.filter((x) => x.tenant_id === 'tn_seereon')) for (const u of ['u_santosh', 'u_hritesh', 'u_baishali']) a.call(u, 'GET', '/reports/:id', { params: { id: r.id } })
    a.call('u_santosh', 'GET', '/reports/:id', { params: { id: 'nope' } })
  }))
S.push(K.scenario('datasets kalinga', 'tn_kalinga', TODAY, (a) => {
  for (const u of ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha', 'u_k_meera']) {
    a.call(u, 'GET', '/reports/datasets')
    a.fn(u, 'exports', { top: 'u_k_ananya' })
    for (const d of DS) a.fn(u, 'datasetRows', { id: d.id })
    a.call(u, 'GET', '/reports')
    a.call(u, 'GET', '/ai/context')
  }
}))
// permission variants on one user (finance fields, grants, ai off)
S.push(K.scenario('datasets perms', 'tn_seereon', TODAY, (a) => {
  const base = server.permissionsOf(a.db.users.find((u) => u.id === 'u_santosh'))
  const variants = [base.filter((p) => p !== 'finance.view'), base.filter((p) => p !== 'margins.view' && p !== 'cost_rates.view'), ['reports.view'], ['ai.use'], [], ['reports.view', 'people.view_all', 'tasks.view_all']]
  for (const perms of variants) {
    a.call('u_santosh', 'GET', '/reports/datasets', { perms })
    for (const d of DS) a.fn('u_santosh', 'datasetRows', { id: d.id }, perms)
    a.call('u_santosh', 'POST', '/ai/plan', { body: { question: 'revenue by stream this FY' }, perms })
    a.call('u_santosh', 'GET', '/ai/tools/pipeline', { perms })
  }
}))
S.push(K.scenario('ai disabled', 'tn_seereon', TODAY, (a) => {
  a.call('u_santosh', 'GET', '/ai/context')
  a.call('u_santosh', 'POST', '/ai/plan', { body: { question: 'revenue by stream this FY' } })
  a.call('u_santosh', 'POST', '/ai/answer', { body: { question: 'revenue by stream this FY' } })
  a.call('u_santosh', 'GET', '/ai/tools/project_health')
}, [{ kind: 'settings', id: 'tn_seereon', values: { 'ai.enabled': false } }]))

// ---------- the spec executor ----------
function specsFor(d) {
  const out = []
  const fields = d.fields
  const nums = fields.filter((f) => ['number', 'money', 'percent'].includes(f.type))
  const dims = fields.filter((f) => f.groupable)
  const dates = fields.filter((f) => f.type === 'date')
  out.push({ dataset: d.id, measures: [], dimensions: [] })
  out.push({ dataset: d.id, measures: [], dimensions: [], columns: fields.map((f) => f.key).concat(['nope']), sort: [{ field: fields[1]?.key, dir: 'asc' }], limit: 7 })
  out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [] })
  for (const n of nums) out.push({ dataset: d.id, measures: [{ field: n.key, agg: 'sum' }, { field: n.key, agg: 'avg' }, { field: n.key, agg: 'min' }, { field: n.key, agg: 'max' }, { field: n.key, agg: 'count_distinct' }], dimensions: [] })
  for (const g of dims) out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }, ...(nums[0] ? [{ field: nums[0].key, agg: 'sum' }] : [])], dimensions: [{ field: g.key }], compare: 'previous_period', period: { preset: 'this_fy' } })
  for (const dt of dates)
    for (const grain of ['day', 'week', 'month', 'quarter', 'fy', 'bad'])
      out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: dt.key, grain }], period: { preset: grain === 'day' ? 'last_30_days' : 'last_12_months', field: dt.key } })
  if (dates[0] && dims[0]) out.push({ dataset: d.id, measures: [{ field: nums[0]?.key ?? '*', agg: nums[0] ? 'sum' : 'count' }], dimensions: [{ field: dates[0].key, grain: 'month' }, { field: dims[0].key }], period: { preset: 'last_6_months' } })
  for (const preset of PRESETS) out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: dims[0] ? [{ field: dims[0].key }] : [], period: { preset }, compare: 'previous_period' })
  out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [], period: { from: '2026-04-01', to: '2026-09-30' }, compare: 'previous_period' })
  out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [], period: { from: '2026-04-01' } })
  out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [], period: { to: '2026-06-30', preset: 'nope', field: 'nope' } })
  // filters: every op on a few fields
  const sample = fields.slice(0, 12)
  for (const f of sample) {
    const vals = f.type === 'enum' ? [f.options?.[0]?.value, f.options?.[0]?.label?.toUpperCase(), [f.options?.[0]?.value, f.options?.[1]?.value]] : f.type === 'boolean' ? [true, 'true', 1, 'no', false] : f.type === 'date' ? ['2026-09-01', ['2026-04-01', '2026-10-31']] : ['number', 'money', 'percent'].includes(f.type) ? [0, '100', [0, 1000000], 'x'] : ['a', 'Seereon', 'a,b']
    for (const op of ['eq', 'neq', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty', 'odd'])
      for (const value of vals) out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [], filters: [{ field: f.key, op, value }] })
  }
  // sorts / limits / charts / junk
  if (dims[0]) {
    out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: dims[0].key }], sort: [{ field: dims[0].key, dir: 'asc' }], limit: 3, chart: 'pie', title: 'x'.repeat(200), subtitle: 'Sub', notes: 'n' })
    out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: dims[0].key }], sort: [{ field: 'count', dir: 'asc' }, { field: 'nope' }, null, 'x'], limit: 1e9 })
    out.push({ dataset: d.id, measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: dims[0].key }, { field: dims[0].key }, { field: (dims[1] ?? dims[0]).key }, { field: (dims[2] ?? dims[0]).key }, { field: 'nope' }, 'x'], limit: -1 })
  }
  out.push({ dataset: d.id, measures: [{ field: 'nope', agg: 'sum' }, null, 5, { field: fields[0].key, agg: 'weird' }, { field: '*', agg: 'sum', label: 'All' }], dimensions: [], filters: [null, { field: 'nope' }, 'x', { op: 'eq' }], chart: 'nope', compare: 'previous_period' })
  return out
}
for (const [uid, tid] of [['u_santosh', 'tn_seereon'], ['u_subhankar', 'tn_seereon'], ['u_hritesh', 'tn_seereon'], ['u_baishali', 'tn_seereon'], ['u_priya', 'tn_seereon'], ['u_k_ananya', 'tn_kalinga']]) {
  const db0 = T
  const vis = rp.visibleDatasets({ perms: new Set(server.permissionsOf(db0.users.find((u) => u.id === uid))) }).map((d) => d.id)
  for (const d of DS) {
    if (!vis.includes(d.id) && uid !== 'u_hritesh') continue
    S.push(K.scenario(`run ${uid} ${d.id}`, tid, TODAY, (a) => {
      for (const spec of specsFor(d)) a.call(uid, 'POST', '/reports/run', { body: { spec } })
    }))
  }
  S.push(K.scenario(`run ${uid} invalid`, tid, TODAY, (a) => {
    for (const body of [{}, { spec: null }, { spec: 'x' }, { spec: { dataset: 'nope' } }, { dataset: 'deals', measures: [{ field: 'value', agg: 'sum' }], dimensions: [{ field: 'stage' }] }, { spec: [] }, { spec: { dataset: '' } }])
      a.call(uid, 'POST', '/reports/run', { body })
  }))
}
// engine internals on hand-made inputs
S.push(K.scenario('engine internals', 'tn_seereon', TODAY, (a) => {
  const D = (id) => ds.DATASET_MAP[id]
  const f = (id, k) => D(id).fields.find((x) => x.key === k)
  const rows = [{ a: 1, b: 'x', c: true, d: '2026-01-02' }, { a: '2', b: 'X ', c: false, d: '' }, { a: null, b: null, c: null, d: null }, { a: 'abc', b: 'y', c: 'yes', d: '2026-13-01' }, { a: 3.5, b: '', c: 1, d: '2026-02-30T10:00:00Z' }, {}]
  const filters = []
  for (const row of rows)
    for (const op of ['eq', 'neq', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty', 'zz'])
      for (const [field, value, fd] of [['a', 2, f('deals', 'value')], ['a', '2', f('deals', 'value')], ['a', [1, 3], f('deals', 'value')], ['a', '1,3', undefined], ['b', 'x', f('deals', 'stage')], ['b', ['x', ' y '], undefined], ['b', 'X', undefined], ['c', true, f('deals', 'is_open')], ['c', 'true', f('deals', 'is_open')], ['c', 1, f('deals', 'is_open')], ['d', '2026-01-01', f('deals', 'won_on')], ['d', ['2026-01-01', '2026-12-31'], f('deals', 'won_on')], ['d', '2026-01-01,2026-03-01', undefined], ['a', null, undefined], ['b', undefined, undefined]])
        filters.push([row, { field, op, value }, fd])
  const aggs = []
  for (const agg of ['sum', 'avg', 'count', 'min', 'max', 'count_distinct', 'zz']) for (const field of ['a', 'b', 'c', 'd', 'z']) aggs.push([rows, { field, agg }])
  aggs.push([[], { field: 'a', agg: 'sum' }], [[], { field: 'a', agg: 'avg' }], [[{ a: 0.1 }, { a: 0.2 }], { field: 'a', agg: 'sum' }])
  const cells = []
  for (const v of [null, '', true, false, 0, 1, -1, 0.5, 9.99, 10.5, 12345678, -1234567.89, 'abc', '2026-10-15', '2026-02-30', '2026-13-01x', 1e21])
    for (const c of [{ type: 'money' }, { type: 'percent' }, { type: 'date' }, { type: 'number' }, { type: 'number', unit: 'hours' }, { type: 'number', unit: 'days' }, { type: 'string' }])
      for (const compact of [false, true]) cells.push([v, c, compact])
  for (const dsid of ['deals', 'tasks', 'ledger', 'hours', 'projects', 'payroll'])
    for (const [today, fy, cap] of [[TODAY, 4, false], ['2027-03-31', 4, true], ['2026-01-15', 1, false], ['2026-12-31', 10, true]])
      a.fn('u_santosh', 'engine', { ds: dsid, today, fy, cap, specs: specsFor(D(dsid)).slice(0, 60), filters: dsid === 'deals' && today === TODAY ? filters : [], aggs: dsid === 'deals' && today === TODAY ? aggs : [], cells: dsid === 'deals' && today === TODAY ? cells : [] })
  a.fn('u_santosh', 'parsePeriod', { qs: PERIOD_QS })
  a.fn('u_santosh', 'parsePeriod', { qs: PERIOD_QS, fy: 1 })
}))

// ---------- saved reports CRUD ----------
S.push(K.scenario('saved reports', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const spec = { dataset: 'tasks', measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: 'owner' }], chart: 'bar' }
  for (const body of [{}, { name: 'x' }, { name: 'x'.repeat(121), spec }, { name: 'Ok name' }, { name: 'Ok name', spec: 'x' }, { name: 'Ok name', spec: { dataset: 'nope' } }, { name: 'Ok name', spec: { dataset: 'payroll' } }])
    C('u_hritesh', 'POST', '/reports', { body })
  C('u_jagannath', 'POST', '/reports', { body: { name: 'Mine', spec }, perms: ['reports.view'] })
  const r1 = C('u_hritesh', 'POST', '/reports', { body: { name: '  My tasks by owner ', description: '  d  ', spec, shared: 1, pinned: 'yes', source: 'ai', schedule: 'weekly' } })
  const r2 = C('u_santosh', 'POST', '/reports', { body: { name: 'Revenue', spec: { dataset: 'ledger', title: '', measures: [{ field: 'billed', agg: 'sum' }], dimensions: [{ field: 'date', grain: 'month' }], period: { preset: 'last_12_months' } }, schedule: 'daily' } })
  const id1 = r1.v?.id
  const id2 = r2.v?.id
  if (id1) {
    C('u_subhankar', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { name: 'Hijack' } })
    C('u_hritesh', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { name: 'a' } })
    C('u_hritesh', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { description: 'x'.repeat(500), schedule: 'monthly' }, ifMatch: 9 })
    C('u_hritesh', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { description: 'x'.repeat(500), schedule: 'yearly', shared: 0, pinned: true } })
    C('u_hritesh', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { spec: { dataset: 'payroll' } } })
    C('u_hritesh', 'PATCH', '/reports/:id', { params: { id: id1 }, body: { spec: { ...spec, dimensions: [{ field: 'status' }] }, name: 'By status' } })
    C('u_hritesh', 'POST', '/reports/:id/pin', { params: { id: id1 } })
    C('u_hritesh', 'POST', '/reports/:id/pin', { params: { id: id1 }, body: { pinned: 0 } })
    C('u_hritesh', 'POST', '/reports/:id/share', { params: { id: id1 } })
    C('u_subhankar', 'POST', '/reports/:id/share', { params: { id: id1 } })
    C('u_hritesh', 'POST', '/reports/:id/run', { params: { id: id1 } })
    C('u_hritesh', 'POST', '/reports/:id/run', { params: { id: id1 }, body: { period: { preset: 'this_month' }, compare: 'previous_period' } })
    C('u_subhankar', 'POST', '/reports/:id/run', { params: { id: id1 } })
    C('u_subhankar', 'POST', '/reports/:id/duplicate', { params: { id: id1 } })
    C('u_santosh', 'GET', '/reports/:id', { params: { id: id1 } })
    C('u_hritesh', 'GET', '/reports')
    C('u_subhankar', 'DELETE', '/reports/:id', { params: { id: id1 } })
    C('u_hritesh', 'DELETE', '/reports/:id', { params: { id: id1 }, ifMatch: 1 })
    C('u_hritesh', 'DELETE', '/reports/:id', { params: { id: id1 } })
  }
  if (id2) {
    C('u_hritesh', 'GET', '/reports/:id', { params: { id: id2 } })
    C('u_hritesh', 'POST', '/reports/:id/duplicate', { params: { id: id2 } })
    C('u_santosh', 'POST', '/reports/:id/duplicate', { params: { id: id2 } })
    C('u_santosh', 'POST', '/reports/:id/run', { params: { id: id2 } })
  }
  const sys = a.db.saved_reports.filter((x) => x.tenant_id === 'tn_seereon').slice(0, 4)
  for (const r of sys) {
    C('u_subhankar', 'DELETE', '/reports/:id', { params: { id: r.id } })
    C('u_subhankar', 'POST', '/reports/:id/run', { params: { id: r.id } })
    C('u_santosh', 'POST', '/reports/:id/pin', { params: { id: r.id }, body: { pinned: false } })
  }
  if (sys[0]) C('u_santosh', 'DELETE', '/reports/:id', { params: { id: sys[0].id } })
  C('u_santosh', 'GET', '/reports')
  C('u_baishali', 'GET', '/reports')
}))

// ---------- the planner + answers ----------
const QUESTIONS = [
  ...new Set(Object.values(pl.SUGGESTIONS).flat()),
  'Which tasks were completed late this quarter by person?', 'On-time delivery by project this fy', 'early or late split of tasks', 'timeliness by month', 'Why are tasks delayed by project?', 'what is delaying delivery',
  'tasks sent back by reviewer', 'list tasks sent back', 'first pass rate by owner', 'quality rating by person last 6 months', 'tasks in review', 'pending leave requests', 'rejected leave', 'my leave requests',
  'who is on leave next week', 'leave taken by type this fy', 'leave taken by person', 'budget vs actual by category', 'which categories are over budget', 'revenue vs budget by stream', 'expense claims over budget',
  'vendor bills due', 'overdue bills by vendor', 'bills paid last month', 'pending purchase orders', 'list open purchase orders', 'purchase orders by category', 'unpaid reimbursements', 'pending expense claims',
  'my expenses by category this fy', 'billable expenses', 'lost revenue by client', 'write offs this fy', 'list leakage items recoverable', 'appraisals pending', 'average increment by cycle', 'appraisal ratings by manager',
  'candidates by stage', 'time to hire by opening', 'list active candidates', 'documents not acknowledged', 'my unread documents', 'documents by category', 'must read documents', 'okr progress', 'key results at risk',
  'list key results', "who hasn't submitted last week's timesheet", 'timesheets pending approval', 'which projects are below 30% margin', 'loss making projects', 'projects above 20% markup', 'project margins',
  'margin by client', 'win rate by source this quarter', 'win rate', 'projects at risk', 'project health', 'stale deals', 'overdue milestones', 'milestones due in the next 15 days', 'overdue tasks', 'overdue tasks by project',
  'who has the most overdue tasks', 'blocked tasks', 'tasks completed by owner last month', 'throughput by week', 'effort ratio by project', 'estimate accuracy', 'who is over allocated', 'who is on the bench',
  'allocation', 'outstanding invoices', 'receivables by client', 'payroll cost by department this fy', 'net pay by month', 'deductions by person', 'headcount by role', 'compliance items overdue', 'gst filings',
  'revenue by stream this fy', 'revenue by client', 'cash collected vs billed by month last 6 months', 'profit this year', 'costs by category', 'expenses this month', 'revenue for Mother group', 'net earnings by month',
  'open pipeline by stage', 'deals won this fy by month', 'deals lost why', 'average deal size', 'weighted pipeline by owner', 'deals closing this month', 'list deals in negotiation', 'referral deals',
  'my activities last 30 days by type', 'calls this week', 'meetings by owner', 'hours by person last month', 'leave hours by person', 'billable hours by project', 'internal hours', 'unapproved hours',
  'hours on HRMS', 'my hours by week last 8 weeks', 'labour cost by project', 'top 5 clients by billing this fy', 'bottom 3 projects by progress', 'top projects', 'highest effort ratio', 'show all tasks',
  'how many tasks', 'list projects', 'sap revenue', 'saas subscriptions revenue', 'products revenue by month', 'services billing', 'general tasks overdue', 'urgent tasks', 'high priority tasks open',
  'tasks in progress', 'active projects', 'Hritesh tasks', 'tasks owned by Bijaya', 'PRJ-007 hours', 'HRMS status', 'Mother Group hours', 'as a table revenue by stream', 'revenue line chart', 'deals bar chart', 'pie chart of hours by kind',
  'revenue growth vs last year', 'hours compared to last month', 'asdf qwerty', 'the', 'what about everything?', 'show me the money', 'po', 'bills', 'appraisal', 'hiring', 'budget', 'leakage',
]
for (const [uid, tid] of [['u_santosh', 'tn_seereon'], ['u_subhankar', 'tn_seereon'], ['u_hritesh', 'tn_seereon'], ['u_baishali', 'tn_seereon'], ['u_priya', 'tn_seereon'], ['u_debasish', 'tn_seereon'], ['u_k_meera', 'tn_kalinga']]) {
  S.push(K.scenario(`planner ${uid}`, tid, TODAY, (a) => {
    for (const q of QUESTIONS) a.fn(uid, 'plan', { q, personal: undefined })
    for (const q of QUESTIONS.slice(0, 60)) a.fn(uid, 'plan', { q, personal: true, role: 'employee' })
    for (const body of [{}, { question: 'ab' }, { question: 'x'.repeat(601) }, { question: '  revenue   by STREAM’s this fy ' }])
      a.call(uid, 'POST', '/ai/plan', { body })
    a.call(uid, 'POST', '/ai/answer', { body: { spec: { dataset: 'tasks', measures: [{ field: '*', agg: 'count' }], dimensions: [{ field: 'status' }] }, explanation: 'llm', source: 'llm' } })
    a.call(uid, 'POST', '/ai/answer', { body: { spec: { dataset: 'nope' } } })
  }))
  for (let i = 0; i < QUESTIONS.length; i += 25)
    S.push(K.scenario(`answers ${uid} ${i}`, tid, TODAY, (a) => {
      for (const q of QUESTIONS.slice(i, i + 25)) a.call(uid, 'POST', '/ai/answer', { body: { question: q } })
    }))
}

// default set (every read / CRUD / engine / planner scenario, the executor for one user, the first /ai/answer chunk per
// user) and the rest (GOLDEN_FULL=1): the full set replays ~64k calls
const sel = (n) => (n.startsWith('run ') ? n.startsWith('run u_hritesh') || n.endsWith(' invalid') : n.startsWith('answers ') ? n.endsWith(' 0') : true)
const A = S.filter((x) => sel(x.name))
const B = S.filter((x) => !sel(x.name))
const size = writeGz('reports.json.gz', { generated_on: seed.generated_on, scenarios: A }) + writeGz('reports_full.json.gz', { generated_on: seed.generated_on, scenarios: B })
console.log(`reports vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps; default ${A.length}) -> ${size} bytes`)
