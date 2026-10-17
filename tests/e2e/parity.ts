// End-to-end parity: the same calls against the real HTTP API (PostgreSQL) and the in-process mock (fresh seed);
// the response data must match except for volatile values (generated ids, timestamps, tokens, random hues/passwords).
// Usage: backend/tools/parity.sh, or API_URL=http://localhost:8000 DATABASE_URL=... node parity.cjs (server with DEMO_MODE=true)
// Python port copy (backend/tests/e2e/parity.ts): PARITY_MODULES=notifications,billing,... limits every call (fixed list
// and SWEEP) to routes whose TS route module (OpenAPI tag) is listed; calls that match no route are always made.
// Run through backend/tools/parity.sh.
;(globalThis as { window?: unknown }).window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }
import { dispatch, ensureRoutes, getDb, matchRoute, registerSeed, routeRegistry } from '@/mock/server'
import { pgLite } from './sql.mjs'
import { totp } from '@/domain/totp'
import { rbScenarios } from './parity_rb'
import { reScenarios } from './parity_re'

const MODULES = process.env.PARITY_MODULES ? new Set(process.env.PARITY_MODULES.split(',').map((s) => s.trim()).filter(Boolean)) : null
/** is this call part of the run (PARITY_MODULES filter by the TS route module of the matched route) */
function inScope(method: string, path: string): boolean {
  if (!MODULES) return true
  const m = matchRoute(method, path)
  return !m || MODULES.has(m.route.module)
}
let skipped = 0

const API = process.env.API_URL ?? 'http://localhost:8090'
/** PARITY_GET_TWICE=1: every GET is made twice on both sides; the API's two answers must agree (response memo) */
const GET_TWICE = !!process.env.PARITY_GET_TWICE
let memoDiffs = 0
/** set while both sides repeat a GET that changes data (the mock's answers differ too: not a memo question) */
let twiceSideEffects = false
// + simulated payment-provider ids (random in the mock and in the API alike)
const VOLATILE_KEYS = new Set(['token', 'temp_password', 'avatar_hue', 'demo_token', 'otpauth_url', 'secret', 'request_id', 'payment_id', 'razorpay_subscription_id', 'recovery_codes'])
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
// generated ids (uid(): prefix + time base36 + random), also behind several prefixes (auto_cr_<id>)
const GEN_ID = /\b(?:[a-z]{1,8}_){0,3}(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{13,}\b/g
const IS_GEN_ID = /^(?:[a-z]{1,8}_){0,3}(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{13,}$/
// records created during the run get a RANDOM colour (users.avatar_hue, projects.color_hue: Math.random() in the TS, a
// CSPRNG in Python) — every *hue of an object that is (or is about) a generated record is volatile; seeded records keep
// their deterministic hue in the comparison
const OWNER_KEYS = ['id', 'user_id', 'person_id', 'employee_id', 'owner_id', 'project_id']

type Res = { status: number; data?: unknown; warnings?: unknown; error?: { code: string; message: string; field?: string } }

const mockTok: Record<string, string> = {}
const httpTok: Record<string, string> = {}

async function mockCall(who: string, method: string, path: string, body?: unknown, query?: Record<string, unknown>, ifMatch?: number): Promise<Res> {
  if (GET_TWICE && method === 'GET') {
    // the API answers every GET twice (memo check, see httpCall; the mock is always called first): the mock does
    // too, so GETs with side effects (view counters, lazy notifications) stay comparable
    const m1 = await mockCall1(who, method, path, body, query, ifMatch)
    const m2 = await mockCall1(who, method, path, body, query, ifMatch)
    twiceSideEffects = JSON.stringify(norm(m1)) !== JSON.stringify(norm(m2))
    return m2
  }
  return mockCall1(who, method, path, body, query, ifMatch)
}

async function mockCall1(who: string, method: string, path: string, body?: unknown, query?: Record<string, unknown>, ifMatch?: number): Promise<Res> {
  const h: Record<string, string> = {}
  if (mockTok[who]) h['Authorization'] = 'Bearer ' + mockTok[who]
  if (ifMatch !== undefined) h['If-Match'] = String(ifMatch)
  try {
    const r = await dispatch(method, path, { body, query: query ? Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) : {} }, h)
    return { status: 200, data: r.data, warnings: r.warnings }
  } catch (e) {
    const x = e as { status: number; code: string; message: string; field?: string }
    if (!x.status) {
      // an exception in the TypeScript handler = what the API answers for an unexpected error (500 INTERNAL)
      console.log(`   MOCK 500 ${method} ${path} (${who}): ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`)
      return { status: 500, error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again; if it keeps happening, contact support with this request id.' } }
    }
    return { status: x.status, error: { code: x.code, message: x.message, ...(x.field ? { field: x.field } : {}) } }
  }
}

async function httpCall(who: string, method: string, path: string, body?: unknown, query?: Record<string, unknown>, ifMatch?: number): Promise<Res> {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : ''
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (httpTok[who]) h['Authorization'] = 'Bearer ' + httpTok[who]
  if (ifMatch !== undefined) h['If-Match'] = String(ifMatch)
  let res = await fetch(API + '/api/v1' + path + qs, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  if (GET_TWICE && method === 'GET') {
    // the response memo: the same GET again (served from the memo when it stored the first) must answer byte for byte
    // the same (request ids aside); the comparison with the mock then uses the second answer
    const canon = (txt: string) => {
      const o = JSON.parse(txt) as { error?: { request_id?: string } }
      if (o.error) delete o.error.request_id
      return JSON.stringify(norm(o))
    }
    const t1 = canon(await res.text())
    res = await fetch(API + '/api/v1' + path + qs, { method, headers: h })
    const t2 = canon(await res.clone().text())
    if (t2 !== t1 && !twiceSideEffects) {
      memoDiffs++
      console.log(`MEMO-DIFF ${method} ${path}${qs} (${who})`)
    }
  }
  const j = (await res.json()) as { data?: unknown; warnings?: unknown; error?: Res['error'] }
  if (res.ok) return { status: res.status, data: j.data, warnings: j.warnings }
  const { request_id: _r, ...error } = j.error as Res['error'] & { request_id?: string }
  return { status: res.status, error }
}

function norm(v: unknown): unknown {
  // RC: random temporary passwords inside rendered e-mails, invite links carry the (random) invite token
  if (typeof v === 'string') return v.replace(ISO, '<ts>').replace(/(Temporary password: )\S+/g, '$1<v>').replace(/\/invite\/inv_[A-Za-z0-9_-]+/g, '/invite/<token>').replace(GEN_ID, '<id>')
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const generated = OWNER_KEYS.some((k) => typeof src[k] === 'string' && IS_GEN_ID.test(src[k] as string))
    // map keys that are generated ids (e.g. productive_hours by user id) normalise like values; colliding keys are
    // numbered in the order of their normalised values, so the result does not depend on generation order
    const entries = Object.keys(src).map((k) => {
      const nk = k.replace(GEN_ID, '<id>')
      const val = VOLATILE_KEYS.has(k) || (generated && /hue$/.test(k)) ? '<v>' : norm(src[k])
      return [nk, val, nk !== k] as const
    })
    const o: Record<string, unknown> = {}
    const genKeyed = entries.filter((e) => e[2]).sort((a, b) => JSON.stringify(a[1]).localeCompare(JSON.stringify(b[1])))
    const seen: Record<string, number> = {}
    for (const [nk, val] of genKeyed) {
      const n = (seen[nk] = (seen[nk] ?? 0) + 1)
      o[n === 1 ? nk : `${nk}#${n}`] = val
    }
    for (const [nk, val, g] of entries) if (!g) o[nk] = val
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
  }
  return v
}

function diff(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (out.length > 12) return out
  if (JSON.stringify(a) === JSON.stringify(b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) out.push(`${path}: array length mock=${a.length} api=${(b as unknown[]).length}`)
    const keys = new Set([...Object.keys(a), ...Object.keys(b as object)])
    for (const k of keys) {
      const av = (a as Record<string, unknown>)[k]
      const bv = (b as Record<string, unknown>)[k]
      if (!(k in (a as object))) out.push(`${path}.${k}: only in api = ${JSON.stringify(bv)?.slice(0, 80)}`)
      else if (!(k in (b as object))) out.push(`${path}.${k}: only in mock = ${JSON.stringify(av)?.slice(0, 80)}`)
      else diff(av, bv, `${path}.${k}`, out)
    }
    return out
  }
  out.push(`${path}: mock=${JSON.stringify(a)?.slice(0, 120)} api=${JSON.stringify(b)?.slice(0, 120)}`)
  return out
}

/** a group block reads list responses: a call filtered out by PARITY_MODULES answers `{}`, so never assume an array */
const asArr = (x: unknown): RdAny[] => (Array.isArray(x) ? (x as RdAny[]) : [])
/** PARITY_DUMP=<path regex>: the full responses of a failing call go to PARITY_DUMP_DIR (default /tmp) for inspection */
let dumps = 0
function dumpFailure(label: string, method: string, path: string, m: Res, h: Res) {
  const re = process.env.PARITY_DUMP
  if (!re || !new RegExp(re).test(path)) return
  const f = `${process.env.PARITY_DUMP_DIR ?? '/tmp'}/parity-fail-${++dumps}.json`
  require('node:fs').writeFileSync(f, JSON.stringify({ label, method, path, mock: m, api: h }, null, 1))
  console.log(`   (full responses: ${f})`)
}
let pass = 0
let fail = 0
const failures: string[] = []
async function both(label: string, who: string, method: string, path: string, body?: unknown, query?: Record<string, unknown>, ifMatch?: number) {
  if (!inScope(method, path)) {
    skipped++
    return { m: { status: 0, data: {} } as Res, h: { status: 0, data: {} } as Res }
  }
  const [m, h] = [await mockCall(who, method, path, body, query, ifMatch), await httpCall(who, method, path, body, query, ifMatch)]
  if (path === '/sessions' && Array.isArray(m.data) && Array.isArray(h.data)) for (const x of [...m.data, ...h.data] as { id: string }[]) x.id = '<session-id>' // derived from the token (hash on the API)
  const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
  const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
  const all = [...d, ...dw]
  if (all.length) {
    fail++
    failures.push(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    console.log(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    dumpFailure(label, method, path, m, h)
  } else {
    pass++
    console.log(`PASS ${label} ${method} ${path} (${m.status})`)
  }
  return { m, h }
}

async function login(who: string, email: string) {
  const m = await mockCall('', 'POST', '/auth/login', { email, password: 'Seereon@123' })
  const h = await httpCall('', 'POST', '/auth/login', { email, password: 'Seereon@123' })
  mockTok[who] = (m.data as { token: string }).token
  httpTok[who] = (h.data as { token: string }).token
  const d = diff(norm(m.data), norm(h.data))
  if (d.length) {
    fail++
    failures.push(`FAIL login ${email}\n   ` + d.join('\n   '))
    console.log(`FAIL login ${email}\n   ` + d.join('\n   '))
  } else pass++
}

/** every shared GET route × several personas, ids substituted from the seed */
/**
 * The platform admin has no workspace row: PostgreSQL cannot hold tenant rows for it (tenant foreign keys), so the API
 * keeps what its reads lazily provision (General project, workflow templates, number sequences) request-local. The
 * in-memory mock has no such constraint and would keep them; drop them after each call so both sides start equal.
 */
function dropTenantlessRows() {
  const db = getDb() as unknown as Record<string, { tenant_id?: string }[]>
  const tenants = new Set((db.tenants as unknown as { id: string }[]).map((t) => t.id))
  for (const [t, list] of Object.entries(db)) {
    // users / admin_audit have no tenant FK; sessions, passwords, login attempts and reset tokens are platform tables
    if (['users', 'admin_audit', 'tenants', 'sessions', 'passwords', 'login_attempts', 'reset_tokens'].includes(t) || !Array.isArray(list)) continue
    for (let i = list.length - 1; i >= 0; i--) if (list[i]?.tenant_id && !tenants.has(list[i].tenant_id!)) list.splice(i, 1)
  }
}

async function sweep() {
  const db = getDb() as unknown as Record<string, { id: string; tenant_id: string; key?: string }[]>
  const first = (t: string) => db[t]?.find((r) => r.tenant_id === 'tn_seereon')
  const TABLE: [RegExp, string][] = [
    [/^\/projects\//, 'projects'], [/^\/tasks\//, 'tasks'], [/^\/(users|people)\//, 'users'], [/^\/(sales\/deals|deals)\//, 'deals'], [/^\/clients\//, 'clients'],
    [/^\/finance\/invoices\//, 'invoices'], [/^\/invoices\//, 'invoices'], [/^\/milestones\//, 'milestones'], [/^\/documents\//, 'documents'], [/^\/candidates\//, 'candidates'],
    [/^\/expenses\//, 'expense_claims'], [/^\/purchase-orders\//, 'purchase_orders'], [/^\/vendor-bills\//, 'vendor_bills'], [/^\/estimates\//, 'cost_estimates'],
    [/^\/wf\/instances\//, 'wf_instances'], [/^\/wf\/templates\//, 'wf_templates'], [/^\/doc-templates\//, 'doc_templates'], [/^\/issued-docs\//, 'issued_documents'],
    [/^\/employee-docs\//, 'employee_documents'], [/^\/changes\//, 'change_sets'], [/^\/appraisals\//, 'appraisals'], [/^\/appraisal-cycles\//, 'appraisal_cycles'],
    [/^\/contracts\//, 'contracts'], [/^\/assets\//, 'assets'], [/^\/okrs\//, 'objectives'], [/^\/lifecycle\//, 'lifecycle_checklists'], [/^\/reports\//, 'saved_reports'],
    [/^\/payroll\//, 'payroll_runs'], [/^\/ops\//, 'ops_items'], [/^\/vendors\//, 'vendors'], [/^\/budgets\//, 'budgets'], [/^\/leave-requests\//, 'leave_requests'],
  ]
  const FIXED: Record<string, string> = { ':key': 'hr_executive', ':week': '2026-09-21', ':process': 'expense', ':view': 'predictions', ':type': 'departments', ':token': 'x', ':userId': 'u_hritesh', ':uid': 'u_hritesh', ':month': new Date().toISOString().slice(0, 7) }
  const all = routeRegistry().filter((r) => !r.override && r.method === 'GET' && !r.opts.public)
  const routes = all.filter((r) => !r.opts.superAdmin)
  for (const [who, email] of [['subhankar', 'subhankar@seereon.co.in'], ['debasish', 'debasish@seereon.co.in'], ['platform', 'platform@seereon.co.in']] as const) if (!mockTok[who]) await login(who, email)
  // + the platform super admin (no tenant of its own: every tenant-settings read must behave like the TS, where a
  //   missing setting is `undefined`), on every GET route including the platform-only ones
  const users = process.env.SWEEP_USERS ? process.env.SWEEP_USERS.split(',') : ['santosh', 'subhankar', 'priya', 'hritesh', 'debasish', 'ananya', 'platform']
  for (const who of users) {
    for (const r of who === 'platform' ? all : routes) {
      let path = r.pattern
      const tbl = TABLE.find(([re]) => re.test(r.pattern))?.[1]
      path = path.replace(/:[A-Za-z_]+/g, (m) => FIXED[m] ?? (m === ':id' && tbl ? first(tbl)?.id ?? 'x' : 'x'))
      await both('sweep:' + who, who, 'GET', path)
      if (who === 'platform') dropTenantlessRows()
    }
  }
}

/** the same call on both sides with side-specific paths (ids generated by each side) */
async function bothSides(label: string, who: string, method: string, path: (side: 'm' | 'h') => string, body?: unknown, query?: Record<string, unknown>) {
  const mp = path('m')
  const hp = path('h')
  if (!inScope(method, mp)) {
    skipped++
    return null
  }
  const [m, h] = [await mockCall(who, method, mp, body, query), await httpCall(who, method, hp, body, query)]
  const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
  const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
  const all = [...d, ...dw]
  if (all.length) {
    fail++
    failures.push(`FAIL ${label} ${method} ${mp}\n   ` + all.join('\n   '))
    console.log(`FAIL ${label} ${method} ${mp}\n   ` + all.join('\n   '))
  } else {
    pass++
    console.log(`PASS ${label} ${method} ${mp} (${m.status})`)
  }
  return { m, h }
}

/** write scenarios of the ported modules (F1 reference examples; porters add theirs here) */
async function moduleScenarios() {
  if (!mockTok.debasish) await login('debasish', 'debasish@seereon.co.in')
  const id = (r: { m: Res; h: Res } | null, f: (d: any) => string | undefined) => (side: 'm' | 'h') => (r ? f((r[side] as Res).data) ?? 'x' : 'x') // eslint-disable-line @typescript-eslint/no-explicit-any
  /* notifications */
  await both('notif', 'priya', 'GET', '/notifications', undefined, { filter: 'unread', limit: 5, page: 2 })
  await both('notif', 'priya', 'GET', '/notifications', undefined, { limit: 'abc', page: '0' })
  const nl = await both('notif', 'hritesh', 'GET', '/notifications')
  const first = ((nl.m.data as { items?: { id: string }[] })?.items ?? [])[0]?.id ?? 'x'
  await both('notif', 'hritesh', 'POST', `/notifications/${first}/read`)
  await both('notif', 'priya', 'POST', `/notifications/${first}/read`)
  await both('notif', 'hritesh', 'POST', '/notifications/read-all')
  /* auth (shared, non-override) */
  await both('auth', 'santosh', 'PATCH', '/me/profile', { name: 'S', phone: '1' })
  await both('auth', 'santosh', 'PATCH', '/me/profile', { name: 'Santosh K Nayak', phone: '+91 90000 00000', title: 'CEO' })
  await both('auth', 'hritesh', 'GET', '/directory')
  await both('auth', 'hritesh', 'PUT', '/tenant/theme', { accent: '#000000' })
  await both('auth', 'santosh', 'PUT', '/tenant/logo', { data_url: 'data:text/plain;base64,aGVsbG8=' })
  await both('auth', 'santosh', 'PUT', '/tenant/logo', { data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' })
  await both('auth', 'santosh', 'GET', '/tenant')
  /* auth overrides (cross-tenant flows; tokens are volatile, ids normalised) */
  await both('auth', '', 'GET', '/invites/demo-invite-ritika')
  await both('auth', '', 'GET', '/invites/nope')
  await both('auth', '', 'POST', '/invites/demo-invite-ritika/accept', { name: 'Ritika', password: 'short' })
  await both('auth', '', 'POST', '/invites/demo-invite-ritika/accept', { name: 'Ritika Das', password: 'A long enough passphrase 1' })
  await both('auth', '', 'GET', '/invites/demo-invite-ritika')
  await both('auth', '', 'POST', '/auth/signup', { company: 'X', name: 'Asha Rao', email: 'asha@acme.example', password: 'Widgets are great 99' })
  await both('auth', '', 'POST', '/auth/signup', { company: 'Acme Widgets', name: 'Asha Rao', email: 'santosh@seereon.co.in', password: 'Widgets are great 99' })
  await both('auth', '', 'POST', '/auth/signup', { company: 'Acme Widgets', name: 'Asha Rao', email: 'asha@acme.example', password: 'password123' })
  await both('auth', '', 'POST', '/auth/signup', { company: 'Acme Widgets Pvt Ltd', name: 'Asha Rao', email: 'asha@acme.example', password: 'Widgets are great 99' })
  const rr = await both('auth', '', 'POST', '/auth/reset-request', { email: 'jayashree@seereon.co.in' })
  await both('auth', '', 'POST', '/auth/reset-request', { email: 'nobody@nowhere.io' })
  await bothSides('auth', '', 'GET', id(rr, (d) => `/auth/reset-info/${d?.demo_token}`))
  await bothSides('auth', '', 'POST', id(rr, () => '/auth/reset'), { token: 'not-a-token', password: 'Brand new passphrase 5' })
  await both('auth', '', 'POST', '/auth/login', { email: 'jayashree@seereon.co.in', password: 'Seereon@123' })
  await both('auth', 'hritesh', 'POST', '/me/password', { current: 'wrong', next: 'Another passphrase 1' })
  await both('auth', 'hritesh', 'POST', '/me/password', { current: 'Seereon@123', next: 'short' })
  /* billing */
  await both('billing', 'hritesh', 'GET', '/billing')
  await both('billing', 'santosh', 'POST', '/billing/quote', { plan_code: 'trial', seats: 3 })
  await both('billing', 'santosh', 'POST', '/billing/quote', { plan_code: 'growth', seats: 'abc' })
  await both('billing', 'santosh', 'POST', '/billing/quote', { plan_code: 'scale', seats: 17 })
  await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'growth', seats: 2, method: 'card' })
  await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'starter', seats: 500, method: 'card' })
  await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'growth', seats: 30, method: 'upi', upi_id: 'bad' })
  await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'growth', seats: 30, method: 'card', card_number: '4111 1111 1111 1111', expiry: '13/29', cvv: '123' })
  await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'growth', seats: 30, method: 'upi', upi_id: 'santosh@okhdfc', simulate_failure: true })
  await both('billing', 'santosh', 'POST', '/billing/seats', { seats: 40 })
  const co = await both('billing', 'santosh', 'POST', '/billing/checkout', { plan_code: 'growth', seats: 30, method: 'card', card_number: '4111 1111 1111 1111', expiry: '12/29', cvv: '123' })
  await bothSides('billing', 'santosh', 'GET', id(co, (d) => `/billing/invoices/${d?.invoice?.id}`))
  await both('billing', 'santosh', 'POST', '/billing/seats', { seats: 10 })
  await both('billing', 'santosh', 'POST', '/billing/seats', { seats: 45 })
  await both('billing', 'santosh', 'GET', '/billing')
  await both('billing', 'santosh', 'GET', '/notifications')
  /* makerChecker */
  await both('mc', 'santosh', 'GET', '/maker-checker/config')
  await both('mc', 'santosh', 'GET', '/maker-checker/checkers')
  await both('mc', 'hritesh', 'GET', '/maker-checker/checkers')
  await both('mc', 'ananya', 'PUT', '/maker-checker/config', { enabled: false, entities: ['role'], sla_days: 3 })
  await both('mc', 'ananya', 'PUT', '/maker-checker/config', { enabled: false, entities: ['role'], sla_days: 3 })
  await both('mc', 'ananya', 'PUT', '/maker-checker/config', { enabled: true, entities: ['role'], sla_days: 11 })
  await both('mc', 'ananya', 'GET', '/maker-checker/config')
  const p1 = await both('mc', 'santosh', 'PUT', '/maker-checker/config', { enabled: true, entities: ['role', 'vendor', 'budget'], sla_days: 4 })
  await both('mc', 'santosh', 'PUT', '/maker-checker/config', { enabled: true, entities: ['role'], sla_days: 4 })
  await both('mc', 'santosh', 'GET', '/changes', undefined, { status: 'all' })
  await both('mc', 'santosh', 'GET', '/changes/summary')
  await bothSides('mc', 'santosh', 'POST', id(p1, (d) => `/changes/${d?.change?.id}/approve`))
  await bothSides('mc', 'debasish', 'POST', id(p1, (d) => `/changes/${d?.change?.id}/reject`), { reason: 'too short' })
  await bothSides('mc', 'debasish', 'POST', id(p1, (d) => `/changes/${d?.change?.id}/approve`), { note: 'Looks right' })
  await bothSides('mc', 'debasish', 'GET', id(p1, (d) => `/changes/${d?.change?.id}`))
  await both('mc', 'santosh', 'GET', '/maker-checker/config')
  const p2 = await both('mc', 'santosh', 'PUT', '/maker-checker/config', { enabled: true, entities: ['role', 'vendor', 'budget'], sla_days: 2 })
  await bothSides('mc', 'debasish', 'POST', id(p2, (d) => `/changes/${d?.change?.id}/withdraw`))
  await bothSides('mc', 'debasish', 'POST', id(p2, (d) => `/changes/${d?.change?.id}/reject`), { reason: 'Not this quarter, please.' })
  await bothSides('mc', 'santosh', 'POST', id(p2, (d) => `/changes/${d?.change?.id}/withdraw`))
  await both('mc', 'santosh', 'GET', '/changes', undefined, { status: 'decided' })
  await both('mc', 'debasish', 'GET', '/changes', undefined, { scope: 'to_check' })
  await both('mc', 'hritesh', 'GET', '/changes')
  await both('mc', 'santosh', 'GET', '/notifications')
  /* admin (platform) */
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/extend', { days: 31, reason: 'customer asked' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/extend', { days: 7, reason: 'no' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_nope/extend', { days: 7, reason: 'customer asked' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/extend', { days: 7, reason: 'customer asked' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/suspend', { reason: 'payment dispute' })
  await both('admin', 'ananya', 'GET', '/me')
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/suspend', { reason: 'payment dispute' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/extend', { days: 7, reason: 'customer asked' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_kalinga/reactivate', { reason: 'resolved now' })
  await both('admin', 'platform', 'POST', '/admin/tenants/tn_seereon/reactivate', { reason: 'resolved now' })
  await both('admin', 'platform', 'GET', '/admin/tenants')
  await both('admin', 'platform', 'GET', '/admin/audit')
  await costingScenarios()
  await rfScenarios()
  await rdScenarios()
  await raScenarios()
  await rcScenarios()
  await rbScenarios({ both, sides: (l, w, m, p, b) => bothSides(l, w, m, p, b('m')), login, has: (w) => !!mockTok[w] })
  await reScenarios({ both, sides: (l, w, m, p, b) => bothSides(l, w, m, p, b('m')), login, has: (w) => !!mockTok[w] })
}

/** costing engine routes (src/mock/costing.ts registerCostingRoutes; OpenAPI tag "projects") — F2b */
async function costingScenarios() {
  if (!mockTok.subhankar) await login('subhankar', 'subhankar@seereon.co.in')
  const L = 'costing'
  for (const who of ['santosh', 'hritesh']) await both(L, who, 'GET', '/projects/next-code')
  await both(L, 'santosh', 'GET', '/projects/calendar-summary', undefined, { from: '2026-10-01', to: '2027-03-31' })
  await both(L, 'santosh', 'GET', '/projects/calendar-summary', undefined, { from: '2026-10-01' })
  for (const who of ['santosh', 'subhankar', 'hritesh', 'priya']) {
    await both(L, who, 'GET', '/projects/p_hrms/costing')
    await both(L, who, 'GET', '/projects/p_hrms/summary')
    await both(L, who, 'GET', '/finance/margins', undefined, { scope: 'all' })
    await both(L, who, 'GET', '/costing/rates')
  }
  await both(L, 'ananya', 'GET', '/projects/p_hrms/costing')
  await both(L, 'santosh', 'GET', '/finance/margins', undefined, { scope: 'open' })
  const ms = [{ name: 'Design', billing_amount_paise: 500000 }, { name: 'Build', billing_amount_paise: 1500000 }, { name: '' }]
  const create = { start_on: '2026-11-02', end_on: '2027-03-31', milestones: ms, markup_pct: 20 }
  await both(L, 'santosh', 'POST', '/projects/costing/preview', { ...create, resources: [{ user_id: 'u_hritesh', milestone_index: 0, pct: 50 }, { user_id: 'u_bijaya', milestone_index: 1, pct: 100, from_on: '2026-12-01', to_on: '2027-01-15' }] })
  await both(L, 'subhankar', 'POST', '/projects/costing/preview', { ...create, resources: [{ user_id: 'u_hritesh', milestone_index: 0, pct: 100 }, { user_id: 'u_hritesh', milestone_index: 0, pct: 100 }] })
  await both(L, 'santosh', 'POST', '/projects/costing/preview', { ...create, resources: [{ user_id: 'u_hritesh', pct: 50 }, { user_id: 'u_nobody', milestone_index: 0, pct: 0 }] })
  await both(L, 'hritesh', 'POST', '/projects/costing/preview', create)
  await both(L, 'santosh', 'POST', '/projects/costing/preview', { project_id: 'p_nope' })
  const cur = await both(L, 'santosh', 'GET', '/projects/p_hrms/costing')
  const rows = (((cur.m.data as { preview?: { rows?: Record<string, unknown>[] } })?.preview?.rows) ?? []).map((r) => ({ key: r.key, id: r.id, user_id: r.user_id, milestone_id: r.milestone_id, pct: r.pct, from_on: r.from_on, to_on: r.to_on }))
  await both(L, 'santosh', 'POST', '/projects/costing/preview', { project_id: 'p_hrms', resources: rows, price_mode: 'price', price_paise: 150000000 })
  await both(L, 'santosh', 'PUT', '/projects/p_hrms/costing', { resources: rows, contingency_pct: 150 })
  await both(L, 'santosh', 'PUT', '/projects/p_hrms/costing', { resources: [{ user_id: 'u_hritesh', pct: 50 }] })
  await both(L, 'hritesh', 'PUT', '/projects/p_hrms/costing', { resources: rows })
  await both(L, 'santosh', 'PUT', '/projects/p_hrms/costing', {
    resources: [...rows.slice(1).map((r, i) => (i === 0 ? { ...r, pct: 40 } : r)), { key: 'n1', user_id: 'u_jagannath', milestone_id: rows[0]?.milestone_id, pct: 25 }],
    price_mode: 'markup', markup_pct: 30, contingency_pct: 5, maintenance_paise: 250000, additional_costs: [{ category: 'travel', description: 'Client visits', amount_paise: 400000 }],
  })
  await both(L, 'santosh', 'GET', '/projects/p_hrms/costing')
  await both(L, 'subhankar', 'GET', '/projects/p_hrms/costing')
  await both(L, 'santosh', 'GET', '/finance/margins')
  await both(L, 'santosh', 'GET', '/projects/p_hrms/summary')
  await both(L, 'santosh', 'GET', '/notifications')
}

/** RF: sales.ts, dashboards.ts, company.ts write scenarios (valid + invalid bodies, allowed + denied roles) */
async function rfScenarios() {
  for (const [who, email] of [['baishali', 'baishali@seereon.co.in'], ['subham', 'subham@seereon.co.in'], ['subhankar', 'subhankar@seereon.co.in'], ['debasish', 'debasish@seereon.co.in'], ['bijaya', 'bijaya@seereon.co.in']] as const) if (!mockTok[who]) await login(who, email)
  const id = (r: { m: Res; h: Res } | null, f: (d: any) => string | undefined) => (side: 'm' | 'h') => (r && (r[side] as Res).data ? f((r[side] as Res).data) ?? f({ id: 'x' })! : f({ id: 'x' })!) // eslint-disable-line @typescript-eslint/no-explicit-any
  const L = 'rf-sales'
  /* reads with query variants */
  for (const who of ['santosh', 'baishali', 'subham', 'hritesh', 'priya']) {
    await both(L, who, 'GET', '/sales/deals', undefined, { q: 'school', stage: 'proposal' })
    await both(L, who, 'GET', '/sales/summary', undefined, { owner_id: 'u_subham', week: '2026-09-02' })
    await both(L, who, 'GET', '/sales/activity', undefined, { days: '90' })
    await both(L, who, 'GET', '/sales/performance', undefined, { kind: 'quarter' })
    await both(L, who, 'GET', '/sales/compensation', undefined, { kind: 'fy' })
  }
  await both(L, 'santosh', 'GET', '/sales/deals', undefined, { owner_id: 'u_baishali', source: 'bni', product: 'EduReon' })
  await both(L, 'santosh', 'GET', '/sales/activity', undefined, { from: '2026-05-01', to: '2026-09-30', user_id: 'u_subham' })
  await both(L, 'santosh', 'GET', '/sales/activity', undefined, { from: '2026-09-30', to: '2026-05-01' })
  await both(L, 'santosh', 'GET', '/sales/activity', undefined, { days: 'abc' })
  await both(L, 'santosh', 'GET', '/sales/performance', undefined, { from: '2026-01-01', to: '2026-12-31' })
  await both(L, 'santosh', 'GET', '/sales/performance', undefined, { from: '2026-12-31', to: '2026-01-01' })
  await both(L, 'santosh', 'GET', '/sales/performance', undefined, { kind: 'year', anchor: '2025-06-15' })
  await both(L, 'baishali', 'GET', '/sales/performance', undefined, { month: '2026-07' })
  await both(L, 'santosh', 'GET', '/sales/compensation', undefined, { month: '2026-08' })
  await both(L, 'santosh', 'GET', '/sales/compensation', undefined, { kind: 'quarter', anchor: '2026-04-10' })
  await both(L, 'subham', 'GET', '/sales/compensation', undefined, { kind: 'month' })
  /* create */
  await both(L, 'hritesh', 'POST', '/sales/deals', { title: 'Nope', client: 'X', expected_close: '2026-12-01' })
  await both(L, 'baishali', 'POST', '/sales/deals', { client: 'X', expected_close: '2026-12-01' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-02-30' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', value_paise: -5 })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', value_paise: 1.5 })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', phone: '12ab' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', email: 'x@' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', source: 'tv' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', product: 'Toaster' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', owner_id: 'u_hritesh' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', owner_id: 'u_ankit' })
  await both(L, 'subham', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', owner_id: 'u_baishali' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', stage: 'won' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', next_step_on: 'soon', next_step: 'Call' })
  await both(L, 'baishali', 'POST', '/sales/deals', { title: 'ERP rollout', client: 'DAV School', expected_close: '2026-12-01', first_conversation: 'x'.repeat(2001) })
  const c1 = await both(L, 'baishali', 'POST', '/sales/deals', {
    title: '  ERP rollout ', client: ' DAV School ', contact: ' Mr Rao ', phone: '+91 98765-43210', email: 'rao@dav.example', product: 'EduReon', source: 'bni', owner_id: 'u_subham',
    value_paise: 12000000, mrr_paise: 500000, expected_close: '2026-12-01', notes: ' warm ', next_step: ' Demo ', next_step_on: '2026-10-20', first_conversation: ' Met at the BNI meeting and talked about fees. ',
  })
  const c2 = await both(L, 'subham', 'POST', '/sales/deals', { title: 'Payroll pilot', client: 'Kalinga Steel', expected_close: '2026-11-15', stage: 'qualified' })
  const deal1 = id(c1, (d) => `/sales/deals/${d?.id}`)
  const deal2 = id(c2, (d) => `/sales/deals/${d?.id}`)
  await bothSides(L, 'subham', 'GET', deal1)
  await bothSides(L, 'hritesh', 'GET', deal1)
  /* edit */
  await bothSides(L, 'subham', 'PATCH', deal1, { title: '' })
  await bothSides(L, 'subham', 'PATCH', deal1, { mrr_paise: 'lots' })
  await bothSides(L, 'subham', 'PATCH', deal1, { owner_id: 'u_baishali' })
  await bothSides(L, 'baishali', 'PATCH', deal2, { title: ' Payroll pilot v2 ', contact: ' Ms Das ', next_step: '', next_step_on: '2026-10-25', value_paise: 0, stage: 'won', owner_id: 'u_baishali', product: '' })
  await bothSides(L, 'subham', 'PATCH', deal2, { notes: 'mine?' })
  await bothSides(L, 'baishali', 'PATCH', deal1, { expected_close: '' })
  /* stage moves */
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'archived' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'lost', reason: ' no ' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'lead' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'proposal' })
  await bothSides(L, 'baishali', 'POST', (s) => deal2(s) + '/stage', { stage: 'won' })
  await bothSides(L, 'baishali', 'PATCH', deal2, { value_paise: 2500000 })
  await bothSides(L, 'baishali', 'POST', (s) => deal2(s) + '/stage', { stage: 'won' })
  await bothSides(L, 'baishali', 'PATCH', deal2, { value_paise: 0, mrr_paise: 0 })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'won' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/stage', { stage: 'negotiation' })
  await bothSides(L, 'subham', 'PATCH', deal1, { notes: 'closed now' })
  await bothSides(L, 'baishali', 'POST', (s) => deal1(s) + '/stage', { stage: 'negotiation' })
  await bothSides(L, 'baishali', 'POST', (s) => deal1(s) + '/stage', { stage: 'lost', reason: 'Went with a cheaper vendor' })
  await bothSides(L, 'baishali', 'POST', (s) => deal1(s) + '/stage', { stage: 'lead', reason: 'They came back' })
  /* activities */
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'telegram', note: 'Called them' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'call', note: 'ok' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'call', note: 'Called them', date: '2099-01-01' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'call', note: 'Called them', date: 'yesterday' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'meeting', note: ' Walked the principal through the fees module ', date: '2026-10-01', next_step: ' Send proposal ' })
  await bothSides(L, 'subham', 'POST', (s) => deal1(s) + '/activities', { type: 'email', note: 'Sent the proposal', next_step: '' })
  await bothSides(L, 'subham', 'GET', deal1)
  await bothSides(L, 'santosh', 'PATCH', deal1, { owner_id: 'u_baishali', next_step: '' })
  await both(L, 'baishali', 'GET', '/notifications')
  /* project from a won deal */
  await bothSides(L, 'subham', 'POST', (s) => deal2(s) + '/create-project', { name: 'X', client: 'Y' })
  await bothSides(L, 'santosh', 'POST', (s) => deal1(s) + '/create-project', { name: 'X', client: 'Y' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: ' ', client: 'Y' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: '' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel', contract_value_paise: -1 })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel', type: 'retainer' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel', start_on: '2026-11-01', end_on: '2026-10-01' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel', pm_id: 'u_hritesh' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel', pm_id: 'u_subhankar', start_on: '2026-11-01' })
  await bothSides(L, 'santosh', 'POST', (s) => deal2(s) + '/create-project', { name: 'Payroll pilot', client: 'Kalinga Steel' })
  await bothSides(L, 'santosh', 'GET', deal2)
  await both(L, 'subhankar', 'GET', '/notifications')
  /* delete */
  await bothSides(L, 'subham', 'DELETE', deal1)
  await bothSides(L, 'santosh', 'DELETE', deal2)
  await bothSides(L, 'santosh', 'GET', deal2)
  await bothSides(L, 'santosh', 'DELETE', deal1)
  for (const who of ['santosh', 'baishali', 'subham']) {
    await both(L, who, 'GET', '/sales/deals')
    await both(L, who, 'GET', '/sales/summary')
    await both(L, who, 'GET', '/sales/activity')
    await both(L, who, 'GET', '/sales/performance')
    await both(L, who, 'GET', '/sales/compensation')
    await both(L, who, 'GET', '/notifications')
  }
  await rfDashScenarios()
  await rfCompanyScenarios()
}

async function rfDashScenarios() {
  const L = 'rf-dash'
  for (const q of [{}, { period: 'quarter' }, { period: 'fy', anchor: '2025-08-10' }, { period: 'month', anchor: '2099-01-01', week: '2026-09-09' }, { period: 'bogus', anchor: 'x' }]) await both(L, 'santosh', 'GET', '/dashboards/ceo', undefined, q)
  for (const who of ['debasish', 'subhankar', 'priya']) await both(L, who, 'GET', '/dashboards/ceo')
  for (const who of ['santosh', 'subhankar', 'hritesh', 'priya', 'baishali']) {
    await both(L, who, 'GET', '/dashboards/pm', undefined, { week: '2026-09-23' })
    await both(L, who, 'GET', '/dashboards/sales')
    await both(L, who, 'GET', '/dashboards/ops')
    await both(L, who, 'GET', '/dashboards/employee', undefined, { week: '2026-10-05' })
    await both(L, who, 'GET', '/dashboards/mentions')
    await both(L, who, 'GET', '/scorecard', undefined, { week: '2026-09-02' })
    await both(L, who, 'GET', '/insights')
  }
  for (const [who, user] of [['subhankar', 'u_hritesh'], ['subhankar', 'u_bijaya'], ['santosh', 'u_subham'], ['hritesh', 'u_bijaya'], ['santosh', 'u_nobody'], ['priya', 'u_jayashree'], ['santosh', 'u_ankit']] as const) {
    await both(L, who, 'GET', '/dashboards/employee', undefined, { user })
    await both(L, who, 'GET', '/dashboards/employee', undefined, { user, week: '2026-08-31' })
    await both(L, who, 'GET', '/dashboards/mentions', undefined, { user })
  }
  await both(L, 'hritesh', 'GET', '/dashboards/employee', undefined, { week: '2099-01-05' })
  for (const who of ['santosh', 'subhankar', 'baishali', 'priya', 'subham']) {
    for (const v of ['tasks_at_risk', 'blocked', 'overdue_milestones', 'effort_ratio', 'allocation', 'timesheet_compliance', 'approval_kpi', 'stale_deals', 'predictions', 'estimation']) await both(L, who, 'GET', '/insights/' + v)
  }
  for (const v of ['nope', 'constructor', 'toString']) await both(L, 'santosh', 'GET', '/insights/' + v)
  await both(L, 'hritesh', 'GET', '/insights/blocked')
  for (const week of ['2026-10-14', '2026-07-01', '2027-01-04', 'garbage']) await both(L, 'santosh', 'GET', '/scorecard', undefined, { week })
  await both(L, 'santosh', 'GET', '/rules/score')
}

async function rfCompanyScenarios() {
  const L = 'rf-company'
  const id = (r: { m: Res; h: Res } | null, f: (d: any) => string | undefined) => (side: 'm' | 'h') => (r && (r[side] as Res).data ? f((r[side] as Res).data) ?? f({ id: 'x' })! : f({ id: 'x' })!) // eslint-disable-line @typescript-eslint/no-explicit-any
  await both(L, 'santosh', 'GET', '/directory/holders')
  await both(L, 'santosh', 'GET', '/directory/holders', undefined, { perm: 'bogus, also.bogus' })
  await both(L, 'hritesh', 'GET', '/directory/holders', undefined, { perm: 'deals.edit_own' })
  await both(L, 'santosh', 'GET', '/directory/holders', undefined, { perm: ' projects.edit ,timesheet.approve' })
  for (const who of ['santosh', 'subhankar', 'priya', 'hritesh', 'baishali', 'debasish', 'subham', 'ananya']) {
    await both(L, who, 'GET', '/inbox')
    await both(L, who, 'GET', '/inbox/summary')
    await both(L, who, 'GET', '/inbox/mine')
    await both(L, who, 'GET', '/okrs')
  }
  await both(L, 'santosh', 'GET', '/okrs', undefined, { period: 'Q2 FY26-27' })
  await both(L, 'santosh', 'GET', '/okrs', undefined, { period: 'Q9 FY99', owner: 'u_baishali' })
  await both(L, 'subhankar', 'GET', '/okrs', undefined, { owner: 'u_hritesh' })
  /* objectives */
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'galaxy', title: 'Something big' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'ab' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'x'.repeat(161) })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'company', title: 'Rule the market' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'team', title: 'My own team goal' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'Learn Rust', owner_id: 'u_bijaya' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'Learn Rust', owner_id: 'u_nobody' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'Learn Rust', parent_id: 'okr_hritesh' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'Learn Rust', parent_id: 'okr_p_ontime' })
  await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: 'Learn Rust', parent_id: 'okr_nope' })
  const o1 = await both(L, 'hritesh', 'POST', '/okrs/objectives', { level: 'person', title: '  Learn Rust properly  ', parent_id: 'okr_delivery' })
  const o2 = await both(L, 'subhankar', 'POST', '/okrs/objectives', { level: 'team', title: 'Zero escaped defects', owner_id: 'u_subhankar', period: 'Q2 FY26-27' })
  const o3 = await both(L, 'santosh', 'POST', '/okrs/objectives', { level: 'company', title: 'Expand to two new cities', period: 'nope' })
  await both(L, 'santosh', 'POST', '/okrs/objectives', { level: 'company', title: 'Expand again', parent_id: 'okr_rev' })
  const ob1 = id(o1, (d) => `/okrs/objectives/${d?.id}`)
  const ob2 = id(o2, (d) => `/okrs/objectives/${d?.id}`)
  const ob3 = id(o3, (d) => `/okrs/objectives/${d?.id}`)
  await bothSides(L, 'bijaya', 'PATCH', ob1, { title: 'Not mine' })
  await bothSides(L, 'hritesh', 'PATCH', ob1, { status: 'paused' })
  await bothSides(L, 'hritesh', 'PATCH', ob1, { parent_id: 'okr_rev' })
  await bothSides(L, 'hritesh', 'PATCH', ob1, { parent_id: 'okr_hritesh' })
  await bothSides(L, 'hritesh', 'PATCH', ob1, { title: 'Learn Rust and ship it', parent_id: null })
  await bothSides(L, 'subhankar', 'PATCH', ob1, { status: 'done' })
  await bothSides(L, 'subhankar', 'PATCH', ob1, { status: 'on_track' })
  await bothSides(L, 'santosh', 'PATCH', ob3, { parent_id: 'okr_rev' })
  /* key results */
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'Something', metric: 'vibes', target: 5 })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'ok', target: 5 })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'Ship modules', target: 'lots' })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'Ship modules', target: '' })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'Ship modules', target: 0 })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'On-time share', metric: 'on_time_task_pct', target: 120 })
  await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'Ship modules', target: 4, owner_id: 'u_nobody' })
  const k1 = await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: ' Ship modules ', target: 4, unit: ' modules in production ' })
  const k2 = await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: 'On-time share', metric: 'on_time_task_pct', start_value: 60, target: 90 })
  for (const t of ['Third KR', 'Fourth KR', 'Fifth KR', 'Sixth KR', 'Seventh KR']) await bothSides(L, 'hritesh', 'POST', (s) => ob1(s) + '/key-results', { title: t, target: 3, unit: '%' })
  await bothSides(L, 'subhankar', 'POST', (s) => ob2(s) + '/key-results', { title: 'Escaped defects', start_value: 10, target: 0, unit: '₹' })
  await bothSides(L, 'subhankar', 'POST', (s) => ob2(s) + '/key-results', { title: 'Hiring done', metric: 'headcount', start_value: 5, target: 9 })
  await bothSides(L, 'santosh', 'POST', (s) => ob3(s) + '/key-results', { title: 'Revenue from new cities', metric: 'revenue_billed', target: 1000000 })
  await bothSides(L, 'santosh', 'POST', (s) => ob3(s) + '/key-results', { title: 'Leakage down', metric: 'leakage', start_value: 500000, target: 0 })
  await bothSides(L, 'santosh', 'POST', (s) => ob3(s) + '/key-results', { title: 'Margin', metric: 'margin_pct', start_value: 10, target: 30 })
  await bothSides(L, 'santosh', 'POST', (s) => ob3(s) + '/key-results', { title: 'Deals won', metric: 'deals_won_value', target: 5000000 })
  await bothSides(L, 'santosh', 'POST', (s) => ob3(s) + '/key-results', { title: 'Compliance', metric: 'timesheet_compliance', start_value: 50, target: 95 })
  const kr1 = id(k1, (d) => `/okrs/key-results/${d?.id}`)
  const kr2 = id(k2, (d) => `/okrs/key-results/${d?.id}`)
  await bothSides(L, 'bijaya', 'PATCH', kr1, { target: 6 })
  await bothSides(L, 'hritesh', 'PATCH', kr1, { target: 0 })
  await bothSides(L, 'hritesh', 'PATCH', kr1, { target: 6, title: 'Ship six modules' })
  await bothSides(L, 'hritesh', 'POST', (s) => kr2(s) + '/check-in', { value: 70, note: 'Going well' })
  await bothSides(L, 'bijaya', 'POST', (s) => kr1(s) + '/check-in', { value: 2, note: 'Two modules done' })
  await bothSides(L, 'hritesh', 'POST', (s) => kr1(s) + '/check-in', { value: 'two', note: 'Two modules done' })
  await bothSides(L, 'hritesh', 'POST', (s) => kr1(s) + '/check-in', { value: 2, note: 'ok' })
  await bothSides(L, 'hritesh', 'POST', (s) => kr1(s) + '/check-in', { value: 2.5, note: ' Two and a half modules done ' })
  await both(L, 'subhankar', 'POST', '/okrs/key-results/okr_delivery_kr3/check-in', { value: 3, note: 'Three defects this sprint' })
  await both(L, 'hritesh', 'POST', '/okrs/key-results/okr_delivery_kr3/check-in', { value: 2, note: 'Two defects now, fixed one' })
  await both(L, 'hritesh', 'GET', '/okrs')
  await both(L, 'subhankar', 'GET', '/okrs')
  await both(L, 'santosh', 'GET', '/okrs')
  await both(L, 'priya', 'GET', '/okrs')
  await bothSides(L, 'hritesh', 'DELETE', kr2)
  await bothSides(L, 'bijaya', 'DELETE', kr1)
  await both(L, 'subhankar', 'DELETE', '/okrs/objectives/okr_delivery')
  await both(L, 'hritesh', 'DELETE', '/okrs/objectives/okr_bijaya')
  await bothSides(L, 'hritesh', 'DELETE', ob1)
  await bothSides(L, 'santosh', 'DELETE', ob3)
  await both(L, 'santosh', 'GET', '/okrs')
  /* audit */
  for (const q of [{}, { q: 'stage' }, { actor: 'u_baishali', entity: 'deal' }, { from: '2026-09-01', to: '2026-09-30', page: 2 }, { all: 1 }, { page: 'abc' }, { entity: 'objective' }]) await both(L, 'santosh', 'GET', '/audit', undefined, q)
  await both(L, 'subhankar', 'GET', '/audit')
  /* approval workflow configuration (registered by company.ts) */
  await both(L, 'santosh', 'GET', '/workflows')
  await both(L, 'hritesh', 'GET', '/workflows')
  await both(L, 'santosh', 'POST', '/workflows/expense/simulate', { amount_paise: 2500000, requester_id: 'u_hritesh' })
  await both(L, 'santosh', 'PUT', '/workflows/expense', { steps: [] })
  await both(L, 'santosh', 'PUT', '/workflows/nope', { steps: [] })
  await both(L, 'hritesh', 'POST', '/workflows/expense/reset')
  await both(L, 'santosh', 'GET', '/inbox')
  await both(L, 'santosh', 'GET', '/audit', undefined, { q: 'objective' })
}

