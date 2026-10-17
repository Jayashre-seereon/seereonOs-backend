// IDOR / tenant-isolation sweep over HTTP, driven by the OpenAPI document (every route with an id-like path param).
//   API_URL=http://localhost:8000 DATABASE_URL=postgres://seereon_owner:…/seereonos node backend/tests/e2e/idor.mjs
// The API must run with DEMO_MODE=true (the script resets the demo data first and at the end).
//  A. cross-tenant: the second tenant's CEO (ananya@kalingasoft.in, every permission in her own tenant) calls every
//     id route with every method, using ids of the first tenant → must never be 2xx, and the first tenant's data must
//     be byte-identical afterwards (md5 of every tenant table).
//  B. within the tenant: an employee (hritesh@) GETs and DELETEs other people's records → 2xx answers are listed for
//     review against the documented visibility rules (EXPECTED_VISIBLE below); anything else is a failure.
//  C. mass assignment: the CEO sends id / tenant_id / version / created_* / is_super_admin / extra_permissions in every
//     PATCH and PUT → no 5xx, no row takes those values, nothing moves to the other tenant.
import { pgLite } from './sql.mjs'

const API = (process.env.API_URL ?? 'http://localhost:8000') + '/api/v1'
const DBURL = process.env.DATABASE_URL ?? 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos'
const T1 = 'tn_seereon'
const PW = 'Seereon@123'

// first path segment → tables whose ids that route takes
const MAP = {
  users: ['users'], invites: ['invites'], delegations: ['delegations'], holidays: ['holidays'], 'cost-rates': ['cost_rates'], exports: ['data_exports'],
  projects: ['projects'], milestones: ['milestones'], tasks: ['tasks'], 'change-requests': ['change_requests'], allocations: ['allocations'], invoices: ['invoices'],
  finance: ['invoices', 'payments', 'ledger_entries', 'payroll_runs'], expenses: ['expense_claims'], 'purchase-orders': ['purchase_orders'], 'vendor-bills': ['vendor_bills'],
  vendors: ['vendors'], budgets: ['budgets'], documents: ['documents'], 'doc-templates': ['doc_templates'], 'issued-docs': ['issued_documents'], 'employee-docs': ['employee_documents'],
  appraisals: ['appraisals'], 'appraisal-cycles': ['appraisal_cycles'], goals: ['goals'], candidates: ['candidates'], interviews: ['interviews'], openings: ['openings'],
  lifecycle: ['lifecycle_checklists'], assets: ['assets'], okrs: ['objectives', 'key_results'], 'leave-requests': ['leave_requests'], 'leave-policies': ['leave_policies'], leave: ['leave'],
  timesheets: ['timesheet_weeks'], payroll: ['payroll_runs', 'payroll_lines'], sales: ['deals'], clients: ['clients'], contracts: ['contracts'], estimates: ['cost_estimates'],
  wf: ['wf_templates', 'wf_instances'], workflows: ['approval_workflows'], changes: ['change_sets'], approvals: ['change_sets', 'timesheet_weeks', 'expense_claims', 'leave_requests'],
  emails: ['email_templates', 'email_outbox'], roles: ['roles'], reports: ['saved_reports'], ops: ['ops_items'], notifications: ['notifications'], leakage: ['revenue_leakage'],
  master: ['locations', 'departments', 'designations', 'grades', 'cost_centres', 'shifts'], billing: ['billing_invoices'], performance: ['users'], insights: ['projects'],
}
const USER_PARAMS = new Set(['userId', 'employeeId'])
const ID_PARAMS = new Set(['id', 'aid', 'appraisalId', 'weekId', 'itemId', ...USER_PARAMS])
// public by design (the token is the credential) or own-only by construction
const SKIP = [/\{token\}/, /^\/sessions\/\{id\}$/]
// an employee may legitimately read these records of other people (directory / shared company content / own
// project work): GET 200 here is expected; everything else must be 403/404
const EXPECTED_VISIBLE = [
  /^GET \/users\/\{id\}$/, // directory profile (no salary / access data for employees)
  /^GET \/holidays/, /^GET \/documents\/\{id\}/, /^GET \/master\//, /^GET \/leave-policies/, /^GET \/okrs\//, /^GET \/performance\//,
  /^GET \/tasks\/\{id\}/, /^GET \/projects\/\{id\}/, /^GET \/milestones\/\{id\}/, /^GET \/insights\//,
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function call(token, method, path, body) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = 'Bearer ' + token
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, code: j.error?.code, data: j.data }
}
const login = async (email) => {
  const r = await call(null, 'POST', '/auth/login', { email, password: PW })
  if (!r.data?.token) throw new Error('login failed ' + email + ' ' + r.status + ' ' + r.code)
  return r.data.token
}