/** RA: tasks.ts, taskflow.ts, projects.ts scenarios (valid + invalid bodies, allowed + denied roles) */
async function raScenarios() {
  for (const [who, email] of [['subhankar', 'subhankar@seereon.co.in'], ['debasish', 'debasish@seereon.co.in'], ['baishali', 'baishali@seereon.co.in'], ['bijaya', 'bijaya@seereon.co.in'], ['jagannath', 'jagannath@seereon.co.in'], ['jayashree', 'jayashree@seereon.co.in'], ['pragyasmita', 'pragyasmita@seereon.co.in']] as const) if (!mockTok[who]) await login(who, email)
  const id = (r: { m: Res; h: Res } | null, f: (d: any) => string | undefined) => (side: 'm' | 'h') => (r && (r[side] as Res).data ? f((r[side] as Res).data) ?? f({ id: 'x' })! : f({ id: 'x' })!) // eslint-disable-line @typescript-eslint/no-explicit-any
  /** same call, side-specific bodies (tokens / ids generated by each side) */
  const bothBodies = async (label: string, who: string, method: string, path0: string | ((side: 'm' | 'h') => string), body: (side: 'm' | 'h') => unknown, query?: Record<string, unknown>) => {
    const pth = (side: 'm' | 'h') => (typeof path0 === 'string' ? path0 : path0(side))
    const path = pth('m')
    if (!inScope(method, path)) return skipped++
    const [m, h] = [await mockCall(who, method, path, body('m'), query), await httpCall(who, method, pth('h'), body('h'), query)]
    const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
    const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
    const all = [...d, ...dw]
    if (all.length) {
      fail++
      failures.push(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
      console.log(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    } else {
      pass++
      console.log(`PASS ${label} ${method} ${path} (${m.status})`)
    }
  }
  /* ---------- reads with query variants ---------- */
  let L = 'ra-read'
  const taskQs: Record<string, unknown>[] = [
    {}, { status: 'all' }, { status: 'done' }, { stage: 'in_review' }, { stage: 'uat', status: 'open' }, { stage: 'constructor' }, { person: 'me' }, { person: 'u_jagannath' },
    { chip: 'covering' }, { chip: 'tagged' }, { chip: 'overdue' }, { chip: 'blocked' }, { chip: 'mine' }, { q: ' Payroll ' }, { project: 'p_hrms', milestone: 'ms_hrms_2' },
    { milestone: 'none' }, { group: 'employee', status: 'all' }, { department: 'kind:engineering' }, { label: 'backend' }, { tag: 'feature' }, { complexity: 'high' }, { overdue: '1' },
    { week: '2026-10-21' }, { week: 'bad' }, { status: 'blocked', person: 'all' },
  ]
  for (const who of ['santosh', 'subhankar', 'hritesh', 'priya', 'baishali', 'jayashree']) for (const q of taskQs) await both(L, who, 'GET', '/tasks', undefined, q)
  for (const who of ['santosh', 'hritesh', 'subhankar', 'pragyasmita']) {
    await both(L, who, 'GET', '/tasks/mentions', undefined, { limit: '2' })
    await both(L, who, 'GET', '/tasks/mentions', undefined, { user: 'u_hritesh', limit: 'abc' })
    await both(L, who, 'GET', '/my-tasks', undefined, { week: '2026-10-21' })
    await both(L, who, 'GET', '/delivery/risks')
    await both(L, who, 'GET', '/delivery/risks', undefined, { project_id: 'p_hrms' })
    await both(L, who, 'GET', '/delivery/risks', undefined, { project_id: 'p_rcu' })
    await both(L, who, 'GET', '/team-tasks/review-queue', undefined, { all: '1' })
    await both(L, who, 'GET', '/analytics/tasks', undefined, { scope: 'company', group: 'project' })
    await both(L, who, 'GET', '/analytics/tasks', undefined, { scope: 'team', group: 'manager', from: '2026-09-01', to: '2026-10-31' })
    await both(L, who, 'GET', '/analytics/tasks', undefined, { scope: 'me', from: 'bad' })
    await both(L, who, 'GET', '/tasks/create-options')
    for (const t of ['t_hrms_5', 't_hrms_7', 't_mgs_uat1', 't_gen_seereon_laptop', 't_gen_seereon_bni', 't_rcu_1', 'r_01za', 't_dms_3']) {
      await both(L, who, 'GET', `/tasks/${t}`)
      await both(L, who, 'GET', `/tasks/${t}/comments`)
      await both(L, who, 'GET', `/tasks/${t}/reviews`)
    }
  }
  await both(L, 'santosh', 'GET', '/delivery/risks', undefined, { project_id: 'p_nope' })
  await both(L, 'santosh', 'GET', '/tasks/estimate-hint', undefined, { complexity: 'high', est: '10', owner_id: 'u_hritesh' })
  await both(L, 'santosh', 'GET', '/tasks/estimate-hint', undefined, { complexity: 'nope' })
  await both(L, 'santosh', 'GET', '/tasks/estimate-hint', undefined, { complexity: 'toString' })
  await both(L, 'santosh', 'GET', '/tasks/estimate-hint')
  await both(L, 'santosh', 'GET', '/tasks/x404')
  await both(L, 'ananya', 'GET', '/tasks/t_hrms_5')
  const projQs: Record<string, unknown>[] = [{ q: 'edu' }, { type: 'service' }, { status: 'active', sort: 'name' }, { sort: 'end' }, { sort: 'health' }, { sort: 'progress' }, { status: 'completed' }]
  for (const who of ['santosh', 'subhankar', 'hritesh', 'baishali', 'priya']) {
    for (const q of projQs) await both(L, who, 'GET', '/projects', undefined, q)
    for (const p of ['p_hrms', 'p_mgs', 'p_crm', 'p_rcu', 'p_dms', 'p_samet', 'p_general_seereon']) {
      await both(L, who, 'GET', `/projects/${p}`)
      for (const s of ['schedule', 'load', 'money', 'change-requests', 'activity', 'client-view']) await both(L, who, 'GET', `/projects/${p}/${s}`)
    }
    await both(L, who, 'GET', '/openings')
    await both(L, who, 'GET', '/invoices/next-number')
    await both(L, who, 'GET', '/team-tasks')
    await both(L, who, 'GET', '/team-tasks/options')
  }

  /* ---------- tasks.ts writes ---------- */
  L = 'ra-tasks'
  const good = { title: 'Build the leave ledger export', project_id: 'p_hrms', milestone_id: 'ms_hrms_3', owner_id: 'u_hritesh', est_hours: 6.3, start_on: '2026-10-19', due_on: '2026-10-24', complexity: 'medium', tag: 'feature' }
  const bad: [string, Record<string, unknown>][] = [
    ['subhankar', { ...good, title: 'ab' }], ['subhankar', { ...good, title: 'x'.repeat(201) }], ['subhankar', { ...good, description: 'd'.repeat(6001) }], ['subhankar', { ...good, project_id: '' }],
    ['subhankar', { ...good, project_id: 'p_nope' }], ['subhankar', { ...good, project_id: 'p_samet' }], ['subhankar', { ...good, owner_id: '' }], ['subhankar', { ...good, owner_id: 'u_ankit' }],
    ['hritesh', good], ['subhankar', { ...good, milestone_id: undefined }], ['subhankar', { ...good, milestone_id: 'ms_crm_1' }], ['subhankar', { ...good, backup_id: 'u_hritesh' }],
    ['subhankar', { ...good, reviewer_id: 'u_hritesh' }], ['subhankar', { ...good, priority: 'P9' }], ['subhankar', { ...good, complexity: 'huge' }], ['subhankar', { ...good, tag: 'chore' }],
    ['subhankar', { ...good, est_hours: 0.2 }], ['subhankar', { ...good, est_hours: '' }], ['subhankar', { ...good, start_on: '2026-02-30' }], ['subhankar', { ...good, due_on: '2026-10-18' }],
    ['subhankar', { ...good, start_on: '2026-10-01', due_on: '2026-10-02' }], ['subhankar', { ...good, depends_on: ['t_crm_1'] }], ['subhankar', { ...good, depends_on: 'x' }],
    ['subhankar', { ...good, watcher_ids: ['u_ankit'] }], ['subhankar', { ...good, acceptance_criteria: ['c'.repeat(301)] }], ['subhankar', { ...good, labels: Array.from({ length: 11 }, (_, i) => 'l' + i) }],
    ['subhankar', { ...good, recurrence: 'daily' }], ['subhankar', { ...good, attachments: [{}, {}, {}, {}, {}, {}] }], ['subhankar', { ...good, attachments: [{ name: 'a.pdf', size: 900000 }] }],
    ['subhankar', { ...good, attachments: [{ name: 'a.pdf', size: 10, data_url: 'nope' }] }], ['subhankar', { ...good, parent_task_id: 't_nope' }], ['subhankar', { ...good, concerned_manager_id: 'u_hritesh' }],
    ['hritesh', { ...good, project_id: 'p_general_seereon', milestone_id: undefined, owner_id: 'u_bijaya' }], ['bijaya', { ...good, project_id: 'p_general_seereon', milestone_id: undefined, owner_id: 'u_hritesh' }],
  ]
  for (const [who, b] of bad) await both(L, who, 'POST', '/tasks', b)
  const c1 = await both(L, 'subhankar', 'POST', '/tasks', {
    ...good, title: '  Build the leave ledger export  ', est_hours: 6.3, start_on: '2026-10-18', due_on: '2026-12-05', priority: 'P1', depends_on: ['t_hrms_8', 't_hrms_8'], watcher_ids: ['u_priya', 'u_bijaya'],
    acceptance_criteria: ['Totals match payroll', { text: ' CSV opens in Excel ' }, '', 5], labels: ['backend', ' export ', 'backend'], parent_task_id: 't_hrms_8', backup_id: 'u_bijaya', description: ' Export it ',
  })
  const c2 = await both(L, 'hritesh', 'POST', '/tasks', { title: 'Renew my VPN token', project_id: 'p_general_seereon', owner_id: 'u_hritesh', est_hours: 1, start_on: '2026-10-16', due_on: '2026-10-16', billable: true })
  const c3 = await both(L, 'subhankar', 'POST', '/tasks', { title: 'Weekly status report', project_id: 'p_general_seereon', owner_id: 'u_jagannath', est_hours: 2, start_on: '2026-10-16', due_on: '2026-10-16', recurrence: 'weekly', priority: 'high', concerned_manager_id: null })
  const t1 = id(c1, (d) => `/tasks/${d?.id}`)
  const t2 = id(c2, (d) => `/tasks/${d?.id}`)
  const t3 = id(c3, (d) => `/tasks/${d?.id}`)
  for (const who of ['subhankar', 'hritesh', 'priya', 'bijaya', 'jagannath', 'santosh']) {
    await bothSides(L, who, 'GET', t1)
    await bothSides(L, who, 'GET', t3)
  }
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/watch', { watch: false })
  await bothSides(L, 'jagannath', 'POST', (s) => t1(s) + '/watch', {})
  await bothSides(L, 'priya', 'POST', (s) => t1(s) + '/watch', { watch: false })
  await both(L, 'priya', 'POST', '/tasks/t_hrms_5/watch', {})
  await both(L, 'santosh', 'POST', '/tasks/t_hrms_5/watch', {})
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/criteria', { index: 7, done: true })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/criteria', { index: '1', done: true })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/criteria', { index: 1.5, done: true })
  await bothSides(L, 'jagannath', 'POST', (s) => t1(s) + '/criteria', { index: 0, done: true })
  await bothSides(L, 'subhankar', 'POST', (s) => t1(s) + '/criteria', { index: 0, done: 'yes' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_1/criteria', { index: 0, done: true })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/attachments', { name: '' })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/attachments', { name: 'big.pdf', size: 800000 })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/attachments', { name: 'x.pdf', size: -1 })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/attachments', { name: 'x.pdf', size: 10, data_url: 'data:application/pdf,abc' })
  await bothSides(L, 'pragyasmita', 'POST', (s) => t1(s) + '/attachments', { name: 'x.pdf', size: 10 })
  await bothSides(L, 'hritesh', 'DELETE', (s) => t1(s) + '/attachments/att_nope')
  await both(L, 'pragyasmita', 'DELETE', '/tasks/t_hrms_5/attachments/att_nope')
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/comments', { body: '   ' })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/comments', { body: 'x'.repeat(4001) })
  await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/comments', { body: 'hi', parent_id: 'nope' })
  const cm = await bothSides(L, 'hritesh', 'POST', (s) => t1(s) + '/comments', { body: ' @Bijaya can you check the totals? '.repeat(4), mentions: ['u_bijaya', 'u_bijaya', 'u_ankit', 'u_hritesh', 7, { a: 1 }] })
  await bothBodies(L, 'bijaya', 'POST', (s) => t1(s) + '/comments', (s) => ({ body: 'Looks good', parent_id: cm ? ((cm[s] as Res).data as { id?: string })?.id : 'x' }))
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/comments', { body: 'Payslip PDF fonts fixed 🎉', mentions: ['u_subhankar'] })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/comments', { body: 'reply', parent_id: 'x' })
  await both(L, 'baishali', 'POST', '/tasks/t_hrms_5/comments', { body: 'can I?' })
  for (const who of ['subhankar', 'bijaya', 'hritesh']) {
    await bothSides(L, who, 'GET', (s) => t1(s) + '/comments')
    await both(L, who, 'GET', '/tasks/mentions')
  }

  /* ---------- taskflow.ts writes ---------- */
  L = 'ra-flow'
  await both(L, 'jagannath', 'POST', '/tasks/t_hrms_5/submit', { note: 'Done with it' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/submit', { note: 'ok' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/submit', { note: 'Payroll UI ready', proof_url: 'ftp://x' })
  await both(L, 'jayashree', 'POST', '/tasks/t_hrms_7/submit', { note: 'Workflow is done now' })
  await both(L, 'hritesh', 'POST', '/tasks/t_gen_seereon_laptop/submit', { note: 'Laptop reimaged' })
  await both(L, 'hritesh', 'POST', '/tasks/t_gen_seereon_laptop/submit', { note: 'Laptop reimaged', delay_reason_code: 'nope', delay_reason: 'Waited for the licence key from IT' })
  await both(L, 'hritesh', 'POST', '/tasks/t_gen_seereon_laptop/submit', { note: 'Laptop reimaged', delay_reason_code: 'dependency', delay_reason: 'short' })
  await both(L, 'hritesh', 'POST', '/tasks/t_gen_seereon_laptop/submit', { note: 'Laptop reimaged', delay_reason_code: 'dependency', delay_reason: 'Waited for the licence key from IT' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/submit', { note: 'Payroll UI ready for review', proof_url: 'https://example.com/pr/12' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/submit', { note: 'Again please' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_1/submit', { note: 'Again please' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/approve', { quality_rating: 5 })
  await both(L, 'priya', 'POST', '/tasks/t_gen_seereon_iso/approve', { quality_rating: 5 })
  await both(L, 'santosh', 'POST', '/tasks/t_gen_seereon_iso/approve', { quality_rating: 0 })
  await both(L, 'santosh', 'POST', '/tasks/t_gen_seereon_iso/approve', { quality_rating: '4', note: 'Thorough evidence pack' })
  await both(L, 'santosh', 'POST', '/tasks/t_gen_seereon_iso/approve', { quality_rating: 4 })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_6/approve', { quality_rating: 3 })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/approve', { quality_rating: 4, note: 'x'.repeat(1001) })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/send-back', { reason: 'fix it' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/send-back', { reason: 'Payslip totals are off by one rupee', new_due_on: '2026-13-01' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/send-back', { reason: 'Payslip totals are off by one rupee', new_due_on: '2026-10-01' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/send-back', { reason: 'Payslip totals are off by one rupee — the rounding rule applies per component, not per payslip. Please also check arrears.', new_due_on: '2026-10-31' })
  await both(L, 'subhankar', 'POST', '/tasks/t_mgs_7/send-back', { reason: 'Receipt numbering restarts per campus', new_due_on: '2026-10-14' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_5/submit', { note: 'Fixed the rounding' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_5/approve', { quality_rating: 4, note: 'Good' })
  await both(L, 'santosh', 'POST', '/tasks/t_gen_seereon_casestudy/approve', { quality_rating: 5 })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'nope' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'in_development', progress: 150 })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'in_development', progress: 20, note: 'Started the RAG index' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'blocked' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'on_hold', note: 'wait' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'waiting_feedback', note: 'Client legal on policy sources' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/stage', { stage: 'completed' })
  await both(L, 'jagannath', 'POST', '/tasks/t_hrms_8/stage', { stage: 'in_development' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_10/stage', { stage: 'completed' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_10/stage', { stage: 'completed', quality_rating: 3 })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_10/stage', { stage: 'in_development' })
  await both(L, 'priya', 'POST', '/tasks/t_hrms_10/stage', { stage: 'in_development' })
  await both(L, 'jagannath', 'POST', '/tasks/t_crm_2/progress', { progress: 'abc' })
  await both(L, 'jagannath', 'POST', '/tasks/t_crm_2/progress', { progress: 100 })
  await both(L, 'jagannath', 'POST', '/tasks/t_crm_2/progress', { progress: 55, note: 'Reports half done' })
  await both(L, 'jagannath', 'POST', '/tasks/t_crm_2/progress', { progress: 60 })
  await both(L, 'jayashree', 'POST', '/tasks/t_crm_3/progress', { progress: 40 })
  await both(L, 'jagannath', 'POST', '/tasks/t_hrms_8/progress', { progress: 10 })
  await both(L, 'bijaya', 'POST', '/tasks/t_hrms_3/progress', { progress: 10 })
  await both(L, 'pragyasmita', 'POST', '/tasks/t_hrms_9/progress', { progress: 5 })
  await both(L, 'jayashree', 'POST', '/tasks/t_crm_3/flag-slip', { note: 'late' })
  await both(L, 'jayashree', 'POST', '/tasks/t_crm_3/flag-slip', { note: 'Charts library upgrade broke the layout', new_due_on: 'soon' })
  await both(L, 'jayashree', 'POST', '/tasks/t_crm_3/flag-slip', { note: 'Charts library upgrade broke the layout', new_due_on: '2026-11-01' })
  await both(L, 'jayashree', 'POST', '/tasks/t_crm_3/flag-slip', { note: 'Still on track after all, just flagging' })
  await both(L, 'hritesh', 'POST', '/tasks/t_crm_3/flag-slip', { note: 'Charts library upgrade broke the layout' })
  await both(L, 'jayashree', 'POST', '/tasks/t_mgs_4/flag-slip', { note: 'Charts library upgrade broke the layout' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_9/cancel', { reason: 'Client dropped it' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_9/cancel', { reason: 'no' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_9/cancel', { reason: 'Client dropped shift rosters from scope' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_9/cancel', { reason: 'Client dropped shift rosters from scope' })
  await both(L, 'subhankar', 'POST', '/tasks/t_dms_3/cancel', { reason: 'Phase 2 shelved by the client' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_nope', title: 'X' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_ankit', title: 'Return laptop' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'ab', due_on: '2026-10-20', est_hours: 2 })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_baishali', title: 'Prepare a deck', due_on: '2026-10-20', est_hours: 2 })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', project_id: 'p_samet', due_on: '2026-10-20', est_hours: 2 })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-10', est_hours: 2 })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-20', est_hours: 300 })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-20', est_hours: 2, milestone_id: 'ms_hrms_2' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-20', est_hours: 2, reviewer_id: 'u_hritesh' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-24', est_hours: 13, priority: 'urgent', tag: 'documentation' })
  await both(L, 'subhankar', 'POST', '/team-tasks', { owner_id: 'u_jagannath', title: 'CRM report polish', project_id: 'p_crm', milestone_id: 'ms_crm_2', due_on: '2026-11-20', start_on: '2026-11-16', est_hours: 41, complexity: 'nope' })
  await both(L, 'santosh', 'POST', '/team-tasks', { owner_id: 'u_santosh', title: 'Board pack for Q3', due_on: '2026-10-22', est_hours: 3 })
  for (const who of ['subhankar', 'santosh', 'hritesh', 'jagannath']) {
    await both(L, who, 'GET', '/team-tasks')
    await both(L, who, 'GET', '/team-tasks/review-queue')
    await both(L, who, 'GET', '/analytics/tasks')
    await both(L, who, 'GET', '/my-tasks')
    await both(L, who, 'GET', '/notifications')
  }
  for (const t of ['t_hrms_5', 't_hrms_6', 't_gen_seereon_iso', 't_gen_seereon_laptop', 't_hrms_9', 't_crm_3', 't_mgs_7']) {
    await both(L, 'santosh', 'GET', `/tasks/${t}`)
    await both(L, 'santosh', 'GET', `/tasks/${t}/reviews`)
  }

  /* ---------- projects.ts writes ---------- */
  L = 'ra-proj'
  const pgood = { name: 'Plant maintenance app', client: 'Kalinga Steel', type: 'service', billing_model: 'fixed', stream: 'services', start_on: '2026-11-02', end_on: '2027-03-31', contract_value_paise: 4000000 }
  const pbad: [string, Record<string, unknown>][] = [
    ['hritesh', pgood], ['santosh', { ...pgood, name: ' ' }], ['santosh', { ...pgood, client: undefined }], ['santosh', { ...pgood, type: 'retainer' }], ['santosh', { ...pgood, billing_model: 'x' }],
    ['santosh', { ...pgood, stream: 'x' }], ['santosh', { ...pgood, start_on: 'bad' }], ['santosh', { ...pgood, end_on: '2026-10-01' }], ['santosh', { ...pgood, contract_value_paise: -1 }],
    ['santosh', { ...pgood, contract_value_paise: 1.5 }], ['santosh', { ...pgood, pm_id: 'u_hritesh' }], ['santosh', { ...pgood, pm_id: 'u_ankit' }], ['subhankar', { ...pgood, pm_id: 'u_santosh' }],
    ['santosh', { ...pgood, milestones: [{ name: 'Build' }, { name: ' build ' }] }], ['santosh', { ...pgood, milestones: [{ name: 'Build', billing_amount_paise: -5 }] }],
    ['santosh', { ...pgood, milestones: [{ name: 'A', planned_end: '2026-12-01' }, { name: 'B', planned_end: '2026-11-15' }] }],
    ['santosh', { ...pgood, costing: { resources: [{ user_id: 'u_hritesh', milestone_index: 0, pct: 50 }] } }],
  ]
  for (const [who, b] of pbad) await both(L, who, 'POST', '/projects', b)
  const pc1 = await both(L, 'santosh', 'POST', '/projects', { ...pgood, pm_id: 'u_subhankar', priority: '2', description: ' Mobile app ', milestones: [{ name: 'Design', billing_amount_paise: 1000000 }, { name: 'Build', billing_amount_paise: 2000000 }, { name: '' }, null] })
  const pc2 = await both(L, 'subhankar', 'POST', '/projects', { ...pgood, name: 'Vendor portal', contract_value_paise: 0, milestones: [{ name: 'Phase 1', planned_end: '2026-12-15', billing_amount_paise: 300000 }, { name: 'Phase 2', planned_end: '2027-03-31' }] })
  await both(L, 'santosh', 'POST', '/projects', { ...pgood, name: 'Billing check', milestones: [{ name: 'One', billing_amount_paise: 9000000 }] })
  await both(L, 'santosh', 'POST', '/projects', { ...pgood, name: 'Costed', pm_id: 'u_subhankar', milestones: [{ name: 'Design' }, { name: 'Build' }], costing: { resources: [{ user_id: 'u_hritesh', milestone_index: 0, pct: 50 }, { user_id: 'u_bijaya', milestone_index: 1, pct: 100 }], markup_pct: 25 } })
  const P1 = id(pc1, (d) => `/projects/${d?.id}`)
  const P2 = id(pc2, (d) => `/projects/${d?.id}`)
  for (const who of ['santosh', 'subhankar', 'hritesh']) {
    await bothSides(L, who, 'GET', P1)
    await bothSides(L, who, 'GET', (s) => P1(s) + '/schedule')
  }
  await both(L, 'santosh', 'GET', '/projects')
  /* patch / status */
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { status: 'closed' })
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { name: '' })
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { type: 'x' })
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { start_on: '2027-01-01' })
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { pm_id: 'u_santosh' })
  await both(L, 'hritesh', 'PATCH', '/projects/p_crm', { name: 'X' })
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { name: 'X' }, undefined, 1)
  await both(L, 'subhankar', 'PATCH', '/projects/p_crm', { name: ' Sales CRM Phase 2b ', client: 'Digitalratha', priority: 9, description: null, end_on: '2026-12-20', billing_model: 'tm', stream: 'services', contract_value_paise: 100000 })
  await both(L, 'santosh', 'PATCH', '/projects/p_crm', { pm_id: 'u_hritesh' })
  await both(L, 'santosh', 'PATCH', '/projects/p_crm', { pm_id: 'u_subhankar', contract_value_paise: 50000 })
  await bothSides(L, 'santosh', 'PATCH', P1, { pm_id: 'u_santosh' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/status', { status: 'nope' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/status', { status: 'active' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/status', { status: 'on_hold' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/status', { status: 'on_hold', reason: 'Client paused for budget review' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/status', { status: 'active', reason: '' })
  await both(L, 'subhankar', 'GET', '/projects/p_crm/activity')
  /* milestones */
  await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: '' })
  await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: 'x'.repeat(121) })
  await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: 'Hypercare', billing_amount_paise: 2000000 })
  const pm3 = await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: 'Extra', planned_start: '2026-10-01', planned_end: '2027-05-01', billing_amount_paise: 0 })
  await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: 'Bad', planned_start: '2026-12-01', planned_end: '2026-11-01' })
  await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/milestones', { name: 'Bad', billing_amount_paise: 'x' })
  await both(L, 'hritesh', 'POST', '/projects/p_hrms/milestones', { name: 'Nope' })
  const M3 = id(pm3, (d) => `/milestones/${d?.id}`)
  await both(L, 'subhankar', 'PATCH', '/milestones/ms_hrms_3', { planned_end: '2026-12-31' })
  await both(L, 'subhankar', 'PATCH', '/milestones/ms_hrms_3', { planned_start: '2026-09-01' })
  await both(L, 'subhankar', 'PATCH', '/milestones/ms_mgs_2', { billing_amount_paise: 1 })
  await both(L, 'subhankar', 'PATCH', '/milestones/ms_hrms_3', { name: 'Statutory, shifts & attendance', planned_end: '2026-11-29' })
  await bothSides(L, 'santosh', 'PATCH', M3, { planned_start: '2027-01-01', planned_end: '2027-06-30', billing_amount_paise: 100 })
  await bothSides(L, 'santosh', 'PATCH', M3, { planned_end: '2026-09-01' })
  await bothSides(L, 'santosh', 'PATCH', M3, { name: 'X' }, undefined)
  await both(L, 'subhankar', 'DELETE', '/milestones/ms_mgs_2')
  await both(L, 'hritesh', 'DELETE', '/milestones/ms_crm_2')
  await bothSides(L, 'santosh', 'DELETE', M3)
  await bothSides(L, 'santosh', 'DELETE', M3)
  await both(L, 'subhankar', 'DELETE', '/milestones/ms_crm_2')
  await both(L, 'subhankar', 'GET', '/projects/p_crm')
  /* project tasks */
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: '' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', milestone_id: 'ms_crm_1' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', start_on: '2026-02-31' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', est_hours: 1000 })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', complexity: 'x' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', tag: 'x' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', owner_id: 'u_hritesh', backup_id: 'u_hritesh' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Task', owner_id: 'u_ankit' })
  await both(L, 'hritesh', 'POST', '/projects/p_hrms/tasks', { title: 'Task' })
  const pt1 = await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: ' Biometric device driver ', milestone_id: 'ms_hrms_3', owner_id: 'u_pragyasmita', backup_id: 'u_jagannath', est_hours: 12, complexity: 'high', tag: 'bug', description: ' Drivers ' })
  const pt2 = await both(L, 'subhankar', 'POST', '/projects/p_hrms/tasks', { title: 'Loose task', est_hours: null })
  const pt3 = await bothSides(L, 'santosh', 'POST', (s) => P1(s) + '/tasks', { title: 'Wireframes', owner_id: 'u_hritesh' })
  const T1 = id(pt1, (d) => `/tasks/${d?.id}`)
  const T2 = id(pt2, (d) => `/tasks/${d?.id}`)
  const T3 = id(pt3, (d) => `/tasks/${d?.id}`)
  await bothSides(L, 'subhankar', 'PATCH', T1, { status: 'done' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { priority: 'P1' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { reviewer_id: 'u_pragyasmita' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { concerned_manager_id: 'u_pragyasmita' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { watcher_ids: 'u_priya' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { acceptance_criteria: ['a'.repeat(301)] })
  await bothSides(L, 'subhankar', 'PATCH', T1, { labels: 'x' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { billable: 'yes' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { recurrence: 'daily' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { title: '' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { backup_id: 'u_pragyasmita' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { est_hours: -1 })
  await bothSides(L, 'subhankar', 'PATCH', T1, { due_on: '2026-12-01' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { due_on: '2026-10-01', due_change_reason: 'Moved up for client demo' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { complexity: 'x' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { tag: 'x' })
  await bothSides(L, 'subhankar', 'PATCH', T1, { milestone_id: 'ms_crm_1' })
  await bothSides(L, 'hritesh', 'PATCH', T1, { title: 'mine' })
  await bothSides(L, 'subhankar', 'PATCH', T1, {
    priority: 'high', reviewer_id: 'u_santosh', concerned_manager_id: 'u_priya', watcher_ids: ['u_hritesh', 'u_hritesh', 'u_priya'], acceptance_criteria: ['Works on ZK devices', { text: ' Logs punches ', done: true }, ''],
    labels: [' hw ', 'hw', 'drivers'], billable: false, recurrence: 'monthly', title: ' Biometric device driver v2 ', description: null, owner_id: 'u_jagannath', backup_id: 'u_pragyasmita', est_hours: 12.3,
    start_on: '2026-10-20', due_on: '2026-11-20', due_change_reason: 'Device shipment delayed by vendor', complexity: 'very_high', tag: '', milestone_id: 'ms_hrms_4',
  })
  await bothSides(L, 'subhankar', 'PATCH', T1, { milestone_id: null, due_on: '2026-11-25', due_change_reason: 'Another week for the vendor' })
  await bothSides(L, 'subhankar', 'GET', T1)
  await bothSides(L, 'subhankar', 'PATCH', T2, { milestone_id: 'ms_hrms_5', owner_id: 'u_bijaya' })
  await bothSides(L, 'santosh', 'PATCH', T3, { title: 'Wireframes v2' })
  await both(L, 'subhankar', 'PATCH', '/tasks/t_hrms_1', { due_on: '2026-12-01', due_change_reason: 'Reopened for a change' })
  await both(L, 'subhankar', 'PATCH', '/tasks/t_gen_seereon_laptop', { title: 'Laptop reimaging (new joiner)' })
  await both(L, 'hritesh', 'PATCH', '/tasks/t_gen_seereon_laptop', { title: 'Laptop' })
  /* status */
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/status', { status: 'in_progress' })
  await both(L, 'baishali', 'POST', '/tasks/t_hrms_10/status', { status: 'in_progress' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/status', { status: 'nope' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/status', { status: 'in_review' })
  await both(L, 'hritesh', 'POST', '/tasks/t_hrms_10/status', { status: 'done' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_3/status', { status: 'done' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_2/status', { status: 'done' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_2/status', { status: 'done', quality_rating: 4, note: ' Solid ' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_2/status', { status: 'todo' })
  await both(L, 'jagannath', 'POST', '/tasks/t_crm_2/status', { status: 'blocked', blocked_reason: 'DB' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_3/status', { status: 'blocked', blocked_reason: 'Waiting on the CRM API keys' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_3/status', { status: 'todo' })
  await both(L, 'subhankar', 'POST', '/tasks/t_crm_3/status', { status: 'in_progress' })
  await both(L, 'subhankar', 'POST', '/tasks/t_hrms_6/status', { status: 'todo' })
  await both(L, 'santosh', 'POST', '/tasks/t_gen_seereon_bni/status', { status: 'done', quality_rating: 5 })
  await both(L, 'santosh', 'GET', '/tasks', undefined, { project: 'p_general_seereon', status: 'all' })
  /* dependencies */
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_4/dependencies', { depends_on: ['t_crm_4'] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_4/dependencies', { depends_on: ['t_hrms_1'] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_2/dependencies', { depends_on: ['t_crm_5'] })
  await both(L, 'hritesh', 'PUT', '/tasks/t_crm_4/dependencies', { depends_on: [] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_4/dependencies', { depends_on: ['t_crm_3', 't_crm_2', 't_crm_3'] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_3/dependencies', { depends_on: [] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_3/dependencies', { depends_on: ['t_crm_1'] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_hrms_5/dependencies', { depends_on: ['t_hrms_10'] })
  await both(L, 'subhankar', 'PUT', '/tasks/t_crm_5/dependencies', {})
  /* delete */
  await both(L, 'subhankar', 'DELETE', '/tasks/t_hrms_4')
  await both(L, 'hritesh', 'DELETE', '/tasks/t_hrms_10')
  await bothSides(L, 'subhankar', 'DELETE', T2)
  await bothSides(L, 'subhankar', 'DELETE', T2)
  await both(L, 'subhankar', 'DELETE', '/tasks/t_crm_5', undefined, undefined, 99)
  await both(L, 'subhankar', 'DELETE', '/tasks/t_crm_5')
  await both(L, 'subhankar', 'GET', '/projects/p_crm')
  /* allocations */
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', {})
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_ankit' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_crm_1' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 0 })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 50, from_on: 'x' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 50, from_on: '2026-11-10', to_on: '2026-11-01' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 50, from_on: '2020-11-10', to_on: '2026-11-11' })
  const al = await both(L, 'subhankar', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 80.4, from_on: '2026-11-02', to_on: '2026-11-20' })
  await both(L, 'hritesh', 'POST', '/projects/p_hrms/allocations', { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 10, from_on: '2026-11-02', to_on: '2026-11-20' })
  const A1 = id(al, (d) => `/allocations/${d?.id}`)
  await bothSides(L, 'subhankar', 'PATCH', A1, { pct: 30 })
  await bothSides(L, 'subhankar', 'PATCH', A1, { pct: 150 })
  await bothSides(L, 'subhankar', 'PATCH', A1, { to_on: '2026-11-27' })
  await both(L, 'subhankar', 'GET', '/projects/p_hrms/load')
  await bothSides(L, 'hritesh', 'DELETE', A1)
  await bothSides(L, 'subhankar', 'DELETE', A1)
  await both(L, 'subhankar', 'DELETE', '/allocations/nope')
  /* money / invoices */
  await both(L, 'santosh', 'GET', '/projects/p_hrms/money')
  await both(L, 'hritesh', 'POST', '/milestones/ms_hrms_2/invoice', {})
  await both(L, 'santosh', 'POST', '/milestones/ms_mgs_2/invoice', { number: 'X' })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: '' })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'sci/26-27/0006', invoiced_on: '2026-10-15', amount_paise: 100 })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0100', invoiced_on: '2026-12-15', amount_paise: 100 })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0100', invoiced_on: '2026-10-15', due_on: '2026-10-01', amount_paise: 100 })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0100', invoiced_on: '2026-10-15', amount_paise: 0 })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0100', invoiced_on: '2026-10-15', amount_paise: 100, file: { name: 'a.pdf' } })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0100', invoiced_on: '2026-10-15', amount_paise: 100, file: { name: 'a.pdf', data_url: 'data:application/pdf;base64,JVBERi0=', size_bytes: 20000000 } })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { invoiced_on: '2026-10-14', amount_paise: 2500000, number: ' SCI/26-27/0100 ', file: { name: 'inv.pdf', mime: 'application/pdf', size_bytes: 9, data_url: 'data:application/pdf;base64,JVBERi0=' } })
  await both(L, 'santosh', 'POST', '/milestones/ms_hrms_2/invoice', { number: 'SCI/26-27/0101', invoiced_on: '2026-10-15', amount_paise: 100 })
  await both(L, 'hritesh', 'POST', '/invoices/inv_ms_dms_1/payments', { amount_paise: 100, paid_on: '2026-10-15' })
  await both(L, 'santosh', 'POST', '/invoices/inv_ms_dms_1/payments', { amount_paise: 0, paid_on: '2026-10-15' })
  await both(L, 'santosh', 'POST', '/invoices/inv_ms_dms_1/payments', { amount_paise: 100, paid_on: '2020-10-15' })
  await both(L, 'santosh', 'POST', '/invoices/inv_ms_dms_1/payments', { amount_paise: 999999999, paid_on: '2026-10-15' })
  await both(L, 'santosh', 'POST', '/invoices/inv_ms_dms_1/payments', { amount_paise: 1000000, paid_on: '2026-10-15', reference: ' UTR123 ' })
  await both(L, 'santosh', 'POST', '/invoices/inv_ms_hrms_1/payments', { amount_paise: 1000, paid_on: '2026-10-15' })
  await both(L, 'santosh', 'GET', '/projects/p_hrms/money')
  await both(L, 'santosh', 'GET', '/projects/p_dms/money')
  /* change requests */
  await both(L, 'hritesh', 'POST', '/projects/p_hrms/change-requests', { title: 'X' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: '' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Gratuity module' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Gratuity module', requested_by_client: 'HR head', requested_on: '2099-01-01' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Gratuity module', requested_by_client: 'HR head', impact_days: 1.5 })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Gratuity module', requested_by_client: 'HR head', proposed_tasks: 'x' })
  await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Gratuity module', requested_by_client: 'HR head', proposed_tasks: [{ title: 'Calc', est_hours: 1000 }] })
  const cr1 = await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: ' Gratuity module ', requested_by_client: ' HR head ', value_paise: 500000, impact_days: 3, proposed_tasks: [{ title: 'Gratuity calc', est_hours: 10.1, owner_id: 'u_hritesh' }, { title: '  ' }, { title: 'Report', est_hours: '6' }] })
  const cr2 = await both(L, 'subhankar', 'POST', '/projects/p_hrms/change-requests', { title: 'Loans module', requested_by_client: 'Finance', note: ' later ' })
  const CR1 = id(cr1, (d) => `/change-requests/${d?.id}`)
  const CR2 = id(cr2, (d) => `/change-requests/${d?.id}`)
  await bothSides(L, 'subhankar', 'PATCH', CR2, { status: 'estimated' })
  await bothSides(L, 'subhankar', 'PATCH', CR2, { status: 'done' })
  await bothSides(L, 'subhankar', 'PATCH', CR2, { hours: 12, description: 'Loans and advances' })
  await bothSides(L, 'subhankar', 'PATCH', CR2, { title: 'Loans & advances' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR2(s) + '/decision', { decision: 'maybe' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR2(s) + '/decision', { decision: 'reject', reason: 'no' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR2(s) + '/decision', { decision: 'reject', reason: 'Out of budget this year' })
  await bothSides(L, 'subhankar', 'PATCH', CR2, { title: 'Again' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR2(s) + '/decision', { decision: 'approve' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', {})
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/decision', { decision: 'approve', milestone: { name: 'Gratuity', planned_end: '2027-01-15' } })
  await bothSides(L, 'subhankar', 'PATCH', CR1, { status: 'done' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', { start_on: '2026-10-01' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', { tasks: [] })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', { milestone_id: 'ms_crm_1' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', { start_on: '2026-10-17' })
  await bothSides(L, 'subhankar', 'POST', (s) => CR1(s) + '/add-tasks', {})
  await both(L, 'subhankar', 'POST', '/change-requests/r_013p/decision', { decision: 'approve', add_to_contract: false })
  await both(L, 'subhankar', 'POST', '/change-requests/r_013p/add-tasks', { milestone_id: 'new', tasks: [{ title: 'Big task', est_hours: 100 }] })
  await both(L, 'subhankar', 'POST', '/change-requests/r_013r/decision', { decision: 'approve' })
  await both(L, 'subhankar', 'PATCH', '/change-requests/r_013r', { proposed_tasks: [{ title: 'Pipeline view', est_hours: 8 }] })
  await both(L, 'subhankar', 'PATCH', '/change-requests/cr_mgs_2', { hours: 0 }, undefined, 99)
  for (const who of ['subhankar', 'santosh', 'hritesh']) {
    await both(L, who, 'GET', '/projects/p_hrms/change-requests')
    await both(L, who, 'GET', '/projects/p_hrms')
    await both(L, who, 'GET', '/projects/p_hrms/client-view')
    await both(L, who, 'GET', '/projects/p_hrms/activity')
  }
  /* WBS import */
  const head = 'Milestone,Task,Owner,Estimated hours,Start,End,Complexity,Depends on,Milestone billing (₹)\n'
  await both(L, 'subhankar', 'POST', '/projects/p_crm/import', { text: 'just one line' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/import', { text: 'Milestone,Task\nA,B' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/import', {
    text: head + ',,,,,,,,\nBuild,,Nobody,abc,2026-13-01,31/02/2026,huge,9.9;x;1.1,\nNew phase,"Quoted, task",hritesh@seereon.co.in,8,2026-11-02,02/11/2026,Very high,2.1,"₹1,50,000"\nNew phase,Loop,Hritesh Panda,4,3 Nov 2026,4-Nov-2026,med,2.2,abc\nNew phase,Loop2,Hritesh Panda,4,2026-11-05,2026-11-04,,2.1 2.2,',
  })
  const prev = await both(L, 'subhankar', 'POST', '/projects/p_crm/import', {
    text: '﻿' + head + 'Build,Report exports,Jagannath Nayak,6,2026-10-20,2026-10-22,High,1.2,\nPhase 3,Mobile view,jayashree@seereon.co.in,8,2026-11-25,27/11/2026,low,,"2,00,000"\nPhase 3,Push alerts,Bijaya Jena,5,26 Nov 2026,30 Nov 2026,,3.1;1.2,\n',
  })
  await bothBodies(L, 'hritesh', 'POST', '/projects/p_crm/import', (s) => ({ token: ((prev[s] as Res).data as { token?: string })?.token }), { mode: 'commit' })
  await both(L, 'subhankar', 'POST', '/projects/p_crm/import', { token: 'nope' }, { mode: 'commit' })
  await bothBodies(L, 'subhankar', 'POST', '/projects/p_crm/import', (s) => ({ token: ((prev[s] as Res).data as { token?: string })?.token }), { mode: 'commit' })
  await bothBodies(L, 'subhankar', 'POST', '/projects/p_crm/import', (s) => ({ token: ((prev[s] as Res).data as { token?: string })?.token }), { mode: 'commit' })
  const prev2 = await both(L, 'subhankar', 'POST', '/projects/p_crm/import', { text: head + 'Phase 3,Offline mode,Bijaya Jena,5,2026-11-26,2026-11-30,,,\n' })
  await both(L, 'subhankar', 'PATCH', '/tasks/t_crm_1', { title: 'WhatsApp follow-up automation v2' })
  await bothBodies(L, 'subhankar', 'POST', '/projects/p_crm/import', (s) => ({ token: ((prev2[s] as Res).data as { token?: string })?.token }), { mode: 'commit' })
  await both(L, 'subhankar', 'GET', '/projects/p_crm')
  await both(L, 'subhankar', 'GET', '/projects/p_crm/schedule')
  /* openings */
  await both(L, 'hritesh', 'GET', '/openings')
  await both(L, 'hritesh', 'POST', '/openings', { role: 'X', count: 1, owner_id: 'u_hritesh' })
  await both(L, 'subhankar', 'POST', '/openings', { role: '', count: 1, owner_id: 'u_subhankar' })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 0, owner_id: 'u_subhankar' })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 1, status: 'closed', owner_id: 'u_subhankar' })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 1 })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 1, owner_id: 'u_ankit' })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 1, owner_id: 'u_subhankar', project_id: 'p_nope' })
  await both(L, 'subhankar', 'POST', '/openings', { role: 'Dev', count: 1, owner_id: 'u_subhankar', needed_by: '2026-02-30' })
  const op = await both(L, 'subhankar', 'POST', '/openings', { role: ' Python developer ', count: '2', owner_id: 'u_priya', project_id: 'p_hrms', needed_by: '2026-11-30', notes: ' FastAPI ' })
  const OP = id(op, (d) => `/openings/${d?.id}`)
  await bothSides(L, 'subhankar', 'PATCH', OP, { status: 'on_hold' })
  await bothSides(L, 'subhankar', 'PATCH', OP, { count: 51 })
  await both(L, 'subhankar', 'PATCH', '/openings/r_013t', { status: 'filled' })
  await both(L, 'santosh', 'PATCH', '/openings/r_013t', { status: 'interviewing', project_id: '', needed_by: null }, undefined, 1)
  await both(L, 'santosh', 'PATCH', '/openings/r_013t', { status: 'interviewing', project_id: '', needed_by: null })
  await bothSides(L, 'hritesh', 'DELETE', OP)
  await bothSides(L, 'subhankar', 'DELETE', OP)
  await both(L, 'subhankar', 'DELETE', '/openings/r_013u')
  for (const who of ['santosh', 'subhankar', 'priya']) await both(L, who, 'GET', '/openings')
  /* final state */
  for (const who of ['santosh', 'subhankar', 'hritesh', 'jagannath', 'bijaya', 'priya']) {
    await both(L, who, 'GET', '/notifications')
    await both(L, who, 'GET', '/tasks', undefined, { status: 'all' })
    await both(L, who, 'GET', '/my-tasks')
    await both(L, who, 'GET', '/projects')
    await both(L, who, 'GET', '/delivery/risks')
  }
  for (const p of ['p_hrms', 'p_crm', 'p_mgs', 'p_general_seereon']) await both(L, 'santosh', 'GET', `/projects/${p}/activity`)
}

/* ---------------- RD: documents.ts, docsV7.ts, workflowsV7.ts (OpenAPI tags documents, docs, workflows) ---------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RdAny = any
/** same call on both sides with side-specific paths + If-Match */
async function rdSides(label: string, who: string, method: string, path: (side: 'm' | 'h') => string, body?: unknown, query?: Record<string, unknown>, ifMatch?: number) {
  const mp = path('m')
  const hp = path('h')
  if (!inScope(method, mp)) {
    skipped++
    return null
  }
  const [m, h] = [await mockCall(who, method, mp, body, query, ifMatch), await httpCall(who, method, hp, body, query, ifMatch)]
  const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
  const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
  const all = [...d, ...dw]
  if (all.length) {
    fail++
    failures.push(`FAIL ${label} ${method} ${mp}\n   ` + all.join('\n   '))
    console.log(`FAIL ${label} ${method} ${mp}\n   ` + all.join('\n   '))
  } else {
    pass++
    console.log(`PASS ${label} ${method} ${mp} (${m.status})`)
  }
  return { m, h }
}
const rdId = (r: { m: Res; h: Res } | null, f: (d: RdAny) => string | undefined) => (side: 'm' | 'h') => (r ? f((r[side] as Res).data) ?? 'x' : 'x')
/** valid values for a workflow stage form */
function rdFill(fields: RdAny[] | undefined, over: Record<string, unknown> = {}) {
  const v: Record<string, unknown> = {}
  for (const f of fields ?? []) {
    if (f.type === 'rating') v[f.key] = 4
    else if (f.type === 'number' || f.type === 'percent') v[f.key] = Math.min(f.max ?? 100, Math.max(f.min ?? 0, 8))
    else if (f.type === 'money') v[f.key] = Math.max(100000, f.min ?? 0)
    else if (f.type === 'select') v[f.key] = f.options?.[0]
    else if (f.type === 'date') v[f.key] = '2026-11-02'
    else if (f.type === 'checkbox') v[f.key] = true
    else if (f.type === 'file') v[f.key] = { name: 'proof.pdf', size: 1234 }
    else v[f.key] = 'Reviewed carefully: everything here looks complete, correct and well documented.'
  }
  return { ...v, ...over }
}

async function rdScenarios() {
  for (const [who, email] of [
    ['jayashree', 'jayashree@seereon.co.in'], ['subhankar', 'subhankar@seereon.co.in'], ['debasish', 'debasish@seereon.co.in'], ['bijaya', 'bijaya@seereon.co.in'],
    ['subham', 'subham@seereon.co.in'], ['pragyasmita', 'pragyasmita@seereon.co.in'], ['baishali', 'baishali@seereon.co.in'], ['jagannath', 'jagannath@seereon.co.in'],
  ] as const) if (!mockTok[who]) await login(who, email)
  // maker-checker back to the seeded entities (other scenarios may have narrowed it): CTC changes + payroll finalise go to a checker
  const mc = await both('rd-mc', 'santosh', 'PUT', '/maker-checker/config', { enabled: true, entities: ['role', 'user_access', 'cost_rate', 'workflow', 'payroll_finalise', 'vendor', 'org_profile'], sla_days: 2 })
  await rdSides('rd-mc', 'debasish', 'POST', rdId(mc, (d) => (d?.change?.id ? `/changes/${d.change.id}/approve` : '/changes/x/approve')), { note: 'Restore the defaults' })
  await rdDocumentsScenarios()
  await rdDocsScenarios()
  await rdWorkflowScenarios()
  await rdPayslipScenarios()
}

async function rdDocumentsScenarios() {
  const L = 'rd-documents'
  const txt = { name: 'notes.txt', mime: 'text/plain', size_bytes: 5, data_url: 'data:text/plain;base64,aGVsbG8=' }
  for (const who of ['santosh', 'hritesh', 'subhankar', 'bijaya', 'priya']) {
    await both(L, who, 'GET', '/documents')
    await both(L, who, 'GET', '/documents', undefined, { scope: 'company' })
    await both(L, who, 'GET', '/documents/projects')
    await both(L, who, 'GET', '/documents/policy-status')
  }
  await both(L, 'santosh', 'GET', '/documents', undefined, { project_id: 'p_hrms', q: 'payroll' })
  await both(L, 'santosh', 'GET', '/documents', undefined, { scope: 'project', category: 'requirements' })
  await both(L, 'santosh', 'GET', '/documents', undefined, { archived: 'true' })
  await both(L, 'santosh', 'GET', '/documents', undefined, { project_id: 'p_nope' })
  await both(L, 'hritesh', 'GET', '/documents/doc_crm_sow')
  await both(L, 'subhankar', 'GET', '/documents/doc_crm_sow')
  await both(L, 'santosh', 'GET', '/documents/doc_hrms_brd')
  // create: denied, invalid, valid (link + file; company + project)
  await both(L, 'hritesh', 'POST', '/documents', { title: 'My notes', category: 'other', url: 'https://example.com/x' })
  await both(L, 'subhankar', 'POST', '/documents', { project_id: 'p_rcu', title: 'RCU notes', category: 'other', url: 'https://example.com/x' })
  await both(L, 'santosh', 'POST', '/documents', { project_id: 'p_nope', title: 'X notes', category: 'other' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'ab', category: 'other' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'nope' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', visibility: 'world' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', url: 'https://example.com/a', file: txt })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', url: 'ftp://example' })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', file: { ...txt, name: 'run.exe' } })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', file: { ...txt, size_bytes: 0 } })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', file: { ...txt, data_url: 'nope' } })
  await both(L, 'santosh', 'POST', '/documents', { title: 'Valid title', category: 'policy', url: 'https://example.com/a', effective_on: '1 May' })
  const c1 = await both(L, 'santosh', 'POST', '/documents', {
    title: 'Travel policy 2026', category: 'policy', visibility: 'company', must_read: true, tags: [' Travel ', 'travel', 'HR', 7],
    url: 'https://Policies.Example.com/travel/2026/../v2/Plan%20A?x=1#top', effective_on: '2026-11-01', note: '', description: '  Business travel rules.  ',
  })
  const c2 = await both(L, 'subhankar', 'POST', '/documents', { project_id: 'p_hrms', title: 'Sprint notes', category: 'meeting_notes', visibility: 'project', file: txt, tags: ['sprint'] })
  const c3 = await both(L, 'santosh', 'POST', '/documents', { project_id: 'p_crm', title: 'Pricing sheet', category: 'contract', visibility: 'managers', must_read: true, url: 'https://drive.example.com/pricing' })
  const c4 = await both(L, 'priya', 'POST', '/documents', { title: 'Mgmt-only memo', category: 'process', visibility: 'project', url: 'http://intranet.example.com' })
  for (const who of ['santosh', 'hritesh', 'subhankar', 'bijaya']) {
    await rdSides(L, who, 'GET', rdId(c1, (d) => `/documents/${d?.id}`))
    await rdSides(L, who, 'GET', rdId(c3, (d) => `/documents/${d?.id}`))
    await rdSides(L, who, 'GET', rdId(c4, (d) => `/documents/${d?.id}`))
  }
  // versions / patch / archive / restore
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/versions`), { note: 'tiny', file: txt })
  await rdSides(L, 'hritesh', 'POST', rdId(c2, (d) => `/documents/${d?.id}/versions`), { note: 'Updated after review', file: txt })
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/versions`), { note: 'Updated after the sprint review', url: 'https://example.com/sprint-2' })
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/versions`), { note: 'Updated after the sprint review' })
  await rdSides(L, 'santosh', 'POST', rdId(c1, (d) => `/documents/${d?.id}/versions`), { note: 'New per-diem limits', url: 'https://policies.example.com/travel/v3' })
  await rdSides(L, 'subhankar', 'PATCH', rdId(c2, (d) => `/documents/${d?.id}`), { title: 'Sprint review notes', must_read: true, tags: ['sprint', 'review'], effective_on: '2026-01-01' })
  await rdSides(L, 'subhankar', 'PATCH', rdId(c2, (d) => `/documents/${d?.id}`), { title: 'x' })
  await rdSides(L, 'subhankar', 'PATCH', rdId(c2, (d) => `/documents/${d?.id}`), { category: 'design' }, undefined, 1)
  await rdSides(L, 'hritesh', 'PATCH', rdId(c2, (d) => `/documents/${d?.id}`), { title: 'Hijack' })
  await rdSides(L, 'santosh', 'PATCH', rdId(c1, (d) => `/documents/${d?.id}`), { visibility: 'managers', effective_on: '', description: null })
  await rdSides(L, 'bijaya', 'POST', rdId(c3, (d) => `/documents/${d?.id}/archive`))
  await rdSides(L, 'hritesh', 'POST', rdId(c2, (d) => `/documents/${d?.id}/archive`))
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/archive`))
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/archive`))
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/versions`), { note: 'After archive upload', url: 'https://example.com/z' })
  await rdSides(L, 'hritesh', 'GET', rdId(c2, (d) => `/documents/${d?.id}`))
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/ack`))
  await rdSides(L, 'subhankar', 'POST', rdId(c2, (d) => `/documents/${d?.id}/restore`))
  // acks / views / downloads
  await both(L, 'hritesh', 'POST', '/documents/doc_co_handbook/ack')
  await both(L, 'hritesh', 'POST', '/documents/doc_co_handbook/ack')
  await both(L, 'hritesh', 'POST', '/documents/doc_crm_sow/ack')
  await rdSides(L, 'hritesh', 'POST', rdId(c2, (d) => `/documents/${d?.id}/ack`))
  await both(L, 'hritesh', 'POST', '/documents/doc_hrms_brd/view')
  await both(L, 'hritesh', 'GET', '/documents/doc_hrms_brd/download')
  await both(L, 'hritesh', 'GET', '/documents/doc_hrms_brd/download', undefined, { version: 1, preview: 1 })
  await both(L, 'hritesh', 'GET', '/documents/doc_hrms_brd/download', undefined, { version: 'abc' })
  await both(L, 'hritesh', 'GET', '/documents/doc_hrms_brd/download', undefined, { version: 9 })
  await rdSides(L, 'subhankar', 'GET', rdId(c2, (d) => `/documents/${d?.id}/download`), undefined, { version: 1 })
  for (const who of ['santosh', 'hritesh', 'subhankar']) {
    await both(L, who, 'GET', '/documents')
    await both(L, who, 'GET', '/documents', undefined, { project_id: 'p_hrms' })
    await both(L, who, 'GET', '/documents/projects')
    await both(L, who, 'GET', '/documents/policy-status')
    await rdSides(L, who, 'GET', rdId(c2, (d) => `/documents/${d?.id}`))
    await both(L, who, 'GET', '/notifications')
  }
  await both(L, 'santosh', 'GET', '/search', undefined, { q: 'travel' })
  await both(L, 'hritesh', 'GET', '/search', undefined, { q: 'sprint' })
}

async function rdDocsScenarios() {
  const L = 'rd-docs'
  for (const who of ['priya', 'hritesh', 'santosh']) {
    await both(L, who, 'GET', '/doc-templates')
    await both(L, who, 'GET', '/doc-templates/r_02ps')
    await both(L, who, 'GET', '/doc-templates/sample/u_hritesh')
    await both(L, who, 'GET', '/doc-templates/suggest/u_hritesh')
    await both(L, who, 'GET', '/doc-templates/suggest/u_jayashree')
    await both(L, who, 'GET', '/employee-docs/people')
    await both(L, who, 'GET', '/employee-docs/person/me')
    await both(L, who, 'GET', '/employee-docs/person/u_bijaya')
    await both(L, who, 'GET', '/issued-docs', undefined, { mine: 1 })
    await both(L, who, 'GET', '/issued-docs')
  }
  await both(L, 'priya', 'GET', '/doc-templates/sample/u_nope')
  await both(L, 'priya', 'GET', '/employee-docs/people', undefined, { all: 1 })
  await both(L, 'priya', 'GET', '/issued-docs', undefined, { employee_id: 'u_hritesh' })
  await both(L, 'hritesh', 'GET', '/issued-docs', undefined, { employee_id: 'u_hritesh' })
  await both(L, 'priya', 'GET', '/issued-docs', undefined, { category: 'payslip', status: 'issued', q: 'payslip' })
  await both(L, 'priya', 'GET', '/issued-docs', undefined, { run_id: 'pr_prev', from: '2026-01-01', to: '2026-12-31' })
  await both(L, 'priya', 'GET', '/issued-docs', undefined, { q: 'SCI/HR' })
  await both(L, 'hritesh', 'GET', '/issued-docs/r_02rh')
  await both(L, 'bijaya', 'GET', '/issued-docs/r_02rh')
  // templates: create / validate / patch / duplicate / delete
  const body = '# Bonus letter\n\nDear {{employee_name}},\n\nWe are pleased to award you a bonus of {{bonus_amount}} for {{appraisal_period}}.\n\n{{company}}'
  await both(L, 'hritesh', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'other', body })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bo', category: 'other', body })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Offer letter', category: 'other', body })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'bogus', body })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'other', body: 'Too short' })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'other', body: body + ' {{mystery}} {{other_thing}}' })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'other', body, custom_placeholders: ['Bonus Amount!'] })
  await both(L, 'priya', 'POST', '/doc-templates', { name: 'Payslip v2', category: 'payslip', body: 'Payslip for {{employee_name}} for the month, no net pay shown here.' })
  const t1 = await both(L, 'priya', 'POST', '/doc-templates', { name: 'Bonus letter', category: 'other', body: body + '\r\n\r\nRegards', custom_placeholders: ['bonus_amount', ' BONUS_AMOUNT '], description: 'One-off bonus', letterhead: false })
  await rdSides(L, 'priya', 'PATCH', rdId(t1, (d) => `/doc-templates/${d?.id}`), { active: false, description: 'Switched off for now' })
  await rdSides(L, 'priya', 'PATCH', rdId(t1, (d) => `/doc-templates/${d?.id}`), { name: 'Bonus letter 2026' }, undefined, 1)
  await rdSides(L, 'priya', 'PATCH', rdId(t1, (d) => `/doc-templates/${d?.id}`), { name: 'Bonus letter 2026', active: true })
  await both(L, 'priya', 'PATCH', '/doc-templates/r_02py', { category: 'other' })
  await both(L, 'priya', 'PATCH', '/doc-templates/r_02pw', { body: 'Short' })
  await both(L, 'priya', 'POST', '/doc-templates/r_02ps/duplicate')
  await both(L, 'priya', 'POST', '/doc-templates/r_02ps/duplicate')
  await both(L, 'priya', 'DELETE', '/doc-templates/r_02ps')
  await both(L, 'priya', 'DELETE', '/doc-templates/r_02py')
  const t2 = await both(L, 'priya', 'POST', '/doc-templates/r_02px/duplicate')
  await rdSides(L, 'hritesh', 'DELETE', rdId(t2, (d) => `/doc-templates/${d?.id}`))
  await rdSides(L, 'priya', 'DELETE', rdId(t2, (d) => `/doc-templates/${d?.id}`))
  await both(L, 'priya', 'GET', '/doc-templates')
  // preview / issue
  const pw = await both(L, 'priya', 'GET', '/doc-templates/r_02pw')
  const proc: string[] = (pw.m.data as RdAny)?.process_placeholders ?? []
  const fullVars = Object.fromEntries(proc.map((k) => [k, `Value for ${k}`]))
  await both(L, 'priya', 'POST', '/doc-templates/r_02pw/preview', { employee_ids: ['u_hritesh', 'u_bijaya'], vars: { reason: 'Late twice' }, per_employee: { u_bijaya: { reason: 'Missed standups' } } })
  await both(L, 'hritesh', 'POST', '/doc-templates/r_02pw/preview', { employee_ids: ['u_hritesh'] })
  await both(L, 'priya', 'POST', '/doc-templates/r_02pw/preview', { employee_ids: [] })
  await both(L, 'priya', 'POST', '/doc-templates/r_02pw/preview', { employee_ids: ['u_nope'] })
  await both(L, 'priya', 'POST', '/doc-templates/r_02pw/issue', { employee_ids: ['u_hritesh'] })
  await both(L, 'priya', 'POST', '/doc-templates/r_02pw/issue', { employee_ids: ['u_hritesh', 'u_bijaya'], vars: {} })
  await rdSides(L, 'priya', 'POST', rdId(t1, (d) => `/doc-templates/${d?.id}/issue`), { employee_ids: ['u_hritesh'], vars: { bonus_amount: '₹50,000' } })
  const iss = await both(L, 'priya', 'POST', '/doc-templates/r_02pw/issue', { employee_ids: ['u_hritesh', 'u_bijaya'], vars: fullVars, title: 'Warning letter' })
  const dr = await both(L, 'priya', 'POST', '/doc-templates/r_02pw/issue', { employee_ids: ['u_jagannath'], status: 'draft', vars: { [proc[0] ?? 'x']: 'Partial' } })
  await both(L, 'priya', 'POST', '/doc-templates/r_02py/issue', { employee_ids: ['u_hritesh'], vars: { net_pay: '₹1' } })
  await both(L, 'priya', 'POST', '/doc-templates/r_02pp/preview', { employee_ids: ['u_hritesh'] })
  await both(L, 'santosh', 'POST', '/doc-templates/r_02ps/preview', { employee_ids: ['u_hritesh'] })
  await rdSides(L, 'priya', 'GET', rdId(iss, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  await rdSides(L, 'hritesh', 'GET', rdId(iss, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  await rdSides(L, 'hritesh', 'POST', rdId(iss, (d) => `/issued-docs/${d?.created?.[0]?.id}/ack`))
  await rdSides(L, 'hritesh', 'POST', rdId(iss, (d) => `/issued-docs/${d?.created?.[0]?.id}/ack`))
  await rdSides(L, 'priya', 'POST', rdId(iss, (d) => `/issued-docs/${d?.created?.[1]?.id}/ack`))
  // drafts
  await rdSides(L, 'jagannath', 'GET', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  await rdSides(L, 'priya', 'POST', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}/issue`))
  await rdSides(L, 'priya', 'PATCH', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}`), { title: 'W' })
  await rdSides(L, 'priya', 'PATCH', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}`), { vars: fullVars, title: 'Warning letter — attendance' }, undefined, 1)
  await rdSides(L, 'priya', 'PATCH', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}`), { vars: fullVars, title: 'Warning letter — attendance' })
  await rdSides(L, 'priya', 'POST', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}/issue`))
  await rdSides(L, 'priya', 'POST', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}/issue`))
  await rdSides(L, 'priya', 'DELETE', rdId(dr, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  const dr2 = await both(L, 'priya', 'POST', '/doc-templates/r_02pw/issue', { employee_ids: ['u_bijaya'], status: 'draft' })
  await rdSides(L, 'priya', 'POST', rdId(dr2, (d) => `/issued-docs/${d?.created?.[0]?.id}/revoke`), { reason: 'Not needed' })
  await rdSides(L, 'priya', 'POST', rdId(dr2, (d) => `/issued-docs/${d?.created?.[0]?.id}/reissue`))
  await rdSides(L, 'bijaya', 'POST', rdId(dr2, (d) => `/issued-docs/${d?.created?.[0]?.id}/ack`))
  await rdSides(L, 'hritesh', 'DELETE', rdId(dr2, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  await rdSides(L, 'priya', 'DELETE', rdId(dr2, (d) => `/issued-docs/${d?.created?.[0]?.id}`))
  // revoke / reissue / ack of issued documents
  await both(L, 'priya', 'PATCH', '/issued-docs/r_02rk', { title: 'Edited' })
  await both(L, 'priya', 'DELETE', '/issued-docs/r_02rk')
  await both(L, 'priya', 'POST', '/issued-docs/r_02rk/revoke', { reason: 'no' })
  await both(L, 'hritesh', 'POST', '/issued-docs/r_02rk/revoke', { reason: 'Issued by mistake' })
  await both(L, 'priya', 'POST', '/issued-docs/r_02rk/revoke', { reason: 'Issued with the wrong confirmation date' })
  await both(L, 'priya', 'POST', '/issued-docs/r_02rk/revoke', { reason: 'Issued with the wrong confirmation date' })
  await both(L, 'pragyasmita', 'POST', '/issued-docs/r_02rk/ack')
  const ri = await both(L, 'priya', 'POST', '/issued-docs/r_02rk/reissue')
  await both(L, 'priya', 'POST', '/issued-docs/r_02rk/reissue')
  await rdSides(L, 'pragyasmita', 'POST', rdId(ri, (d) => `/issued-docs/${d?.doc?.id}/ack`))
  await both(L, 'priya', 'POST', '/issued-docs/r_02r8/reissue')
  await both(L, 'jayashree', 'POST', '/issued-docs/r_02r8/ack')
  await both(L, 'hritesh', 'POST', '/issued-docs/r_02rh/ack')
  await both(L, 'priya', 'POST', '/issued-docs/r_02rh/ack')
  await both(L, 'hritesh', 'GET', '/issued-docs', undefined, { mine: 1 })
  // employee documents
  const png = { name: 'scan.PNG', mime: 'image/png', size_bytes: 68, data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'nope', title: 'My PAN', file: png })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'pan', title: 'PA', file: png })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'pan', title: 'My PAN card' })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'pan', title: 'My PAN card', file: { ...png, name: 'scan.gif' } })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'pan', title: 'My PAN card', file: { ...png, size_bytes: 0 } })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'pan', title: 'My PAN card', file: { ...png, data_url: 42 } })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'passport', title: 'My passport', file: png })
  await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'passport', title: 'My passport', file: png, expires_on: '2030/01/01' })
  await both(L, 'hritesh', 'POST', '/employee-docs', { employee_id: 'u_bijaya', kind: 'pan', title: 'Bijaya PAN', file: png })
  const e1 = await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'passport', title: 'Old passport', file: png, expires_on: '2020-01-01', doc_number: 'P1234567', note: '  scanned  ' })
  const e2 = await both(L, 'hritesh', 'POST', '/employee-docs', { kind: 'address_proof', title: 'Electricity bill', file: png })
  const e3 = await both(L, 'priya', 'POST', '/employee-docs', { employee_id: 'u_bijaya', kind: 'experience', title: 'Experience letter — previous employer', file: png, expires_on: '2026-11-20' })
  const e4 = await both(L, 'priya', 'POST', '/employee-docs', { kind: 'photo', title: 'My photo', file: png })
  await both(L, 'priya', 'POST', '/employee-docs', { employee_id: 'u_nope', kind: 'photo', title: 'Ghost photo', file: png })
  await rdSides(L, 'hritesh', 'POST', rdId(e1, (d) => `/employee-docs/${d?.id}/verify`))
  await rdSides(L, 'priya', 'POST', rdId(e4, (d) => `/employee-docs/${d?.id}/verify`))
  await rdSides(L, 'priya', 'POST', rdId(e1, (d) => `/employee-docs/${d?.id}/reject`), { note: 'blurry' })
  await rdSides(L, 'priya', 'POST', rdId(e1, (d) => `/employee-docs/${d?.id}/reject`), { note: 'The scan is blurry — upload a clearer copy.' })
  await rdSides(L, 'priya', 'POST', rdId(e1, (d) => `/employee-docs/${d?.id}/verify`))
  await rdSides(L, 'santosh', 'POST', rdId(e2, (d) => `/employee-docs/${d?.id}/verify`), { note: 'Checked against the original' })
  await rdSides(L, 'santosh', 'POST', rdId(e4, (d) => `/employee-docs/${d?.id}/verify`))
  await rdSides(L, 'hritesh', 'GET', rdId(e2, (d) => `/employee-docs/${d?.id}/file`))
  await rdSides(L, 'bijaya', 'GET', rdId(e2, (d) => `/employee-docs/${d?.id}/file`))
  await both(L, 'hritesh', 'GET', '/employee-docs/edoc_02ro/file')
  await rdSides(L, 'hritesh', 'DELETE', rdId(e2, (d) => `/employee-docs/${d?.id}`))
  await rdSides(L, 'bijaya', 'DELETE', rdId(e1, (d) => `/employee-docs/${d?.id}`))
  await rdSides(L, 'hritesh', 'DELETE', rdId(e1, (d) => `/employee-docs/${d?.id}`))
  await rdSides(L, 'bijaya', 'DELETE', rdId(e3, (d) => `/employee-docs/${d?.id}`))
  await rdSides(L, 'priya', 'DELETE', rdId(e3, (d) => `/employee-docs/${d?.id}`))
  for (const who of ['priya', 'hritesh']) {
    await both(L, who, 'GET', '/employee-docs/people')
    await both(L, who, 'GET', '/employee-docs/person/u_hritesh')
    await both(L, who, 'GET', '/notifications')
  }
  await both(L, 'priya', 'GET', '/employee-docs/person/u_nope')
  await both(L, 'priya', 'GET', '/issued-docs')
  await both(L, 'santosh', 'GET', '/search', undefined, { q: 'warning' })
}

async function rdWorkflowScenarios() {
  const L = 'rd-wf'
  for (const who of ['santosh', 'priya', 'hritesh', 'subhankar', 'debasish']) {
    await both(L, who, 'GET', '/wf/templates')
    await both(L, who, 'GET', '/wf/meta')
    await both(L, who, 'GET', '/wf/templates/r_02vi')
    await both(L, who, 'GET', '/wf/templates/r_02vn')
    for (const tab of ['waiting', 'started', 'about', 'all']) await both(L, who, 'GET', '/wf/instances', undefined, { tab })
    for (const id of ['wfi_02wd', 'wfi_02wf', 'wfi_02wh', 'wfi_02wp']) await both(L, who, 'GET', `/wf/instances/${id}`)
    await both(L, who, 'GET', '/wf/appraisal/apr_h1_hritesh')
    await both(L, who, 'GET', '/wf/appraisal/apr_h1_jagannath')
  }
  await both(L, 'santosh', 'GET', '/wf/instances', undefined, { tab: 'all', status: 'completed', template_id: 'r_02vi' })
  await both(L, 'santosh', 'GET', '/wf/appraisal/apr_h1_jayashree')
  await both(L, 'santosh', 'GET', '/wf/appraisal/apr_nope')
  await both(L, 'hritesh', 'GET', '/wf/instances/wfi_nope')
  // templates: check / create / put / duplicate
  const g = await both(L, 'santosh', 'GET', '/wf/templates/r_02vk')
  const tpl = g.m.data as RdAny
  await both(L, 'hritesh', 'POST', '/wf/templates/check', { template: tpl })
  await both(L, 'santosh', 'POST', '/wf/templates/check', { template: tpl, id: 'r_02vk' })
  await both(L, 'santosh', 'POST', '/wf/templates/check', { template: tpl })
  await both(L, 'santosh', 'POST', '/wf/templates/check', { template: 'nonsense' })
  await both(L, 'santosh', 'POST', '/wf/templates/check', {
    template: {
      name: 'x', process: 'bogus', stages: [
        { key: '1bad', name: '', assignee: 'role', role_key: 'cto', sla_days: 0, fields: [{ key: 'a', label: '', type: 'select', options: ['A', 'a'], min: 'x', max: 1, visible_to: ['nowhere'], max_from: 'zz.yy', override_field: 'nope' }] },
        { key: 'dup', name: 'Dup', assignee: 'user', user_id: 'u_ankit', sla_days: 31, fields: [{ key: 'r', label: 'Rate', type: 'rating', min: 0, max: 9 }, { key: 'r', label: 'Rate again', type: 'text', max_from: 'dup.r' }] },
        { key: 'dup', name: 'Dup 2', assignee: 'subject', sla_days: 2.5, fields: [] }, { key: 'subj2', name: 'S', assignee: 'subject', sla_days: 1, fields: [] },
        { key: 'role_x', name: 'Role X', assignee: 'role', role_key: 'nope', sla_days: 2, fields: [] }, { key: 'who', name: 'Who', assignee: 'alien', sla_days: 2, fields: [] },
      ],
      on_complete: [{ type: 'teleport' }, { type: 'generate_document', template_key: 'nope' }, { type: 'send_email', template_key: 'nope', config: { to: 'aliens' } }, { type: 'update_ctc', config: { hike_field: 'dup.r' } }, { type: 'create_task', config: { title: 'x', when: { field: 'no.field', equals: 'y' } } }, { type: 'notify', config: { to: 'role:hr_manager' } }],
      on_reject: [{ type: 'update_ctc', config: [] }],
    },
  })
  await both(L, 'hritesh', 'POST', '/wf/templates', { name: 'My flow' })
  await both(L, 'santosh', 'POST', '/wf/templates', { name: 'ab' })
  await both(L, 'santosh', 'POST', '/wf/templates', { name: 'Annual Appraisal' })
  await both(L, 'santosh', 'POST', '/wf/templates', { name: 'My flow', process: 'bogus' })
  await both(L, 'santosh', 'POST', '/wf/templates', { name: 'Copy flow', copy_of: 'r_nope' })
  const ct = await both(L, 'santosh', 'POST', '/wf/templates', { name: 'Laptop request', description: 'Ask for a laptop' })
  const cc = await both(L, 'santosh', 'POST', '/wf/templates', { name: 'Promotion (fast track)', copy_of: 'r_02vm' })
  const gt = await rdSides(L, 'santosh', 'GET', rdId(ct, (d) => `/wf/templates/${d?.id}`))
  const base = gt?.m.data as RdAny
  const put1 = {
    ...base, active: true, self_service: true, process: 'general',
    stages: [
      { key: 'request', name: 'Request', assignee: 'initiator', sla_days: 2, fields: [{ key: 'model', label: 'Model', type: 'select', required: true, options: ['Mac', 'ThinkPad', ''], visible_to: ['all', 'all'] }, { key: 'budget', label: 'Budget', type: 'money', required: true, min: 1000000, max: '', visible_to: ['approve'] }, { key: 'why', label: 'Why', type: 'textarea', required: true, min: 20, help: '  Explain  ', visible_to: ['approve', 'subject'] }] },
      { key: 'approve', name: 'Manager approval', assignee: 'reports_to', sla_days: 3, can_send_back: true, fields: [{ key: 'ok', label: 'Approved budget', type: 'money', required: true, visible_to: ['all'] }, { key: 'conf', label: 'Confirmed', type: 'checkbox', required: true, visible_to: ['all'] }] },
      { key: 'it', name: 'IT', assignee: 'role', role_key: 'administrator', sla_days: 2, fields: [{ key: 'asset_tag', label: 'Asset tag', type: 'text', required: true, visible_to: ['all'] }, { key: 'receipt', label: 'Receipt', type: 'file', required: true, visible_to: ['all'] }, { key: 'handover', label: 'Handover date', type: 'date', required: true, visible_to: ['subject'] }] },
    ],
    on_complete: [{ type: 'notify', config: { to: 'subject', message: 'Your laptop is ready.' } }, { type: 'create_task', config: { to: 'reports_to', title: 'Check laptop setup', due_days: 2 } }],
    on_reject: [{ type: 'notify', config: { to: 'initiator' } }],
  }
  await rdSides(L, 'santosh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), { ...put1, stages: [] })
  await rdSides(L, 'santosh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), put1, undefined, 99)
  await rdSides(L, 'hritesh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), put1)
  await rdSides(L, 'santosh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), put1)
  await rdSides(L, 'santosh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), put1)
  await rdSides(L, 'santosh', 'PUT', rdId(ct, (d) => `/wf/templates/${d?.id}`), { ...put1, description: 'Ask IT for a laptop' })
  await rdSides(L, 'santosh', 'GET', rdId(ct, (d) => `/wf/templates/${d?.id}`))
  await rdSides(L, 'santosh', 'POST', rdId(cc, (d) => `/wf/templates/${d?.id}/duplicate`))
  await both(L, 'santosh', 'POST', '/wf/templates/r_02vi/duplicate')
  await both(L, 'santosh', 'POST', '/wf/templates/r_02vi/duplicate')
  await both(L, 'priya', 'POST', '/wf/templates/r_nope/duplicate')
  await both(L, 'hritesh', 'POST', '/wf/templates/r_02vi/duplicate')
  // self-service run of the new template (initiator → manager → role pool), with send-back
  const ls = await rdSides(L, 'hritesh', 'POST', () => '/wf/instances', undefined)
  void ls
  const lr = await bothSidesBody(L, 'hritesh', 'POST', '/wf/instances', (side) => ({ template_id: ((ct?.[side] as Res)?.data as RdAny)?.id, subject_ids: ['u_hritesh'], note: 'Old laptop died', title: 'New laptop for Hritesh' }))
  const lid = rdId(lr, (d) => d?.created?.[0]?.id)
  const ld = await rdSides(L, 'hritesh', 'GET', (s) => `/wf/instances/${lid(s)}`)
  const lf = (ld?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { budget: 50 }) })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { budget: 1500000.5 }) })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { model: 'Dell' }) })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { why: 'short' }) })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'reject', reason: 'Changed my mind about it' })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { budget: 1500000 }), note: 'Urgent please' })
  const l2 = await rdSides(L, 'subhankar', 'GET', (s) => `/wf/instances/${lid(s)}`)
  const lf2 = (l2?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf2, { conf: false }) })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'send_back', reason: 'short' })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'send_back', reason: 'Please add the exact model and the quote.' })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf, { budget: 1500000, model: 'ThinkPad' }) })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf2, { ok: 1400000 }) })
  const l3 = await rdSides(L, 'debasish', 'GET', (s) => `/wf/instances/${lid(s)}`)
  const lf3 = (l3?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'debasish', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf3, { receipt: { name: '' }, handover: '2026-02-30' }) })
  await rdSides(L, 'debasish', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf3, { handover: '2026-02-30' }) })
  await rdSides(L, 'debasish', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf3, { asset_tag: 'x'.repeat(301) }) })
  await rdSides(L, 'debasish', 'POST', (s) => `/wf/instances/${lid(s)}/act`, { action: 'submit', values: rdFill(lf3, { receipt: { name: 'receipt-'.repeat(30) + '.pdf', size: '2048' } }) })
  for (const who of ['hritesh', 'subhankar', 'debasish', 'santosh', 'bijaya']) await rdSides(L, who, 'GET', (s) => `/wf/instances/${lid(s)}`)
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/comments`, { body: 'Thanks all, received the laptop today.' })
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${lid(s)}/cancel`, { reason: 'Already done, nothing to cancel' })

  // ---- the full appraisal chain: Jayashree, 5 stages across 5 people (self → manager → unit head (reassigned) → HR → finance)
  await both(L, 'hritesh', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jayashree'] })
  await both(L, 'hritesh', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_id: 'u_hritesh' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: [] })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_nope', subject_ids: ['u_jayashree'] })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vj', subject_ids: ['u_jayashree'], cycle_id: 'ac_h1_fy2627' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_h2_fy2526' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jayashree', 'u_hritesh'], cycle_id: 'ac_h1_fy2627' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jagannath'], cycle_id: 'ac_h1_fy2627' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['r_000x'] })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_ankit'] })
  const ap = await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_h1_fy2627', note: 'H1 review — please complete by Friday', title: 'ignored for one?' })
  const aid = rdId(ap, (d) => d?.created?.[0]?.id)
  const view = async (tag: string) => {
    for (const who of ['jayashree', 'subhankar', 'santosh', 'priya', 'debasish', 'hritesh']) await rdSides(`${L}:${tag}`, who, 'GET', (s) => `/wf/instances/${aid(s)}`)
    await both(`${L}:${tag}`, 'priya', 'GET', '/wf/appraisal/apr_h1_jayashree')
    await both(`${L}:${tag}`, 'jayashree', 'GET', '/wf/instances', undefined, { tab: 'about' })
  }
  await view('started')
  const s1 = await rdSides(L, 'jayashree', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const f1 = (s1?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: {} })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f1, { goals_rating: 4.3 }) })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f1, { achievements: 'Did my work.' }) })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'reject', reason: 'I do not want this review' })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'dance' })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f1) }, undefined, 99)
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f1) })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/act`, {
    action: 'submit', note: 'Self review done',
    values: rdFill(f1, { goals_rating: 4, competency_rating: 3.5, overall_self_rating: 4, achievements: 'Delivered the payroll module for HRMS and automated two monthly reports.', challenges: '', development_needs: 'SAP CPI training' }),
  })
  await view('self-done')
  const s2 = await rdSides(L, 'subhankar', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const f2 = (s2?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/preview`, { values: { recommended_hike_pct: 15 } })
  await rdSides(L, 'jayashree', 'POST', (s) => `/wf/instances/${aid(s)}/preview`, { values: {} })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f2, { recommended_hike_pct: 55 }) })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f2, { promotion: 'Maybe' }) })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f2, { delivery: 0 }) })
  await rdSides(L, 'subhankar', 'POST', (s) => `/wf/instances/${aid(s)}/act`, {
    action: 'submit', note: 'Strong half',
    values: rdFill(f2, { delivery: 4, quality: 4.5, ownership: 4, collaboration: 3.5, overall_rating: 4, feedback: 'Consistently delivered on payroll features with good quality.', recommended_hike_pct: 12.345, promotion: 'Ready in 6 months', private_comments: 'Keep an eye on workload.' }),
  })
  await view('manager-done')
  // unit head = Santosh (Delivery head Subhankar already reviewed → parent unit). HR reassigns it to Debasish.
  await rdSides(L, 'hritesh', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_debasish', note: 'Santosh is travelling' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_ankit', note: 'Santosh is travelling' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_santosh', note: 'Santosh is travelling' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_jayashree', note: 'Santosh is travelling' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_debasish', note: 'away' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/reassign`, { user_id: 'u_debasish', note: 'Santosh is travelling this week' })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: {} })
  const s3 = await rdSides(L, 'debasish', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const f3 = (s3?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'debasish', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f3, { calibrated_rating: 4, hike_decision: 'Modify', endorsed_hike_pct: 10, unit_comments: 'Calibrated against the unit.' }) })
  await view('unit-done')
  const s4 = await rdSides(L, 'priya', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const f4 = (s4?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/preview`, { values: { normalised_hike_pct: 9, effective_date: '2026-11-01', band_check: 'ignored' } })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f4, { effective_date: '2026-13-01' }) })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${aid(s)}/act`, {
    action: 'submit', values: rdFill(f4, { band_check: 'Within band', final_rating: 4, normalised_hike_pct: 9, new_designation: 'Senior Consultant', effective_date: '2026-11-01', hr_comments: 'Normalised to the pool.' }),
  })
  await view('hr-done')
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/comments`, { body: 'x' })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/comments`, { body: 'y'.repeat(2001) })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/comments`, { body: 'Looks good — approving at the normalised hike unless anyone objects today.' })
  const s5 = await rdSides(L, 'santosh', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const f5 = (s5?.m.data as RdAny)?.form?.fields
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/preview`, { values: { approved_hike_pct: 11 } })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f5, { approved_hike_pct: 11, override_reason: 'Because' }) })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: rdFill(f5, { approved_hike_pct: 9, override_reason: '', finance_comments: 'Approved.' }), note: 'Approved' })
  await view('completed')
  await both(L, 'jayashree', 'GET', '/issued-docs', undefined, { mine: 1 })
  await both(L, 'jayashree', 'GET', '/notifications')
  await both(L, 'subhankar', 'GET', '/notifications')
  await both(L, 'santosh', 'GET', '/changes', undefined, { status: 'all' })
  const done = await rdSides(L, 'santosh', 'GET', (s) => `/wf/instances/${aid(s)}`)
  const outs = (side: 'm' | 'h', kind: string) => (((done?.[side] as Res)?.data as RdAny)?.outputs ?? []).find((o: RdAny) => o.kind === kind)?.ref_id ?? 'x'
  await rdSides(L, 'jayashree', 'GET', (s) => `/issued-docs/${outs(s, 'document')}`)
  await rdSides(L, 'jayashree', 'POST', (s) => `/issued-docs/${outs(s, 'document')}/ack`)
  await rdSides(L, 'debasish', 'POST', (s) => `/changes/${outs(s, 'cost_rate_change')}/approve`, { note: 'Matches the appraisal' })
  await view('ctc-approved')
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/act`, { action: 'submit', values: {} })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${aid(s)}/cancel`, { reason: 'Too late to cancel this one' })
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_h1_fy2627' })

  // ---- reject (Bijaya at the HR stage) and send-back (Hritesh at the manager stage)
  await both(L, 'priya', 'POST', '/wf/instances/wfi_02wf/act', { action: 'reject', reason: 'short' })
  await both(L, 'priya', 'POST', '/wf/instances/wfi_02wf/act', { action: 'reject', reason: 'Band exception not justified for this cycle.' })
  await both(L, 'priya', 'POST', '/wf/instances/wfi_02wf/act', { action: 'reject', reason: 'Band exception not justified for this cycle.' })
  await both(L, 'priya', 'GET', '/wf/instances/wfi_02wf')
  await both(L, 'bijaya', 'GET', '/wf/instances/wfi_02wf')
  await both(L, 'priya', 'GET', '/wf/appraisal/apr_h1_bijaya')
  await both(L, 'priya', 'POST', '/wf/instances/wfi_02wd/act', { action: 'submit', values: {} })
  await both(L, 'subhankar', 'POST', '/wf/instances/wfi_02wd/act', { action: 'send_back', reason: 'Please add your HRMS achievements as well.' })
  await both(L, 'hritesh', 'GET', '/wf/instances/wfi_02wd')
  const h1 = await both(L, 'hritesh', 'GET', '/wf/instances/wfi_02wd')
  await both(L, 'hritesh', 'POST', '/wf/instances/wfi_02wd/act', { action: 'submit', values: rdFill((h1.m.data as RdAny)?.form?.fields, { achievements: 'Delivered payroll APIs and the HRMS integration with the bank.' }) })
  const h2 = await both(L, 'subhankar', 'GET', '/wf/instances/wfi_02wd')
  await both(L, 'subhankar', 'POST', '/wf/instances/wfi_02wd/act', { action: 'submit', values: rdFill((h2.m.data as RdAny)?.form?.fields, { recommended_hike_pct: 10 }) })
  for (const who of ['hritesh', 'subhankar', 'santosh', 'priya']) await both(L, who, 'GET', '/wf/instances/wfi_02wd')
  await both(L, 'santosh', 'POST', '/wf/instances/wfi_02wd/act', { action: 'send_back', reason: 'Please recheck the hike recommendation.' })
  await both(L, 'subhankar', 'GET', '/wf/appraisal/apr_h1_hritesh')

  // ---- onboarding of an invited joiner: IT → manager → letter needs an account
  const o1 = await both(L, 'debasish', 'GET', '/wf/instances/wfi_02wp')
  await both(L, 'debasish', 'POST', '/wf/instances/wfi_02wp/act', { action: 'submit', values: rdFill((o1.m.data as RdAny)?.form?.fields) })
  const o2 = await both(L, 'subhankar', 'GET', '/wf/instances/wfi_02wp')
  await both(L, 'subhankar', 'POST', '/wf/instances/wfi_02wp/act', { action: 'submit', values: rdFill((o2.m.data as RdAny)?.form?.fields) })
  await both(L, 'subhankar', 'GET', '/wf/instances/wfi_02wp')
  await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vk', subject_ids: ['r_000x'] })

  // ---- start → cancel paths (self stage cannot reject)
  const sb = await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vj', subject_ids: ['u_subham', 'u_pragyasmita'], note: 'Confirmation due' })
  const sid = rdId(sb, (d) => d?.created?.[0]?.id)
  await rdSides(L, 'subham', 'POST', (s) => `/wf/instances/${sid(s)}/cancel`, { reason: 'I am not the initiator here' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${sid(s)}/cancel`, { reason: 'too short' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${sid(s)}/cancel`, { reason: 'Started for the wrong person, sorry.' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${sid(s)}/cancel`, { reason: 'Started for the wrong person, sorry.' })
  await rdSides(L, 'priya', 'POST', (s) => `/wf/instances/${sid(s)}/reassign`, { user_id: 'u_debasish', note: 'Whatever this is' })
  await rdSides(L, 'santosh', 'POST', (s) => `/wf/instances/${sid(s)}/act`, { action: 'submit', values: {} })
  const sc = await both(L, 'priya', 'POST', '/wf/instances', { template_id: 'r_02vn', subject_ids: ['u_subham'] })
  await rdSides(L, 'priya', 'POST', rdId(sc, (d) => `/wf/instances/${d?.created?.[0]?.id}/act`), { action: 'reject', reason: 'The initiator stage cannot reject this' })
  await both(L, 'subham', 'POST', '/wf/instances', { template_id: 'r_02vn', subject_id: 'u_subham', note: 'Please approve my document' })
  // SLA escalation (made overdue out of band on both sides)
  const pool = pgLite()
  const past = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)
  await pool.query("UPDATE wf_instances SET stage_due_on = $1 WHERE id = 'wfi_02wd'", [past])
  const mi = (getDb() as RdAny).wf_instances.find((x: RdAny) => x.id === 'wfi_02wd')
  if (mi) mi.stage_due_on = past
  await pool.end()
  await both(L, 'subhankar', 'GET', '/wf/instances', undefined, { tab: 'waiting' })
  await both(L, 'santosh', 'GET', '/wf/instances/wfi_02wd')
  await both(L, 'santosh', 'GET', '/notifications')
  await both(L, 'subhankar', 'GET', '/notifications')
  // a structural template change while instances run → warning, revision bump
  const vi = await both(L, 'santosh', 'GET', '/wf/templates/r_02vi')
  const viT = vi.m.data as RdAny
  await both(L, 'santosh', 'PUT', '/wf/templates/r_02vi', { ...viT, stages: (viT?.stages ?? []).map((s: RdAny, i: number) => (i === 0 ? { ...s, instructions: 'Rate yourself honestly.' } : s)) })
  await both(L, 'santosh', 'PUT', '/wf/templates/r_02vi', { ...viT, stages: (viT?.stages ?? []).map((s: RdAny, i: number) => (i === 0 ? { ...s, instructions: 'Rate yourself honestly.' } : s)) })
  await both(L, 'santosh', 'GET', '/wf/templates')
  for (const who of ['santosh', 'priya', 'hritesh', 'subhankar', 'jayashree', 'debasish']) {
    for (const tab of ['waiting', 'started', 'about', 'all']) await both(L, who, 'GET', '/wf/instances', undefined, { tab })
  }
  await both(L, 'santosh', 'GET', '/search', undefined, { q: 'appraisal' })
  await both(L, 'jayashree', 'GET', '/search', undefined, { q: 'appraisal' })
}

/** POST with a side-specific body (ids created per side) */
async function bothSidesBody(label: string, who: string, method: string, path: string, body: (side: 'm' | 'h') => unknown) {
  if (!inScope(method, path)) {
    skipped++
    return null
  }
  const [m, h] = [await mockCall(who, method, path, body('m')), await httpCall(who, method, path, body('h'))]
  const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
  const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
  const all = [...d, ...dw]
  if (all.length) {
    fail++
    failures.push(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    console.log(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    dumpFailure(label, method, path, m, h)
  } else {
    pass++
    console.log(`PASS ${label} ${method} ${path} (${m.status})`)
  }
  return { m, h }
}

async function rdPayslipScenarios() {
  const L = 'rd-payslips'
  await both(L, 'priya', 'GET', '/payroll/pr_prev/payslips')
  await both(L, 'priya', 'GET', '/payroll/pr_last/payslips')
  await both(L, 'hritesh', 'GET', '/payroll/pr_prev/payslips')
  await both(L, 'priya', 'GET', '/payroll/pr_nope/payslips')
  await both(L, 'hritesh', 'POST', '/payroll/pr_prev/payslips')
  await both(L, 'priya', 'POST', '/payroll/pr_last/payslips')
  await both(L, 'priya', 'POST', '/payroll/pr_prev/payslips')
  // revoke two seeded payslips, regenerate them
  const ls = await both(L, 'priya', 'GET', '/issued-docs', undefined, { run_id: 'pr_prev' })
  const pick = (side: 'm' | 'h', uid: string) => asArr((ls[side] as Res).data).find((d) => d.employee_id === uid)?.id ?? 'x'
  for (const uid of ['u_hritesh', 'u_baishali', 'u_subham']) {
    await rdSides(L, 'priya', 'GET', (s) => `/issued-docs/${pick(s, uid)}`)
    await rdSides(L, uid.slice(2), 'GET', (s) => `/issued-docs/${pick(s, uid)}`)
  }
  await rdSides(L, 'priya', 'POST', (s) => `/issued-docs/${pick(s, 'u_hritesh')}/revoke`, { reason: 'Wrong LWP days' })
  await rdSides(L, 'priya', 'POST', (s) => `/issued-docs/${pick(s, 'u_baishali')}/revoke`, { reason: 'Variable pay missing' })
  await both(L, 'priya', 'POST', '/payroll/pr_prev/payslips')
  await both(L, 'priya', 'GET', '/payroll/pr_prev/payslips')
  const ls2 = await both(L, 'priya', 'GET', '/issued-docs', undefined, { run_id: 'pr_prev', status: 'issued' })
  const pick2 = (side: 'm' | 'h', uid: string) => asArr((ls2[side] as Res).data).find((d) => d.employee_id === uid)?.id ?? 'x'
  await rdSides(L, 'hritesh', 'GET', (s) => `/issued-docs/${pick2(s, 'u_hritesh')}`)
  await rdSides(L, 'baishali', 'GET', (s) => `/issued-docs/${pick2(s, 'u_baishali')}`)
  // finalise September (maker-checker) and issue its payslips
  await both(L, 'priya', 'POST', '/payroll/pr_last/finalise')
  const ch = await both(L, 'debasish', 'GET', '/changes', undefined, { status: 'pending' })
  const chId = (side: 'm' | 'h') => asArr((ch[side] as Res).data).find((c) => c.entity === 'payroll_finalise')?.id ?? 'x'
  await rdSides(L, 'debasish', 'POST', (s) => `/changes/${chId(s)}/approve`, { note: 'Checked the totals' })
  await both(L, 'priya', 'GET', '/payroll/pr_last/payslips')
  await both(L, 'priya', 'POST', '/payroll/pr_last/payslips')
  await both(L, 'priya', 'POST', '/payroll/pr_last/payslips')
  await both(L, 'priya', 'GET', '/payroll/pr_last/payslips')
  const ls3 = await both(L, 'priya', 'GET', '/issued-docs', undefined, { run_id: 'pr_last' })
  const pick3 = (side: 'm' | 'h', uid: string) => asArr((ls3[side] as Res).data).find((d) => d.employee_id === uid)?.id ?? 'x'
  for (const uid of ['u_hritesh', 'u_baishali', 'u_jayashree']) await rdSides(L, 'priya', 'GET', (s) => `/issued-docs/${pick3(s, uid)}`)
  await both(L, 'hritesh', 'GET', '/notifications')
  await both(L, 'hritesh', 'GET', '/issued-docs', undefined, { mine: 1 })
}

/**
 * Both sides start from the SAME seed data: the demo seed is generated relative to the current time (some rows carry
 * the generation instant), and the API loads the copy exported to backend/var/seed.json (POST /demo/reset), so the
 * in-process mock loads that file too instead of generating a seed a few hours later (SEED_JSON overrides the path).
 */
function useApiSeed() {
  const fs = require('node:fs') as typeof import('node:fs')
  const file = process.env.SEED_JSON || 'backend/var/seed.json'
  if (!fs.existsSync(file)) return console.log(`(no ${file}: the mock generates its own seed)`)
  const keys = (JSON.parse(fs.readFileSync('backend/app/catalog/data/tables.json', 'utf8')) as { DB_KEYS: string[] }).DB_KEYS
  const text = fs.readFileSync(file, 'utf8')
  registerSeed(() => {
    const tables = (JSON.parse(text) as { tables: Record<string, unknown[]> }).tables
    return Object.fromEntries(keys.map((k) => [k, tables[k] ?? []])) as unknown as ReturnType<typeof getDb>
  })
}

async function main() {
  await ensureRoutes()
  // fresh state on both sides
  const r = await fetch(API + '/api/v1/demo/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error('demo reset failed: ' + r.status + ' ' + (await r.text()))
  useApiSeed()
  getDb() // build the mock seed
  for (const [who, email] of [
    ['santosh', 'santosh@seereon.co.in'],
    ['priya', 'priya@seereon.co.in'],
    ['hritesh', 'hritesh@seereon.co.in'],
    ['ananya', 'ananya@kalingasoft.in'],
    ['platform', 'platform@seereon.co.in'],
  ])
    await login(who, email)
  // SWEEP_ONLY=1: just the GET sweep on the fresh seed (fast check of read paths, e.g. after a fix)
  if (process.env.SWEEP_ONLY) {
    await sweep()
    console.log(`\nparity (sweep only): ${pass} passed, ${fail} failed${GET_TWICE ? `, memo diffs ${memoDiffs}` : ''}`)
    process.exit(fail || memoDiffs ? 1 : 0)
  }

  /* ---------- 20+ representative reads ---------- */
  const gets: [string, string, Record<string, unknown>?][] = [
    ['santosh', '/me'], ['santosh', '/directory'], ['santosh', '/tenant'], ['santosh', '/users'], ['santosh', '/projects'], ['santosh', '/projects/p_hrms'],
    ['santosh', '/projects/p_hrms/money'], ['santosh', '/notifications'], ['santosh', '/finance/pnl'], ['santosh', '/finance/invoices'], ['santosh', '/dashboards/ceo'],
    ['santosh', '/approvals/summary'], ['santosh', '/sales/deals'], ['santosh', '/tasks'], ['hritesh', '/my-tasks'], ['hritesh', '/dashboards/employee'], ['santosh', '/insights'],
    ['santosh', '/roles'], ['santosh', '/master/org'], ['priya', '/hr/dashboard'], ['santosh', '/workflows'], ['santosh', '/estimates'], ['santosh', '/search', { q: 'edu' }],
    ['santosh', '/sessions'], ['platform', '/admin/tenants'], ['santosh', '/emails/outbox'], ['santosh', '/changes'], ['santosh', '/wf/instances'], ['santosh', '/documents'],
  ]
  for (const [who, p, q] of gets) await both('read', who, 'GET', p, undefined, q)

  /* ---------- writes ---------- */
  await both('write', 'santosh', 'PATCH', '/me/prefs', { density: 'compact' })
  await both('write', 'santosh', 'POST', '/holidays', { date: '2026-12-25', name: 'Christmas', optional: false })
  await both('write', 'santosh', 'POST', '/notifications/read-all')
  const meta = await both('write-prep', 'priya', 'GET', '/master/org/meta')
  await both('write', 'priya', 'POST', '/master/departments', { name: 'Finance', code: 'FIN', kind: 'operations', head_id: 'u_priya' })
  const t = await both('write-prep', 'santosh', 'GET', '/tenant')
  const ver = (t.m.data as { version: number })?.version
  await both('write', 'santosh', 'PUT', '/tenant/theme', { accent: '#B8912B' }, undefined, ver)
  await both('write', 'ananya', 'PUT', '/master/org', { pan: 'AAJCK1234Q', gstin: '21AAJCK1234Q1Z2', cin: 'U72200OR2024PTC041122' }, undefined, (meta.m.data as { version: number })?.version)
  // post-write state
  for (const [who, p] of [['santosh', '/holidays'], ['priya', '/master/departments'], ['santosh', '/tenant'], ['santosh', '/notifications'], ['santosh', '/me'], ['ananya', '/master/org']] as const) await both('after', who, 'GET', p)

  /* ---------- error parity ---------- */
  await both('err401', '', 'GET', '/projects')
  await both('err403', 'hritesh', 'GET', '/finance/pnl')
  await both('err404-cross-tenant', 'ananya', 'GET', '/projects/p_hrms')
  await both('err404-route', 'santosh', 'GET', '/no/such/route')
  await both('err409-stale', 'santosh', 'PUT', '/tenant/theme', { accent: '#B8912C' }, undefined, 1)
  await both('err422', 'santosh', 'PUT', '/tenant/theme', { primary: 'green' })
  await both('err403-superadmin', 'santosh', 'GET', '/admin/tenants')
  await both('err-login', '', 'POST', '/auth/login', { email: 'santosh@seereon.co.in', password: 'nope' })
  // 402: make Kalinga read-only on both sides (out-of-band SQL write also proves cache invalidation)
  const pool = pgLite()
  await pool.query("UPDATE tenants SET status = 'read_only' WHERE id = 'tn_kalinga'")
  const kt = getDb().tenants.find((x) => x.id === 'tn_kalinga')
  if (kt) kt.status = 'read_only'
  await both('err402', 'ananya', 'POST', '/holidays', { date: '2026-12-26', name: 'Boxing day', optional: false })
  await pool.query("UPDATE tenants SET status = 'trial' WHERE id = 'tn_kalinga'")
  if (kt) kt.status = 'trial'
  await pool.end()

  await moduleScenarios()
  if (process.env.SWEEP) await sweep()
  console.log(`\nparity: ${pass} passed, ${fail} failed${MODULES ? `, ${skipped} skipped (PARITY_MODULES=${[...MODULES].join(',')})` : ''}${GET_TWICE ? `, memo diffs ${memoDiffs}` : ''}`)
  process.exit(fail || memoDiffs ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})

/* ================================================================================================================== */
/* RC: people.ts, access.ts, master.ts, settings.ts, hr.ts — write scenarios (valid + invalid, allowed + denied)      */
/* ================================================================================================================== */
async function rcScenarios() {
  for (const [who, email] of [
    ['subhankar', 'subhankar@seereon.co.in'], ['debasish', 'debasish@seereon.co.in'], ['baishali', 'baishali@seereon.co.in'], ['bijaya', 'bijaya@seereon.co.in'],
    ['rakesh', 'rakesh@kalingasoft.in'], ['pragyasmita', 'pragyasmita@seereon.co.in'], ['subham', 'subham@seereon.co.in'], ['sneha', 'sneha@kalingasoft.in'], ['arjun', 'arjun@kalingasoft.in'], ['meera', 'meera@kalingasoft.in'],
  ] as const) if (!mockTok[who]) await login(who, email)
  const id = (r: { m: Res; h: Res } | null, f: (d: any) => string | undefined) => (side: 'm' | 'h') => (r ? f((r[side] as Res).data) ?? 'x' : 'x') // eslint-disable-line @typescript-eslint/no-explicit-any
  /** same call, side-specific path and body (ids / codes generated by each side) */
  const bothBodies = async (label: string, who: string, method: string, path0: string | ((side: 'm' | 'h') => string), body: (side: 'm' | 'h') => unknown, query?: Record<string, unknown>) => {
    const pth = (side: 'm' | 'h') => (typeof path0 === 'string' ? path0 : path0(side))
    const path = pth('m')
    if (!inScope(method, path)) {
      skipped++
      return null
    }
    const [m, h] = [await mockCall(who, method, path, body('m'), query), await httpCall(who, method, pth('h'), body('h'), query)]
    const d = m.status !== h.status ? [`status mock=${m.status} api=${h.status} ${JSON.stringify(m.error ?? '')} ${JSON.stringify(h.error ?? '')}`] : diff(norm(m.error ?? m.data), norm(h.error ?? h.data))
    const dw = m.status === 200 ? diff(norm(m.warnings), norm(h.warnings), '$warnings') : []
    const all = [...d, ...dw]
    if (all.length) {
      fail++
      failures.push(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
      console.log(`FAIL ${label} ${method} ${path}\n   ` + all.join('\n   '))
    } else {
      pass++
      console.log(`PASS ${label} ${method} ${path} (${m.status})`)
    }
    return { m, h }
  }
  const changeId = (r: { m: Res; h: Res } | null) => id(r, (d) => d?.change?.id)
  const approve = async (label: string, who: string, r: { m: Res; h: Res } | null) => r && (await bothSides(label, who, 'POST', (s) => `/changes/${changeId(r)(s)}/approve`, { note: 'looks fine' }))

  /* ------------------------------------------------ access ------------------------------------------------ */
  let L = 'rc-access'
  await both(L, 'hritesh', 'GET', '/permissions')
  await both(L, 'hritesh', 'POST', '/roles', { name: 'Nope' })
  await both(L, 'santosh', 'POST', '/roles', { name: 'a' })
  await both(L, 'santosh', 'POST', '/roles', { name: 'x'.repeat(61) })
  await both(L, 'santosh', 'POST', '/roles', { name: ' ceo ' })
  await both(L, 'santosh', 'POST', '/roles', { name: 'QA Lead', permissions: 'tasks.view' })
  await both(L, 'santosh', 'POST', '/roles', { name: 'QA Lead', permissions: ['nope', 7, null, 'tasks.edit', 'also.nope', 'x.y'] })
  await both(L, 'santosh', 'POST', '/roles', { name: 'QA Lead', persona: 'boss' })
  await both(L, 'santosh', 'POST', '/roles', { name: 'QA Lead', copy_from: 'no_such_role' })
  const qa = await both(L, 'santosh', 'POST', '/roles', { name: 'QA Lead', description: '  Quality  ', persona: 'pm', permissions: ['roles.manage', 'cost_rates.edit', 'master.edit'] })
  await both(L, 'santosh', 'POST', '/roles', { name: 'PM copy', copy_from: 'project_manager' })
  await both(L, 'santosh', 'POST', '/roles/employee/clone', {})
  await both(L, 'santosh', 'POST', '/roles/nope/clone', {})
  await both(L, 'santosh', 'POST', '/roles/employee/clone', { name: 'Interns' })
  await approve(L, 'debasish', qa)
  await approve(L, 'santosh', qa)
  await both(L, 'santosh', 'GET', '/roles')
  await both(L, 'santosh', 'GET', '/roles/qa_lead')
  await both(L, 'santosh', 'PATCH', '/roles/project_manager', { description: 'Runs projects' }, undefined, 1)
  await both(L, 'santosh', 'PATCH', '/roles/project_manager', { description: 'Runs projects' }, undefined, 99)
  await both(L, 'santosh', 'PATCH', '/roles/project_manager', {})
  await both(L, 'santosh', 'PATCH', '/roles/ceo', { active: false })
  await both(L, 'santosh', 'PATCH', '/roles/administrator', { permissions: ['tasks.view'] })
  await both(L, 'santosh', 'PATCH', '/roles/administrator', { persona: 'pm' })
  await both(L, 'santosh', 'DELETE', '/roles/ceo')
  await both(L, 'santosh', 'DELETE', '/roles/nope')
  // Kalinga: maker-checker off -> the applier runs directly
  L = 'rc-access-k'
  await both(L, 'ananya', 'POST', '/roles', { name: 'Contractor', persona: 'employee', permissions: ['tasks.edit', 'timesheet.own'] })
  await both(L, 'ananya', 'POST', '/roles', { name: 'contractor' })
  await both(L, 'ananya', 'POST', '/roles/contractor/clone', {})
  await both(L, 'ananya', 'POST', '/roles/contractor/clone', {})
  await both(L, 'ananya', 'PATCH', '/roles/contractor', { name: 'Contract staff', persona: 'pm', active: false, permissions: ['tasks.edit', 'users.manage'], description: 'x' })
  await both(L, 'ananya', 'GET', '/roles/contractor')
  await both(L, 'ananya', 'PATCH', '/roles/ceo', { permissions: ['tasks.edit'] })
  await both(L, 'ananya', 'PATCH', '/roles/project_manager', { name: 'Delivery lead', persona: 'admin' })
  await both(L, 'rakesh', 'GET', '/me')
  await both(L, 'ananya', 'PATCH', '/roles/sales_manager', { active: false })
  await both(L, 'ananya', 'DELETE', '/roles/contractor_copy')
  await both(L, 'ananya', 'DELETE', '/roles/contractor')
  await both(L, 'ananya', 'GET', '/roles')
  await both(L, 'ananya', 'GET', '/setup/status')
  await both(L, 'priya', 'GET', '/setup/status')
  await both(L, 'hritesh', 'GET', '/setup/status')

  /* ------------------------------------------------ people ------------------------------------------------ */
  L = 'rc-people'
  await both(L, 'hritesh', 'PATCH', '/users/u_hritesh', { title: 'Self promoted' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', {})
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { name: ' x ' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { phone: 'abc' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { personal_email: 'nope' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { productive_hours: 13 })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { productive_hours: 5.25 })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { joined_on: '2026-02-30' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { employment_type: 'gig' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { department_id: 'dep_nope' })
  await both(L, 'priya', 'PATCH', '/users/u_subhankar', { reports_to_id: 'u_hritesh' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { reports_to_id: 'u_hritesh' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { reports_to_id: 'u_ankit' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { reports_to_id: '' })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { title: 'Developer II' }, undefined, 1)
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { phone: '+91 98765 43210', personal_email: ' Hritesh@Gmail.com ', productive_hours: 5.5, department_id: 'dep_seereon_sap', designation_id: 'des_seereon_sapcons', employment_type: 'contract', grade_id: 'gra_seereon_l3', shift_id: 'shi_seereon_client', cost_centre_id: null })
  await both(L, 'priya', 'PATCH', '/users/u_hritesh', { role_key: 'project_manager' })
  await both(L, 'santosh', 'PATCH', '/users/u_hritesh', { role_key: 'nope' })
  await both(L, 'santosh', 'PATCH', '/users/u_hritesh', { extra_permissions: ['nope'] })
  const acc = await both(L, 'santosh', 'PATCH', '/users/u_hritesh', { role_key: 'project_manager', extra_permissions: ['finance.view'], title: 'Tech lead' })
  await both(L, 'santosh', 'PATCH', '/users/u_hritesh', { role_key: 'cto' })
  await bothSides(L, 'debasish', 'POST', (s) => `/changes/${id(acc, (d) => d?.access?.change?.id)(s)}/approve`, {})
  await both(L, 'santosh', 'GET', '/users/u_hritesh')
  await both(L, 'santosh', 'PATCH', '/users/u_ankit', { title: 'Gone' })
  await both(L, 'santosh', 'PATCH', '/users/u_platform', { title: 'x' })
  // Kalinga (direct): access changes, escalation guard, lockout
  await both(L, 'ananya', 'PATCH', '/users/u_k_sneha', { role_key: 'project_manager', extra_permissions: ['finance.view'], revoked_permissions: ['tasks.edit', 'timesheet.own'] })
  await both(L, 'ananya', 'PATCH', '/users/u_k_ananya', { role_key: 'employee' })
  await both(L, 'rakesh', 'PATCH', '/users/u_k_arjun', { role_key: 'administrator' })
  await both(L, 'ananya', 'GET', '/users')
  // create employee
  L = 'rc-employee'
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  await both(L, 'hritesh', 'POST', '/employees', { name: 'Nope' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'A' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'bad' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'HRITESH@seereon.co.in' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ritika@seereon.co.in' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', personal_email: 'ravi@seereon.co.in' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', phone: '12' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: '2020-01-01' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, employment_type: 'gig' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern', role_key: 'employee' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern', role_key: 'employee', reports_to_id: 'u_ankit' })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern', role_key: 'employee', reports_to_id: 'u_subhankar', monthly_ctc_paise: 50 })
  await both(L, 'priya', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern', role_key: 'employee', reports_to_id: 'u_subhankar', extra_permissions: ['finance.view'] })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern', role_key: 'employee', reports_to_id: 'u_subhankar', start_onboarding: true, issue_joining_letter: 'yes' })
  await both(L, 'santosh', 'POST', '/employees', {
    name: ' Ravi Kumar ', email: ' Ravi@Seereon.co.in ', personal_email: 'ravi.k@gmail.com', phone: '+91 90000 11111', joined_on: today, department_id: 'dep_seereon_del', designation_id: 'des_seereon_mern',
    grade_id: 'gra_seereon_l2', role_key: 'employee', reports_to_id: 'u_subhankar', monthly_ctc_paise: 4500000, issue_joining_letter: true, start_onboarding: true,
  })
  await both(L, 'santosh', 'POST', '/employees', { name: 'Ravi Kumar', email: 'ravi@seereon.co.in', joined_on: today, role_key: 'employee', reports_to_id: 'u_subhankar' })
  await both(L, 'ananya', 'POST', '/employees', { name: 'Kiran Patnaik', email: 'kiran@kalingasoft.in', joined_on: today, department_id: 'dep_kalinga_del', designation_id: 'des_kalinga_react', role_key: 'employee', reports_to_id: 'u_k_rakesh', monthly_ctc_paise: 3000000, send_welcome: false })
  const k2 = await both(L, 'ananya', 'POST', '/employees', { name: 'Kiran Two', email: 'kiran2@kalingasoft.in', joined_on: today, department_id: 'dep_kalinga_mgmt', designation_id: 'des_kalinga_md', location_id: 'loc_kalinga_hq', role_key: 'ceo', employment_type: 'intern', shift_id: 'shi_kalinga_gen' })
  // (deactivated again: a random avatar hue would otherwise show in /maker-checker/checkers as `hue`)
  await bothSides(L, 'ananya', 'POST', (s) => `/users/${id(k2, (d) => d?.result?.user?.id)(s)}/deactivate`)
  await both(L, 'ananya', 'GET', '/users')
  await both(L, 'ananya', 'GET', '/cost-rates')
  await both(L, 'santosh', 'GET', '/users')
  await both(L, 'ananya', 'GET', '/emails/outbox')
  await both(L, 'santosh', 'GET', '/master/org')
  // reset password / 2FA reset / deactivate / reactivate
  L = 'rc-people-admin'
  await both(L, 'priya', 'POST', '/users/u_k_meera/reset-password')
  await both(L, 'ananya', 'POST', '/users/u_k_ananya/reset-password')
  await both(L, 'ananya', 'POST', '/users/u_k_meera/reset-password')
  await both(L, 'meera', 'GET', '/me')
  await both(L, 'ananya', 'POST', '/users/u_k_meera/2fa/reset')
  await both(L, 'ananya', 'POST', '/users/u_k_ananya/2fa/reset')
  await both(L, 'hritesh', 'POST', '/users/u_bijaya/deactivate')
  await both(L, 'santosh', 'POST', '/users/u_santosh/deactivate')
  await both(L, 'santosh', 'POST', '/users/u_ankit/deactivate')
  await both(L, 'santosh', 'POST', '/users/u_nope/deactivate')
  await both(L, 'santosh', 'POST', '/users/u_bijaya/deactivate')
  await both(L, 'bijaya', 'GET', '/me')
  await both(L, 'santosh', 'GET', '/users/u_bijaya')
  await both(L, 'santosh', 'POST', '/users/u_bijaya/reactivate')
  await both(L, 'santosh', 'POST', '/users/u_bijaya/reactivate')
  await both(L, 'ananya', 'POST', '/users/u_k_rakesh/deactivate')
  await both(L, 'ananya', 'POST', '/users/u_k_sneha/reactivate')
  await both(L, 'rakesh', 'GET', '/me')
  await both(L, 'ananya', 'POST', '/users/u_k_rakesh/reactivate')
  await both(L, 'ananya', 'GET', '/team-roster')
  await both(L, 'santosh', 'GET', '/team-roster')
  // invites
  L = 'rc-invites'
  await both(L, 'hritesh', 'POST', '/users/invite', { name: 'Nope', email: 'nope@x.in' })
  await both(L, 'santosh', 'POST', '/users/invite', { name: 'N', email: 'n@x.in' })
  await both(L, 'santosh', 'POST', '/users/invite', { name: 'Nina', email: 'n@x' })
  await both(L, 'santosh', 'POST', '/users/invite', { name: 'Nina', email: 'nina@x.in', role: 'wizard' })
  await both(L, 'santosh', 'POST', '/users/invite', { name: 'Nina', email: 'ritika@seereon.co.in' })
  await both(L, 'santosh', 'POST', '/users/invite', { name: 'Nina', email: 'nina@x.in', reports_to_id: 'u_nope' })
  await both(L, 'priya', 'POST', '/users/invite', { name: 'Nina', email: 'nina@x.in', role: 'admin' })
  const inv = await both(L, 'santosh', 'POST', '/users/invite', { name: ' Nina Das ', email: ' Nina@X.in ', role: 'Developer', reports_to_id: 'u_subhankar' })
  await both(L, 'santosh', 'GET', '/invites')
  await bothSides(L, 'santosh', 'POST', (s) => `/invites/${id(inv, (d) => d?.id)(s)}/resend`)
  await bothSides(L, 'hritesh', 'DELETE', (s) => `/invites/${id(inv, (d) => d?.id)(s)}`)
  await bothSides(L, 'santosh', 'DELETE', (s) => `/invites/${id(inv, (d) => d?.id)(s)}`)
  await both(L, 'santosh', 'POST', '/invites/nope/resend')
  await both(L, 'santosh', 'POST', '/users/bulk-invite', {})
  await both(L, 'santosh', 'POST', '/users/bulk-invite', { rows: { a: 1 } })
  await both(L, 'santosh', 'POST', '/users/bulk-invite', { rows: Array.from({ length: 201 }, () => ({})) })
  const bulk = [
    { name: 'Asha One', email: 'asha1@x.in', role: 'employee', reports_to_email: 'subhankar@seereon.co.in' },
    { name: 'A', email: 'bad', role: 'wizard', reports_to_email: 'nobody@x.in' },
    { name: 'Asha Dup', email: 'asha1@x.in', role: '' },
    { name: 'Asha Taken', email: 'priya@seereon.co.in', role: 'hr' },
    { name: 'Asha Admin', email: 'asha2@x.in', role: 'Administrator', reports_to_email: 'ANKIT@seereon.co.in' },
  ]
  await both(L, 'santosh', 'POST', '/users/bulk-invite', { rows: bulk })
  await both(L, 'priya', 'POST', '/users/bulk-invite', { rows: bulk, mode: 'commit' })
  await both(L, 'santosh', 'POST', '/users/bulk-invite', { rows: [bulk[0], { name: 'Asha Two', email: 'asha2@x.in', role: 'pm' }], mode: 'commit' })
  await both(L, 'ananya', 'POST', '/users/bulk-invite', { rows: Array.from({ length: 30 }, (_, i) => ({ name: `Bulk ${i}`, email: `bulk${i}@k.in` })), mode: 'commit' })
  await both(L, 'santosh', 'GET', '/invites')
  // delegations
  L = 'rc-deleg'
  await both(L, 'hritesh', 'POST', '/delegations', {})
  await both(L, 'subhankar', 'POST', '/delegations', { from_user_id: 'u_santosh', to_user_id: 'u_bijaya' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: '', from_on: '2026-12-01', to_on: '2026-12-05' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_subhankar', from_on: '2026-12-01', to_on: '2026-12-05' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_ankit', from_on: '2026-12-01', to_on: '2026-12-05' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-12-05', to_on: '2026-12-01' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-01-01', to_on: '2026-01-05' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: 'x', to_on: '2026-12-05' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-12-01', to_on: '2026-12-05', reason: 'ab' })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-12-01', to_on: '2026-12-05', project_id: 'p_hrms', include_tasks: false })
  await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-11-04', to_on: '2026-11-05' })
  const dl = await both(L, 'santosh', 'POST', '/delegations', { from_user_id: 'u_subhankar', to_user_id: 'u_bijaya', from_on: '2026-12-01', to_on: '2026-12-05', reason: ' Year-end break ', include_tasks: false })
  await both(L, 'subhankar', 'POST', '/delegations', { to_user_id: 'u_jagannath', from_on: '2026-12-10', to_on: '2026-12-11', project_id: 'p_hrms' })
  await both(L, 'subhankar', 'POST', '/delegations', { to_user_id: 'u_jagannath', from_on: '2026-12-10', to_on: '2026-12-11', project_id: 'p_nope' })
  await both(L, 'subhankar', 'GET', '/delegations')
  await both(L, 'subhankar', 'GET', '/delegations/options')
  await bothSides(L, 'hritesh', 'DELETE', (s) => `/delegations/${id(dl, (d) => d?.id)(s)}`)
  await bothSides(L, 'santosh', 'DELETE', (s) => `/delegations/${id(dl, (d) => d?.id)(s)}`)
  // sessions & 2FA (Kalinga's Arjun; the codes come from each side's own secret)
  L = 'rc-2fa'
  await both(L, 'arjun', 'GET', '/sessions')
  await both(L, 'arjun', 'DELETE', '/sessions/nope')
  await both(L, 'arjun', 'POST', '/sessions/revoke-others')
  await both(L, 'arjun', 'GET', '/me/2fa')
  await both(L, 'arjun', 'POST', '/me/2fa/verify', { code: '123456' })
  await both(L, 'arjun', 'POST', '/me/2fa/disable', { password: 'nope' })
  await both(L, 'arjun', 'POST', '/me/2fa/recovery-codes', { code: '123456' })
  const setup = await both(L, 'arjun', 'POST', '/me/2fa/setup')
  await both(L, 'arjun', 'POST', '/me/2fa/verify', { code: '12' })
  await both(L, 'arjun', 'POST', '/me/2fa/verify', { code: '000000' })
  const secretOf = (s: 'm' | 'h') => ((setup[s] as Res).data as { secret?: string })?.secret ?? ''
  const ver = await bothBodies(L, 'arjun', 'POST', '/me/2fa/verify', (s) => ({ code: totp(secretOf(s)) }))
  await both(L, 'arjun', 'POST', '/me/2fa/setup')
  await both(L, 'arjun', 'GET', '/me/2fa')
  await both(L, 'arjun', 'POST', '/me/2fa/recovery-codes', { code: 'abc' })
  await both(L, 'arjun', 'POST', '/me/2fa/recovery-codes', { code: '000 000' })
  await both(L, 'arjun', 'POST', '/me/2fa/disable', { recovery_code: 'zzzzz-zzzzz' })
  const rc = (s: 'm' | 'h') => (((ver?.[s] as Res | undefined)?.data as { recovery_codes?: string[] })?.recovery_codes ?? [])[0] ?? 'none'
  await bothBodies(L, 'arjun', 'POST', '/me/2fa/disable', (s) => ({ recovery_code: rc(s) }))
  await both(L, 'arjun', 'GET', '/me/2fa')
  await both(L, 'arjun', 'POST', '/me/2fa/disable', { password: 'Seereon@123' })
  await both(L, 'arjun', 'PATCH', '/me/avatar', { hue: 'red' })
  await both(L, 'arjun', 'PATCH', '/me/avatar', { hue: 361 })
  await both(L, 'arjun', 'PATCH', '/me/avatar', { hue: 200.6 })
  await both(L, 'ananya', 'POST', '/users/u_k_arjun/2fa/reset')

  /* ------------------------------------------------ master ------------------------------------------------ */
  L = 'rc-master'
  await both(L, 'hritesh', 'POST', '/master/locations', { name: 'X' })
  await both(L, 'priya', 'POST', '/master/locations', {})
  await both(L, 'priya', 'POST', '/master/locations', { name: 'Cuttack', code: 'c t' })
  await both(L, 'priya', 'POST', '/master/locations', { name: 'Cuttack', code: 'bbs' })
  await both(L, 'priya', 'POST', '/master/locations', { name: 'bhubaneswar hq', code: 'CTC' })
  const loc = await both(L, 'priya', 'POST', '/master/locations', { name: ' Cuttack ', code: ' ctc ', city: 'Cuttack', is_head_office: true })
  await both(L, 'priya', 'GET', '/master/locations')
  await bothSides(L, 'priya', 'PATCH', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}`, { name: 'Cuttack' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}`, { is_head_office: false })
  await bothSides(L, 'priya', 'POST', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}/deactivate`)
  await both(L, 'priya', 'PATCH', '/master/locations/loc_seereon_hq', { is_head_office: true, address: 'Khandagiri' })
  await bothSides(L, 'priya', 'POST', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}/deactivate`)
  await bothSides(L, 'priya', 'POST', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}/deactivate`)
  await bothSides(L, 'priya', 'POST', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}/activate`)
  await bothSides(L, 'priya', 'DELETE', (s) => `/master/locations/${id(loc, (d) => d?.result?.id)(s)}`)
  await both(L, 'priya', 'DELETE', '/master/locations/loc_seereon_pune')
  await both(L, 'priya', 'PATCH', '/master/locations/loc_seereon_pune', { name: 'Pune' }, undefined, 9)
  await both(L, 'priya', 'POST', '/master/departments', { name: 'Loop', code: 'LOOP', parent_id: 'dep_nope' })
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_lead', { parent_id: 'dep_seereon_it' })
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_lead', { parent_id: 'dep_seereon_lead' })
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_it', { kind: 'magic' })
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_it', { head_id: 'u_ankit' })
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_it', { head_id: 'u_debasish', cost_centre_id: 'cc_seereon_ops', name: 'IT & admin team' })
  await both(L, 'priya', 'DELETE', '/master/departments/dep_seereon_del')
  await both(L, 'priya', 'POST', '/master/designations', { name: 'Intern', default_role_id: 'nope' })
  await both(L, 'priya', 'POST', '/master/designations', { name: 'MERN developer' })
  await both(L, 'priya', 'POST', '/master/designations', { name: 'Intern', department_id: 'dep_nope' })
  const des = await both(L, 'priya', 'POST', '/master/designations', { name: 'Intern', department_id: 'dep_seereon_del', grade_id: 'gra_seereon_l1', default_role_id: 'employee' })
  await bothSides(L, 'priya', 'DELETE', (s) => `/master/designations/${id(des, (d) => d?.result?.id)(s)}`)
  await both(L, 'priya', 'POST', '/master/grades', { code: 'L9', name: 'Top', min_ctc_paise: 500, max_ctc_paise: 100 })
  await both(L, 'priya', 'POST', '/master/grades', { code: 'L9', name: 'Top', leave_multiplier: 4 })
  await both(L, 'priya', 'POST', '/master/grades', { code: 'L9', name: 'Top', min_ctc_paise: -1 })
  await both(L, 'priya', 'POST', '/master/grades', { code: 'l1', name: 'Dup' })
  await both(L, 'priya', 'POST', '/master/grades', { code: 'L9', name: 'Top', min_ctc_paise: '0', max_ctc_paise: 2500000, leave_multiplier: '1.5' })
  await both(L, 'priya', 'DELETE', '/master/grades/gra_seereon_l2')
  await both(L, 'priya', 'POST', '/master/cost-centres', { code: 'CC-NEW-THAT-IS-LONG', name: 'x' })
  await both(L, 'priya', 'POST', '/master/cost-centres', { code: 'CC-NEW', name: 'New centre', owner_id: 'u_nope' })
  await both(L, 'priya', 'POST', '/master/cost-centres', { code: 'CC-NEW', name: 'New centre', owner_id: 'u_priya' })
  await both(L, 'priya', 'DELETE', '/master/cost-centres/cc_seereon_it')
  await both(L, 'santosh', 'GET', '/master/usage') // (after a new shift its generated id becomes an object KEY, which the harness does not normalise)
  await both(L, 'hritesh', 'POST', '/master/shifts', {})
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '9:00', end_time: '18:00' })
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '09:00', end_time: '09:00' })
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '09:00', end_time: '10:00', break_minutes: 60 })
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '09:00', end_time: '18:00', break_minutes: 30.5 })
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '09:00', end_time: '18:00', working_days: [7, 'x'] })
  await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'NGT', start_time: '09:00', end_time: '12:00', working_days: [1], min_hours: 4 })
  const sh = await both(L, 'santosh', 'POST', '/master/shifts', { name: 'Night', code: 'ngt', start_time: '22:00', end_time: '06:00', break_minutes: '30', grace_minutes: 10, working_days: [5, '1', 1, 2, 3, 4], min_hours: 7.5, is_default: true })
  await both(L, 'santosh', 'GET', '/master/shifts')
  await both(L, 'santosh', 'PATCH', '/master/shifts/shi_seereon_gen', { is_default: false })
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_gen/assign', { user_ids: [] })
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_gen/assign', { user_ids: ['u_nope'] })
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_gen/assign', { user_ids: ['u_ankit'] })
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_client/assign', { user_ids: ['u_bijaya', 'u_jagannath', 'u_bijaya'] })
  await bothBodies(L, 'santosh', 'POST', (s) => `/master/shifts/${id(sh, (d) => d?.result?.id)(s)}/assign`, () => ({ user_ids: ['u_pragyasmita', 'u_jayashree', 'u_subham', 'u_bijaya'] }))
  await bothSides(L, 'santosh', 'GET', (s) => `/master/shifts/${id(sh, (d) => d?.result?.id)(s)}/members`)
  // clean up so that later reads do not carry the new shift's generated id as an object KEY (/master/usage)
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_gen/assign', { user_ids: ['u_pragyasmita', 'u_jayashree', 'u_subham', 'u_bijaya'] })
  await both(L, 'santosh', 'PATCH', '/master/shifts/shi_seereon_gen', { is_default: true })
  await bothSides(L, 'santosh', 'DELETE', (s) => `/master/shifts/${id(sh, (d) => d?.result?.id)(s)}`)
  await both(L, 'santosh', 'GET', '/master/usage')
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_client/deactivate')
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_client/assign', { user_ids: ['u_baishali'] })
  await both(L, 'santosh', 'DELETE', '/master/shifts/shi_seereon_gen')
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_client/activate')
  await both(L, 'santosh', 'POST', '/master/shifts/shi_seereon_client/activate')
  await both(L, 'priya', 'POST', '/master/departments/dep_seereon_it/deactivate')
  await both(L, 'priya', 'POST', '/master/departments/dep_seereon_it/deactivate')
  await both(L, 'priya', 'POST', '/master/departments/dep_seereon_it/activate')
  await both(L, 'priya', 'POST', '/master/grades/gra_seereon_l5/deactivate')
  await both(L, 'priya', 'PATCH', '/master/designations/des_seereon_qa', { grade_id: 'gra_seereon_l5' })
  await both(L, 'priya', 'PATCH', '/master/designations/des_seereon_qa', { grade_id: 'gra_nope' })
  await both(L, 'priya', 'PATCH', '/master/designations/des_seereon_qa', { name: 'QA engineer ', grade_id: 'gra_seereon_l3', default_role_id: '' })
  await both(L, 'priya', 'PATCH', '/master/designations/des_seereon_qa', { name: 'QA engineer' })
  await both(L, 'priya', 'POST', '/master/designations/des_seereon_qa/deactivate')
  await both(L, 'priya', 'POST', '/master/designations/des_seereon_qa/activate')
  await both(L, 'priya', 'PATCH', '/master/grades/gra_seereon_l5', { min_ctc_paise: 900000, max_ctc_paise: 100 })
  await both(L, 'priya', 'PATCH', '/master/grades/gra_seereon_l5', { name: 'Head', min_ctc_paise: 0, max_ctc_paise: '2500000', leave_multiplier: 1.25 })
  await both(L, 'priya', 'POST', '/master/grades/gra_seereon_l5/activate')
  await both(L, 'priya', 'PATCH', '/master/cost-centres/cc_seereon_it', { code: 'cc-sap' })
  await both(L, 'priya', 'PATCH', '/master/cost-centres/cc_seereon_it', { name: 'IT', owner_id: 'u_debasish' })
  await both(L, 'priya', 'POST', '/master/cost-centres/cc_seereon_it/deactivate')
  await both(L, 'priya', 'PATCH', '/master/departments/dep_seereon_ops', { cost_centre_id: 'cc_seereon_it' })
  await both(L, 'priya', 'POST', '/master/cost-centres/cc_seereon_it/activate')
  await both(L, 'priya', 'GET', '/master/grades')
  await both(L, 'priya', 'GET', '/master/cost-centres')
  await both(L, 'priya', 'GET', '/master/designations')
  await both(L, 'santosh', 'GET', '/master/people')
  // org profile (maker-checker on in Seereon)
  L = 'rc-org'
  await both(L, 'hritesh', 'PUT', '/master/org', { legal_name: 'X' })
  await both(L, 'santosh', 'PUT', '/master/org', { legal_name: '' })
  await both(L, 'santosh', 'PUT', '/master/org', { pan: 'abc' })
  await both(L, 'santosh', 'PUT', '/master/org', { gstin: '99AAAAA1111A1Z1' })
  await both(L, 'santosh', 'PUT', '/master/org', { pan: 'ABCDE1234F', gstin: '21ZZZZZ9999Z1Z5' })
  await both(L, 'santosh', 'PUT', '/master/org', { website: 'not a site' })
  await both(L, 'santosh', 'PUT', '/master/org', { email: 'hr@x' })
  await both(L, 'santosh', 'PUT', '/master/org', { pincode: '012345' })
  await both(L, 'santosh', 'PUT', '/master/org', { incorporated_on: '2099-01-01' })
  await both(L, 'santosh', 'PUT', '/master/org', { employee_code_prefix: '1ab' })
  await both(L, 'santosh', 'PUT', '/master/org', { employee_code_next: 1 })
  await both(L, 'santosh', 'PUT', '/master/org', { bank_account: '12 34' })
  await both(L, 'santosh', 'PUT', '/master/org', { bank_name: 'HDFC', ifsc: '' })
  await both(L, 'santosh', 'PUT', '/master/org', {}, undefined, 1)
  await both(L, 'santosh', 'PUT', '/master/org', {})
  const org = await both(L, 'santosh', 'PUT', '/master/org', { brand_name: 'Seereon', phone: '+91 674 000 0000', website: 'HTTPS://Seereon.co.in/about', bank_account: '5010 0123 4567 89', bank_name: 'HDFC Bank', ifsc: 'hdfc0001234', city: 'Bhubaneswar' })
  await approve(L, 'debasish', org)
  await both(L, 'santosh', 'GET', '/master/org')
  await both(L, 'santosh', 'GET', '/master/org/meta')
  // email templates
  L = 'rc-emails'
  await both(L, 'hritesh', 'PUT', '/emails/templates/r_016g', { subject: 'x' })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016g', { subject: '' })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016g', { body: '   ' })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016g', { subject: 'Hi {{ nope }} and {{bad}} {{nope}}' })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016g', { body: 'Hello {{employee_name}}' })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016g', { active: false })
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016i', { subject: ' Leave {{decision}} ', body: 'Hi {{employee_name}},\r\nYour leave was {{ decision }}.\r\n', active: 0 }, undefined, 1)
  await both(L, 'santosh', 'PUT', '/emails/templates/r_016i', { subject: 'Again' }, undefined, 1)
  await both(L, 'santosh', 'GET', '/emails/templates')
  await both(L, 'santosh', 'POST', '/emails/templates/r_016i/reset', {}, undefined, 7)
  await both(L, 'santosh', 'POST', '/emails/templates/r_016i/reset')
  await both(L, 'santosh', 'POST', '/emails/templates/r_016g/preview', { subject: 'Hi {{employee_name}} {{nope}}', body: '{{temp_password}} {{ company }}' })
  await both(L, 'santosh', 'POST', '/emails/templates/r_02q0/preview')
  await both(L, 'santosh', 'GET', '/emails/outbox', undefined, { template_key: 'welcome', search: 'RAVI' })
  await both(L, 'santosh', 'GET', '/emails/outbox', undefined, { search: 'subhankar' })

  /* ------------------------------------------------ settings ------------------------------------------------ */
  L = 'rc-settings'
  await both(L, 'hritesh', 'PUT', '/settings', { settings: { 'approval.sla_working_days': 3 } })
  const badSettings: Record<string, unknown>[] = [
    { 'nope.key': 1 }, { 'company.currency': 'USD' }, { 'approval.sla_working_days': 11 }, { 'calendar.min_hours_per_day': 7.25 }, { 'timesheet.unlock_max_days': 2.5 },
    { 'approval.bulk_approve': 'yes' }, { 'timesheet.hours_step': '0.5' }, { 'timesheet.hours_step': true }, { 'notify.friday_nudge_time': '25:00' }, { 'projects.code_prefix': '1AB' },
    { 'calendar.weekly_off': [6] }, { 'calendar.weekly_off': [0, 1, 2, 3] }, { 'calendar.saturday_off_weeks': [0] }, { 'calendar.max_hours_per_day': 8, 'calendar.min_hours_per_day': 9 },
    { 'calendar.saturday_rule': 'some_off', 'calendar.saturday_off_weeks': [] }, { 'finance.opening_cash_paise': -1 },
  ]
  for (const s of badSettings) await both(L, 'santosh', 'PUT', '/settings', { settings: s })
  await both(L, 'santosh', 'PUT', '/settings', { tenant: { name: 'x' } })
  await both(L, 'santosh', 'PUT', '/settings', { tenant: { time_zone: 'Mars/Base' } })
  await both(L, 'santosh', 'PUT', '/settings', { tenant: { industry: 'mining' } })
  await both(L, 'santosh', 'PUT', '/settings', {})
  await both(L, 'santosh', 'PUT', '/settings', { settings: { 'approval.sla_working_days': 3 } }, undefined, 1)
  await both(L, 'santosh', 'PUT', '/settings', {
    settings: { 'approval.sla_working_days': 3, 'projects.code_prefix': ' sci ', 'calendar.weekly_off': ['0', 0], 'finance.opening_cash_paise': 123.5, 'security.require_2fa_admins': true, 'timesheet.hours_step': 0.5 },
    tenant: { name: ' Seereon Consulting ', time_zone: 'Asia/Dubai', industry: 'sap_consulting' },
  })
  await both(L, 'santosh', 'GET', '/settings')
  await both(L, 'santosh', 'PUT', '/settings', { settings: { 'security.require_2fa_admins': false }, tenant: { time_zone: 'Asia/Kolkata' } })
  // holidays
  L = 'rc-holidays'
  await both(L, 'hritesh', 'POST', '/holidays', { date: '2026-12-31', name: 'NYE' })
  await both(L, 'santosh', 'POST', '/holidays', { date: '31-12-2026', name: 'NYE' })
  await both(L, 'santosh', 'POST', '/holidays', { date: '2026-12-31', name: 'N' })
  await both(L, 'santosh', 'POST', '/holidays', { date: '2026-01-26', name: 'Again' })
  await both(L, 'santosh', 'POST', '/holidays', { date: '2026-08-20', name: 'Final month holiday' })
  const hol = await both(L, 'santosh', 'POST', '/holidays', { date: '2026-12-31', name: ' New Year Eve ', optional: 1 })
  await bothSides(L, 'santosh', 'PATCH', (s) => `/holidays/${id(hol, (d) => d?.id)(s)}`, { name: 'NYE (optional)' })
  await bothSides(L, 'santosh', 'PATCH', (s) => `/holidays/${id(hol, (d) => d?.id)(s)}`, { date: '2026-01-26' })
  await bothSides(L, 'santosh', 'DELETE', (s) => `/holidays/${id(hol, (d) => d?.id)(s)}`)
  await both(L, 'santosh', 'GET', '/holidays', undefined, { year: '2027' })
  await both(L, 'santosh', 'POST', '/holidays/import', {})
  const hrows = [
    { date: '01/01/2027', name: 'New Year', optional: 'Yes' }, { date: '2027-02-30', name: 'Bad date' }, { date: '26-01-2026', name: 'Dup' }, { date: '2027-03-01', name: 'x' },
    { date: '1.1.2027', name: 'Twice' }, { date: ' 2027-08-15 ', name: 'Independence Day', optional: true },
  ]
  await both(L, 'santosh', 'POST', '/holidays/import', { rows: hrows })
  await both(L, 'santosh', 'POST', '/holidays/import', { rows: hrows, mode: 'commit' })
  await both(L, 'santosh', 'POST', '/holidays/import', { rows: [hrows[0], hrows[5]], mode: 'commit' })
  await both(L, 'santosh', 'GET', '/holidays', undefined, { year: '2027' })
  // cost rates (maker-checker on in Seereon, off in Kalinga)
  L = 'rc-rates'
  await both(L, 'hritesh', 'POST', '/cost-rates', { user_id: 'u_hritesh' })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_nope' })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_hritesh', monthly_ctc_paise: 0 })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_hritesh', monthly_ctc_paise: 2e10 })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_hritesh', monthly_ctc_paise: 7500000, variable_pct: 60 })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_hritesh', monthly_ctc_paise: 7500000, effective_from: '2026-08-15' })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_hritesh', monthly_ctc_paise: 7500000, effective_from: '2026-04-01' })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_baishali', monthly_ctc_paise: 4400000, effective_from: '2026-09-01', sales_target_paise: -5 })
  const cr = await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_baishali', monthly_ctc_paise: 4400000, variable_pct: 10, effective_from: '2026-09-01' })
  await both(L, 'santosh', 'POST', '/cost-rates', { user_id: 'u_baishali', monthly_ctc_paise: 4500000, effective_from: '2026-12-01' })
  await approve(L, 'debasish', cr)
  await both(L, 'santosh', 'GET', '/cost-rates')
  await both(L, 'ananya', 'POST', '/cost-rates', { user_id: 'u_k_meera', monthly_ctc_paise: 5000000, effective_from: '2026-12-01', sales_target_paise: '' })
  const kcr = await both(L, 'ananya', 'POST', '/cost-rates', { user_id: 'u_k_sneha', monthly_ctc_paise: 4000000, effective_from: '2027-01-01' })
  await both(L, 'ananya', 'GET', '/cost-rates')
  await bothSides(L, 'ananya', 'DELETE', (s) => `/cost-rates/${id(kcr, (d) => d?.result?.id)(s)}`)
  await both(L, 'santosh', 'DELETE', '/cost-rates/r_000c')
  // exports & onboarding (Kalinga)
  L = 'rc-export'
  await both(L, 'rakesh', 'POST', '/exports')
  const ex = await both(L, 'ananya', 'POST', '/exports')
  await both(L, 'ananya', 'GET', '/exports')
  await bothSides(L, 'ananya', 'GET', (s) => `/exports/${id(ex, (d) => d?.id)(s)}/download`)
  await both(L, 'ananya', 'POST', '/exports')
  await both(L, 'ananya', 'POST', '/exports')
  await both(L, 'ananya', 'POST', '/exports')
  await both(L, 'ananya', 'GET', '/onboarding')
  await both(L, 'ananya', 'POST', '/onboarding/dismiss')
  await both(L, 'ananya', 'GET', '/onboarding')
  await both(L, 'ananya', 'POST', '/onboarding/restore')
  await both(L, 'ananya', 'POST', '/onboarding/sample')
  // a brand-new workspace: sample data
  {
    const body = { company: 'Sample Labs', name: 'Meghna Rao', email: 'meghna@samplelabs.example', password: 'Widgets are great 99' }
    if (inScope('POST', '/onboarding/sample')) {
      const m = await mockCall('', 'POST', '/auth/signup', body)
      const h = await httpCall('', 'POST', '/auth/signup', body)
      mockTok.fresh = (m.data as { token?: string })?.token ?? ''
      httpTok.fresh = (h.data as { token?: string })?.token ?? ''
      // POST /onboarding/sample is not called: the TS sample users have no role_key, which PostgreSQL refuses (NOT NULL);
      // the Node reference and this API both answer 500 there while the in-browser mock answers 200 (TS bug, mirrored).
      await both(L, 'fresh', 'GET', '/onboarding')
      await both(L, 'fresh', 'GET', '/users')
      await both(L, 'fresh', 'GET', '/holidays')
      await both(L, 'fresh', 'GET', '/cost-rates')
      await both(L, 'fresh', 'GET', '/setup/status')
    }
  }

  /* ------------------------------------------------ hr ------------------------------------------------ */
  L = 'rc-leave'
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'vacation' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: 'x' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-17', to_on: '2026-11-16', reason: 'Family function' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-16', to_on: '2027-02-16', reason: 'Long trip abroad' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-08-03', reason: 'Back dated' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-16', reason: 'abc' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-15', reason: 'Sunday leave' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'optional_holiday', from_on: '2026-11-16', reason: 'Not optional' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'sick', from_on: '2026-11-16', to_on: '2026-12-04', reason: 'Long illness' })
  const lr = await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-16', to_on: '2026-11-17', reason: ' Family function ' })
  await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'casual', from_on: '2026-11-17', reason: 'Overlapping' })
  const lr2 = await both(L, 'hritesh', 'POST', '/leave-requests', { type: 'sick', portion: 'half', from_on: '2026-11-24', to_on: '2026-11-30', reason: 'Dentist visit' })
  await both(L, 'santosh', 'POST', '/leave-requests', { type: 'lwp', from_on: '2026-11-18', to_on: '2026-11-19', reason: 'Personal work' })
  await both(L, 'hritesh', 'GET', '/leave-requests')
  await both(L, 'subhankar', 'GET', '/leave-requests')
  await bothSides(L, 'hritesh', 'POST', (s) => `/leave-requests/${id(lr, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'priya', 'POST', (s) => `/leave-requests/${id(lr, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'subhankar', 'POST', (s) => `/leave-requests/${id(lr, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'subhankar', 'POST', (s) => `/leave-requests/${id(lr, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'subhankar', 'POST', (s) => `/leave-requests/${id(lr2, (d) => d?.id)(s)}/reject`, { reason: 'no' })
  await bothSides(L, 'subhankar', 'POST', (s) => `/leave-requests/${id(lr2, (d) => d?.id)(s)}/reject`, { reason: 'Clashes with the release' })
  await both(L, 'subhankar', 'POST', '/leave-requests/r_01i9/approve')
  await both(L, 'santosh', 'POST', '/leave-requests/r_01ia/approve')
  await both(L, 'bijaya', 'POST', '/leave-requests/r_01i8/cancel')
  await both(L, 'hritesh', 'POST', '/leave-requests/r_01i8/cancel')
  await both(L, 'pragyasmita', 'POST', '/leave-requests/r_01ib/cancel')
  await both(L, 'subham', 'POST', '/leave-requests/r_01ih/cancel')
  await bothSides(L, 'hritesh', 'POST', (s) => `/leave-requests/${id(lr, (d) => d?.id)(s)}/cancel`)
  await both(L, 'hritesh', 'GET', '/leave-requests')
  await both(L, 'priya', 'GET', '/leave/taken')
  await both(L, 'subhankar', 'GET', '/leave/taken', undefined, { fy: '2025' })
  await both(L, 'hritesh', 'PUT', '/leave-policies/casual', { annual_days: 10 })
  await both(L, 'priya', 'PUT', '/leave-policies/lwp', { annual_days: 10 })
  await both(L, 'priya', 'PUT', '/leave-policies/casual', { annual_days: 10.25, carry_forward_max: 0 })
  await both(L, 'priya', 'PUT', '/leave-policies/casual', { annual_days: 10, carry_forward_max: 61 })
  await both(L, 'priya', 'PUT', '/leave-policies/casual', { annual_days: 14, carry_forward_max: 3, accrual: 'monthly' }, undefined, 9)
  await both(L, 'priya', 'PUT', '/leave-policies/casual', { annual_days: 14, carry_forward_max: 3, accrual: 'monthly' })
  await both(L, 'priya', 'PUT', '/leave-policies/compensatory', { annual_days: 0, carry_forward_max: 0 })
  await both(L, 'hritesh', 'GET', '/leave-requests')
  // goals & feedback
  L = 'rc-goals'
  await both(L, 'hritesh', 'POST', '/goals', { title: 'abc' })
  await both(L, 'hritesh', 'POST', '/goals', { user_id: 'u_bijaya', title: 'Peer goal' })
  await both(L, 'hritesh', 'POST', '/goals', { cycle_id: 'ac_h2_fy2526', title: 'Closed cycle goal', weight: 10, target: 5, due_on: '2026-12-01' })
  await both(L, 'hritesh', 'POST', '/goals', { cycle_id: 'ac_h1_fy2627', title: 'One more goal', weight: 10, target: 5, due_on: '2026-12-01' })
  await both(L, 'hritesh', 'POST', '/goals', { title: 'Learn FastAPI', weight: 4, target: 5, due_on: '2026-12-01' })
  await both(L, 'hritesh', 'POST', '/goals', { title: 'Learn FastAPI', weight: 20, target: 0, due_on: '2026-12-01' })
  await both(L, 'hritesh', 'POST', '/goals', { title: 'Learn FastAPI', weight: 20, target: 5, due_on: '2026-13-01' })
  const g1 = await both(L, 'hritesh', 'POST', '/goals', { title: ' Learn FastAPI ', kra: '', weight: 20, measure: 'modules', target: 5, unit: 'modules', due_on: '2026-12-01' })
  const g2 = await both(L, 'subhankar', 'POST', '/goals', { user_id: 'u_hritesh', title: 'Mentor interns', weight: 30, target: 2, unit: 'people', due_on: '2026-12-15' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { current: 2 })
  await bothSides(L, 'hritesh', 'POST', (s) => `/goals/${id(g1, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'bijaya', 'POST', (s) => `/goals/${id(g1, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'subhankar', 'POST', (s) => `/goals/${id(g1, (d) => d?.id)(s)}/approve`)
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { current: -1 })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { current: 5 })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { status: 'achieved' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { status: 'sleeping' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { title: 'Renamed goal' })
  await bothSides(L, 'subhankar', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { weight: 90 })
  await bothSides(L, 'subhankar', 'PATCH', (s) => `/goals/${id(g1, (d) => d?.id)(s)}`, { status: 'at_risk', title: 'Learn FastAPI well' }, undefined)
  await bothSides(L, 'hritesh', 'DELETE', (s) => `/goals/${id(g2, (d) => d?.id)(s)}`)
  await bothSides(L, 'subhankar', 'DELETE', (s) => `/goals/${id(g2, (d) => d?.id)(s)}`)
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_hritesh' })
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_bijaya', kind: 'gossip' })
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_bijaya', kind: 'praise', visibility: 'all' })
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_bijaya', kind: 'one_on_one', visibility: 'private' })
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_bijaya', kind: 'praise', visibility: 'public', body: 'short' })
  await both(L, 'hritesh', 'POST', '/feedback', { to_user_id: 'u_bijaya', kind: 'praise', visibility: 'public', body: ' Great work on the payroll API this week! ' })
  await both(L, 'subhankar', 'POST', '/feedback', { to_user_id: 'u_hritesh', kind: 'one_on_one', visibility: 'manager', body: 'Discussed growth plan and FastAPI learning.' })
  await both(L, 'hritesh', 'GET', '/performance/me')
  await both(L, 'subhankar', 'GET', '/performance/u_hritesh', undefined, { from: '2026-04-01', to: '2026-09-30' })
  await both(L, 'hritesh', 'GET', '/performance/u_subhankar')
  await both(L, 'priya', 'GET', '/performance/u_bijaya', undefined, { from: 'bad' })
  // appraisals
  L = 'rc-appraisals'
  await both(L, 'hritesh', 'POST', '/appraisal-cycles', { name: 'X' })
  await both(L, 'priya', 'POST', '/appraisal-cycles', { name: 'h1 fy26-27' })
  await both(L, 'priya', 'POST', '/appraisal-cycles', { name: 'H2 FY26-27', period_from: '2026-10-01' })
  const cyc = { name: 'H2 FY26-27', period_from: '2026-10-01', period_to: '2027-03-31', self_due: '2027-04-10', manager_due: '2027-04-20', hr_due: '2027-04-30' }
  await both(L, 'priya', 'POST', '/appraisal-cycles', { ...cyc, period_to: '2026-09-01' })
  await both(L, 'priya', 'POST', '/appraisal-cycles', { ...cyc, manager_due: '2027-04-01' })
  await both(L, 'priya', 'POST', '/appraisal-cycles', { ...cyc, weights: { goals: 40, tasks: 30, timesheets: 10, behaviour: 10 } })
  await both(L, 'priya', 'POST', '/appraisal-cycles', { ...cyc, weights: { goals: 40.5, tasks: 30, timesheets: 10, behaviour: 19.5 } })
  const c2 = await both(L, 'priya', 'POST', '/appraisal-cycles', { ...cyc, weights: { goals: 40, tasks: 30, timesheets: 10, behaviour: 20 } })
  await bothSides(L, 'priya', 'POST', (s) => `/appraisal-cycles/${id(c2, (d) => d?.id)(s)}/launch`, {})
  await bothSides(L, 'priya', 'POST', (s) => `/appraisal-cycles/${id(c2, (d) => d?.id)(s)}/close`)
  await both(L, 'priya', 'POST', '/appraisal-cycles/ac_h1_fy2627/close')
  await both(L, 'priya', 'POST', '/appraisal-cycles/ac_h2_fy2526/close')
  await both(L, 'priya', 'POST', '/appraisal-cycles/ac_h1_fy2627/launch')
  await both(L, 'priya', 'GET', '/appraisal-cycles')
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_hritesh/manager', { rating: 4, comments: 'Delivered the payroll engine well; improve estimates.' })
  await both(L, 'hritesh', 'POST', '/appraisals/apr_h1_hritesh/self', { rating: 4, comments: 'Shipped payroll; want to grow into tech lead role.' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_bijaya/send-back', { reason: 'Add concrete examples to the review.' })
  await both(L, 'pragyasmita', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4, comments: 'x'.repeat(40) })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4.5, comments: 'x'.repeat(40) })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4, comments: 'too short' })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4, comments: 'Delivered the payroll engine well; improve estimates.' }, undefined, 99)
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4, comments: ' Delivered the payroll engine well; improve estimates. ' })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/manager', { rating: 4, comments: 'Delivered the payroll engine well; improve estimates.' })
  await both(L, 'pragyasmita', 'GET', '/appraisals/apr_h1_pragyasmita')
  await both(L, 'subhankar', 'GET', '/appraisals/apr_h1_pragyasmita')
  await both(L, 'priya', 'GET', '/appraisals/apr_h1_pragyasmita')
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_pragyasmita/send-back', { reason: 'short' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_pragyasmita/send-back', { reason: 'Add concrete examples to the review.' })
  await both(L, 'pragyasmita', 'POST', '/appraisals/apr_h1_pragyasmita/send-back', { reason: 'Please expand the self review a bit.' })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/send-back', { reason: 'Please expand the self review a bit.' })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/send-back', { reason: 'Please expand the self review a bit.' })
  await both(L, 'pragyasmita', 'GET', '/appraisals/apr_h1_pragyasmita')
  await both(L, 'pragyasmita', 'POST', '/appraisals/apr_h1_pragyasmita/self', { rating: 6, comments: 'x' })
  await both(L, 'pragyasmita', 'POST', '/appraisals/apr_h1_pragyasmita/self', { rating: 4, comments: 'short' })
  await both(L, 'subhankar', 'POST', '/appraisals/apr_h1_pragyasmita/self', { rating: 4, comments: 'Shipped the app; want to grow into a tech lead role.' })
  await both(L, 'pragyasmita', 'POST', '/appraisals/apr_h1_pragyasmita/self', { rating: 4, comments: 'Shipped the app; want to grow into a tech lead role.' })
  await both(L, 'subham', 'POST', '/appraisals/apr_h1_subham/self', { rating: 3, comments: 'Closed two deals; want to improve proposal quality.' })
  await both(L, 'santosh', 'POST', '/appraisals/apr_h1_subham/manager', { rating: 3, comments: 'Good first half, needs more pipeline discipline.' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subham/hr', { rating: 1, increment_pct: 5, comments: 'ok' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subham/hr', { rating: 3, increment_pct: 4, comments: 'Calibrated against the sales team.' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subhankar/hr', { rating: 3.25, increment_pct: 5 })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subhankar/hr', { rating: 3.5, increment_pct: 55 })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subhankar/hr', { rating: 4.5, increment_pct: 7.25, promotion_to: ' Delivery head ', comments: 'Calibrated with leadership.' })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_subhankar/hr', { rating: 3.5, increment_pct: 7 })
  await both(L, 'priya', 'POST', '/appraisals/apr_h1_priya/hr', { rating: 4, increment_pct: 5 })
  await both(L, 'santosh', 'POST', '/appraisals/apr_h1_baishali/manager', { rating: 5, comments: 'Built the pipeline from scratch this half.' })
  await both(L, 'hritesh', 'GET', '/appraisals/apr_h1_bijaya')
  await both(L, 'bijaya', 'GET', '/appraisals/apr_h1_bijaya')
  await both(L, 'priya', 'GET', '/appraisals')
  await both(L, 'subhankar', 'GET', '/appraisals', undefined, { cycle_id: 'ac_h2_fy2526' })
  await both(L, 'hritesh', 'GET', '/appraisals')
  await both(L, 'santosh', 'GET', '/cost-rates')
  // recruitment
  L = 'rc-recruit'
  await both(L, 'hritesh', 'POST', '/candidates', { opening_id: 'r_013s' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_nope' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'K' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'kiran@', source: 'linkedin' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'kiran@x.in', source: 'tv' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'kiran@x.in', source: 'linkedin', experience_years: 51 })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'kiran@x.in', source: 'linkedin', current_ctc_paise: 1.5 })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'kiran@x.in', source: 'linkedin', notice_days: 200 })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: 'Kiran', email: 'SOURAV.MISHRA@gmail.com', source: 'linkedin' })
  const cand = await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013s', name: ' Kiran Sahu ', email: ' Kiran@X.in ', source: 'referral', experience_years: '3', current_ctc_paise: '', expected_ctc_paise: 600000, notice_days: 30, notes: ' strong ' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}`, { rating: 0 })
  await bothSides(L, 'priya', 'PATCH', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}`, { rating: 4, phone: ' 99 ', joining_on: null, notice_days: '' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/resume`, { name: 'cv.pdf' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/resume`, { name: 'cv.pdf', data_url: 'data:application/pdf;base64,JVBERi0xLjQK', size_bytes: 9e6 })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/resume`, { name: 'cv.pdf', mime: 'application/pdf', data_url: 'data:application/pdf;base64,JVBERi0xLjQK', size_bytes: 9 })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/interviews`, { kind: 'chat' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/interviews`, { kind: 'technical', scheduled_at: 'soon' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/interviews`, { kind: 'technical', scheduled_at: '2026-11-20T10:00:00Z', interviewer_id: 'u_ankit' })
  const iv = await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/interviews`, { kind: 'technical', scheduled_at: '2026-11-20T10:00:00.000Z', interviewer_id: 'u_hritesh' })
  await bothSides(L, 'bijaya', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'pass' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'maybe' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'pass', rating: 6, feedback: 'x' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'pass', rating: 4, feedback: 'short' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'no_show', rating: '' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'offer' })
  await bothSides(L, 'hritesh', 'PATCH', (s) => `/interviews/${id(iv, (d) => d?.id)(s)}`, { result: 'pass', rating: '4', feedback: 'Solid testing fundamentals.' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'limbo' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'hired', joining_on: '2026-12-01' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'offer', offer_ctc_paise: 0 })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'offer', offer_ctc_paise: 650000 })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'offer' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'hired' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'hired', joining_on: '2026-12-01' })
  await bothSides(L, 'priya', 'POST', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}/move`, { stage: 'rejected', reason: 'changed mind' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}`, { name: 'Kiran S' })
  await bothSides(L, 'priya', 'GET', (s) => `/candidates/${id(cand, (d) => d?.id)(s)}`)
  await both(L, 'priya', 'POST', '/candidates/cand_qa_1/move', { stage: 'interview' })
  await both(L, 'priya', 'POST', '/candidates/cand_qa_2/move', { stage: 'withdrawn', reason: 'x' })
  await both(L, 'priya', 'POST', '/candidates/cand_qa_2/move', { stage: 'withdrawn', reason: 'Took another offer' })
  await both(L, 'priya', 'POST', '/candidates/cand_qa_2/interviews', { kind: 'hr', scheduled_at: '2026-11-21T09:30:00Z', interviewer_id: 'u_priya' })
  await both(L, 'priya', 'POST', '/candidates/cand_fl_1/move', { stage: 'hired', joining_on: '2026-11-23' })
  await both(L, 'priya', 'POST', '/candidates', { opening_id: 'r_013u', name: 'Late', email: 'late@x.in', source: 'other' })
  await both(L, 'priya', 'GET', '/recruitment')
  // lifecycle
  L = 'rc-lifecycle'
  await both(L, 'hritesh', 'POST', '/lifecycle', {})
  await both(L, 'priya', 'POST', '/lifecycle', { person_id: 'nobody' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'r_000x' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_priya' })
  await both(L, 'priya', 'POST', '/lifecycle', { person_id: 'r_000x', start_on: '2026-11-01' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_pragyasmita', start_on: 'x' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_pragyasmita', start_on: '2026-10-01', last_day: '2026-09-01' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_pragyasmita', start_on: '2026-10-01', last_day: '2026-10-10', exit_type: 'fired' })
  await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_pragyasmita', start_on: '2026-10-01', last_day: '2026-10-10', exit_type: 'resignation', exit_reason: 'x' })
  const off = await both(L, 'priya', 'POST', '/lifecycle', { kind: 'offboarding', person_id: 'u_pragyasmita', start_on: '2026-10-01', last_day: '2026-10-10', exit_type: 'resignation', exit_reason: 'Higher studies', rehire_eligible: 1 })
  const onb = await both(L, 'priya', 'POST', '/lifecycle', { person_id: 'u_subham', start_on: '2026-10-01' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/lifecycle/${id(onb, (d) => d?.id)(s)}`, { last_day: '2026-12-01' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}`, { last_day: '2026-09-01' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}`, { last_day: '2026-10-12', exit_reason: ' Masters abroad ', rehire_eligible: null }, undefined)
  await bothSides(L, 'hritesh', 'POST', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}/items/notice`, { done: true })
  await bothSides(L, 'subhankar', 'POST', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}/items/notice`, { done: true })
  await bothSides(L, 'subhankar', 'POST', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}/items/nope`, { done: true })
  await bothSides(L, 'priya', 'POST', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}/items/asset_return`, { done: true })
  await both(L, 'priya', 'POST', '/assets/r_01lg/return', { status: 'repair', note: ' screen cracked ' })
  for (const it of ['resignation', 'kt', 'exit_interview', 'asset_return', 'access', 'fnf', 'experience_letter'])
    await bothSides(L, 'priya', 'POST', (s) => `/lifecycle/${id(off, (d) => d?.id)(s)}/items/${it}`, { done: true })
  await both(L, 'pragyasmita', 'GET', '/me')
  await bothSides(L, 'priya', 'POST', (s) => `/lifecycle/${id(onb, (d) => d?.id)(s)}/items/laptop`, { done: 1 })
  await bothSides(L, 'subham', 'POST', (s) => `/lifecycle/${id(onb, (d) => d?.id)(s)}/items/policies`, { done: true })
  await bothSides(L, 'subham', 'POST', (s) => `/lifecycle/${id(onb, (d) => d?.id)(s)}/items/policies`, { done: false })
  await both(L, 'priya', 'POST', '/lifecycle/r_01kx/items/fnf', { done: true })
  await both(L, 'priya', 'GET', '/lifecycle')
  // assets
  L = 'rc-assets'
  await both(L, 'hritesh', 'POST', '/assets', {})
  await both(L, 'priya', 'POST', '/assets', { tag: 'x' })
  await both(L, 'priya', 'POST', '/assets', { tag: 'see-lap-001' })
  await both(L, 'priya', 'POST', '/assets', { tag: 'SEE-LAP-099', name: 'D' })
  await both(L, 'priya', 'POST', '/assets', { tag: 'SEE-LAP-099', name: 'Dell', category: 'car' })
  await both(L, 'priya', 'POST', '/assets', { tag: 'SEE-LAP-099', name: 'Dell', category: 'laptop', purchase_on: '2099-01-01' })
  await both(L, 'priya', 'POST', '/assets', { tag: 'SEE-LAP-099', name: 'Dell', category: 'laptop', purchase_on: '2026-01-01', purchase_cost_paise: 1.5 })
  const as = await both(L, 'priya', 'POST', '/assets', { tag: ' see-lap-099 ', name: ' Dell Latitude 5440 ', category: 'laptop', purchase_on: '2026-01-01', purchase_cost_paise: 7500000, warranty_until: '2026-02-01', serial: ' SN1 ' })
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/assign`, { user_id: 'u_ankit' })
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/assign`, { user_id: 'u_hritesh' })
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/assign`, { user_id: 'u_hritesh' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/assets/${id(as, (d) => d?.id)(s)}`, { status: 'retired' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/assets/${id(as, (d) => d?.id)(s)}`, { status: 'assigned' })
  await bothSides(L, 'hritesh', 'GET', (s) => `/assets/${id(as, (d) => d?.id)(s)}/history`)
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/return`, { note: 'upgrade' })
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/return`, {})
  await bothSides(L, 'priya', 'PATCH', (s) => `/assets/${id(as, (d) => d?.id)(s)}`, { status: 'repair', tag: 'SEE-LAP-002' })
  await bothSides(L, 'priya', 'PATCH', (s) => `/assets/${id(as, (d) => d?.id)(s)}`, { status: 'repair', warranty_until: '', notes: ' fan noise ' }, undefined)
  await bothSides(L, 'priya', 'POST', (s) => `/assets/${id(as, (d) => d?.id)(s)}/assign`, { user_id: 'u_hritesh' })
  await both(L, 'priya', 'PATCH', '/assets/r_01l4', { status: 'lost' })
  await both(L, 'hritesh', 'GET', '/assets')
  await both(L, 'priya', 'GET', '/assets')
  await both(L, 'priya', 'GET', '/hr/dashboard')
  await both(L, 'santosh', 'GET', '/hr/dashboard')
  await both(L, 'hritesh', 'GET', '/hr/dashboard')
}