async function main() {
  const db = pgLite(DBURL)
  const reset = await fetch(API + '/demo/reset', { method: 'POST' })
  if (!reset.ok) throw new Error('demo reset failed (DEMO_MODE=true?) ' + reset.status)
  const doc = await (await fetch(API + '/openapi.json')).json()
  const routes = []
  for (const [p, ops] of Object.entries(doc.paths)) {
    const path = p.replace(/^\/api\/v1/, '')
    if (!/\{\w+\}/.test(path) || SKIP.some((re) => re.test(path))) continue
    for (const m of Object.keys(ops)) routes.push({ method: m.toUpperCase(), path })
  }
  const meta = (await db.query('SELECT table_name FROM app_table_meta WHERE tenant_scoped ORDER BY 1')).rows.map((r) => r.table_name)
  // the employee's own records (or ones shared with everyone) are not "other people's"
  const owned = (r) =>
    ['user_id', 'owner_id', 'employee_id', 'assignee_id', 'assigned_to', 'subject_user_id', 'initiated_by', 'current_assignee_id', 'requested_by', 'created_by', 'from_user_id', 'to_user_id', 'backup_id'].some((k) => r[k] === 'u_hritesh') ||
    r.id === 'u_hritesh' || r.shared === true || JSON.stringify(r.history ?? '').includes('u_hritesh')
  const ids = {}
  for (const t of meta) {
    if (t === 'tenants') continue
    const rows = (await db.query(`SELECT * FROM "${t}" WHERE tenant_id = $1 ORDER BY _ord LIMIT 300`, [T1])).rows
    ids[t] = { any: rows.slice(0, 3).map((r) => r.id).filter(Boolean), others: rows.filter((r) => !owned(r)).slice(0, 3).map((r) => r.id).filter(Boolean) }
  }
  const pool = Object.values(ids).flatMap((x) => x.any.slice(0, 1))
  const candidates = (path, param, kind) => {
    if (USER_PARAMS.has(param)) return kind === 'others' ? ['u_santosh', 'u_priya'] : ['u_santosh', 'u_hritesh']
    const seg = path.split('/')[1]
    const tables = MAP[seg]
    const list = tables ? tables.flatMap((t) => ids[t]?.[kind] ?? []) : pool
    return [...new Set(list)].slice(0, 4)
  }
  const fill = (path, kind) => {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (params.some((p) => !ID_PARAMS.has(p))) return null // {type}/{view}/{week}/{key}/{process}: not an object id
    const first = params[0]
    return candidates(path, first, kind).map((id) => {
      let out = path.replace(`{${first}}`, encodeURIComponent(id))
      for (const p of params.slice(1)) out = out.replace(`{${p}}`, encodeURIComponent(candidates(path, p, kind)[0] ?? 'x'))
      return out
    })
  }
  const snapshot = async () => {
    const out = {}
    for (const t of meta) out[t] = (await db.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x._ord), '')) h FROM "${t}" x WHERE ${t === 'tenants' ? 'id' : 'tenant_id'} = $1`, [T1])).rows[0]
    return out
  }

  /* A. cross-tenant */
  const ananya = await login('ananya@kalingasoft.in')
  const before = await snapshot()
  const A = { calls: 0, byStatus: {}, fails: [], skipped: [] }
  for (const r of routes) {
    const urls = fill(r.path, 'any')
    if (!urls) {
      A.skipped.push(`${r.method} ${r.path}`)
      continue
    }
    for (const u of urls) {
      const res = await call(ananya, r.method, u, r.method === 'GET' || r.method === 'DELETE' ? undefined : {})
      A.calls++
      A.byStatus[res.status] = (A.byStatus[res.status] ?? 0) + 1
      if (res.status < 400 || res.status >= 500) A.fails.push(`${r.method} ${u} → ${res.status} ${res.code ?? ''}`)
    }
  }
  const after = await snapshot()
  const changed = meta.filter((t) => before[t].h !== after[t].h || before[t].n !== after[t].n)

  /* B. employee within the tenant */
  await fetch(API + '/demo/reset', { method: 'POST' })
  await sleep(200)
  const emp = await login('hritesh@seereon.co.in')
  const B = { calls: 0, byStatus: {}, visible: [], fails: [] }
  for (const r of routes.filter((x) => x.method === 'GET' || x.method === 'DELETE')) {
    const urls = fill(r.path, 'others')
    if (!urls) continue
    for (const u of urls) {
      const res = await call(emp, r.method, u)
      B.calls++
      B.byStatus[res.status] = (B.byStatus[res.status] ?? 0) + 1
      if (res.status >= 500) B.fails.push(`${r.method} ${u} → ${res.status}`)
      else if (res.status < 300) {
        const key = `${r.method} ${r.path}`
        if (r.method !== 'GET' || !EXPECTED_VISIBLE.some((re) => re.test(key))) B.fails.push(`${r.method} ${u} → ${res.status} (employee reached another person's record)`)
        else B.visible.push(`${r.method} ${u}`)
      }
    }
  }

  /* C. mass assignment: the first tenant's CEO sends protected fields in every PATCH / PUT (and the id-less writes
        of her own profile / theme / prefs); afterwards no row may carry them and nothing may have moved tenant */
  await fetch(API + '/demo/reset', { method: 'POST' })
  await sleep(200)
  const ceo = await login('santosh@seereon.co.in')
  const EVIL = { id: 'x_evil', tenant_id: 'tn_kalinga', version: 999999, created_by: 'u_evil', created_at: '2000-01-01T00:00:00.000Z', updated_at: '2000-01-01T00:00:00.000Z', is_super_admin: true, extra_permissions: ['platform.admin'] }
  const counts = async () => Object.fromEntries(await Promise.all(meta.map(async (t) => [t, (await db.query(`SELECT count(*)::int n FROM "${t}" WHERE ${t === 'tenants' ? 'id' : 'tenant_id'} = 'tn_kalinga'`)).rows[0].n])))
  const c0 = await counts()
  const C = { calls: 0, byStatus: {}, fails: [] }
  const writes = routes.filter((r) => r.method === 'PATCH' || r.method === 'PUT').flatMap((r) => (fill(r.path, 'any') ?? []).slice(0, 2).map((u) => ({ method: r.method, url: u })))
  writes.push({ method: 'PATCH', url: '/me/profile' }, { method: 'PUT', url: '/tenant/theme' }, { method: 'PATCH', url: '/me/prefs' }, { method: 'PATCH', url: '/me/avatar' })
  for (const w of writes) {
    const res = await call(ceo, w.method, w.url, { ...EVIL })
    C.calls++
    C.byStatus[res.status] = (C.byStatus[res.status] ?? 0) + 1
    if (res.status >= 500) C.fails.push(`${w.method} ${w.url} → ${res.status} ${res.code ?? ''}`)
  }
  const c1 = await counts()
  for (const t of meta) if (c0[t] !== c1[t]) C.fails.push(`rows moved into the other tenant: ${t} ${c0[t]} → ${c1[t]}`)
  for (const t of meta) {
    const cols = (await db.query('SELECT column_name FROM app_column_meta WHERE table_name = $1', [t])).rows.map((r) => r.column_name)
    const conds = cols.includes('id') ? [`id = 'x_evil'`] : []
    if (cols.includes('created_by')) conds.push(`created_by = 'u_evil'`)
    if (cols.includes('version')) conds.push('version >= 999999')
    if (cols.includes('created_at')) conds.push(`created_at < '2001-01-01'`)
    if (!conds.length) continue
    const bad = (await db.query(`SELECT count(*)::int n FROM "${t}" WHERE ${conds.join(' OR ')}`)).rows[0].n
    if (bad) C.fails.push(`${t}: ${bad} row(s) took a protected value from a request body`)
  }
  const supers = (await db.query("SELECT count(*)::int n FROM users WHERE is_super_admin AND id <> 'u_platform'")).rows[0].n
  if (supers) C.fails.push(`${supers} user(s) became super admin`)
  if (JSON.stringify((await db.query("SELECT extra_permissions FROM users WHERE tenant_id = $1", [T1])).rows).includes('platform.admin')) C.fails.push('a user gained a permission from a request body')

  await fetch(API + '/demo/reset', { method: 'POST' })
  await db.end()

  console.log(`A. cross-tenant: ${routes.length} id routes, ${A.calls} calls, statuses ${JSON.stringify(A.byStatus)}, skipped (non-id params) ${A.skipped.length}`)
  console.log(`   tenant-1 tables changed by tenant-2 calls: ${changed.length ? changed.join(', ') : 'none'}`)
  for (const f of A.fails) console.log('   FAIL ' + f)
  console.log(`B. employee: ${B.calls} calls, statuses ${JSON.stringify(B.byStatus)}, expected-visible 200s ${B.visible.length}`)
  for (const f of B.fails) console.log('   FAIL ' + f)
  console.log(`C. mass assignment: ${C.calls} PATCH/PUT calls with protected fields, statuses ${JSON.stringify(C.byStatus)}`)
  for (const f of C.fails) console.log('   FAIL ' + f)
  const fails = A.fails.length + B.fails.length + changed.length + C.fails.length
  console.log(fails ? `IDOR SWEEP: ${fails} FAIL` : 'IDOR SWEEP: ALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})
