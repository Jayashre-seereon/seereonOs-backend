// Shared harness of the engine golden generators (analytics, performance, approval_kpi, workflows): runs the
// TypeScript engines in Node over an in-memory mock DB (server.ts setStore) built from the fixtures in
// vectors/engine_db, with a fixed clock and deterministic ids, and records results + side effects.
// The Python twin is tests/golden/engine_env.py — keep the two in step.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ROOT, importTs } from '../../../tools/_bundle.mjs'

/* ---------------- fixed clock: new Date() / Date.now() (nowISO, Date.now ids, fmtDate's "this year") ---------------- */
export const FIXED_ISO = '2026-10-15T06:30:00.000Z'
const RealDate = Date
const FIXED = RealDate.parse(FIXED_ISO)
class FakeDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(FIXED)
    else super(...a)
  }
  static now() {
    return FIXED
  }
}
globalThis.Date = FakeDate

export const M = await importTs(null, {
  name: 'engines',
  contents: `
export * as S from '@/mock/server'
export * as A from '@/mock/analytics'
export * as P from '@/mock/performance'
export * as K from '@/mock/approvalKpi'
export * as W from '@/mock/workflows'
export * as MC from '@/mock/makerChecker'
export * as cal from '@/domain/calendar'
`,
})

const DB_KEYS = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/app/catalog/data/tables.json'), 'utf8')).DB_KEYS
const FIX_DIR = path.join(ROOT, 'backend/tests/golden/vectors/engine_db')
export const FIXTURES = ['seed', 'escC', 't2_t_states', 'smokeC']

export function loadFixture(name) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIX_DIR, name + '.json.gz'))).toString('utf8'))
}

/** a private, mutable DB: the fixture tables with `setup` (table -> full replacement rows) applied */
export function freshDb(fx, setup = {}) {
  const d = JSON.parse(JSON.stringify(fx.tables))
  for (const [t, r] of Object.entries(setup)) d[t] = JSON.parse(JSON.stringify(r))
  for (const k of DB_KEYS) d[k] ??= []
  return d
}

let uidN = 0
/** install `db` as the store of the mock (ids U1, U2, … per case) */
export function install(db) {
  uidN = 0
  M.S.setStore({ getDb: () => db, persist() {}, uid: (p = '') => `${p}U${++uidN}` })
}

/** ctx of a user with today pinned (and View-as) */
export function ctxFor(db, userId, today, viewAs = null) {
  const u = db.users.find((x) => x.id === userId)
  const ctx = M.S.buildCtx(u, u.tenant_id, viewAs ? { 'X-View-As': viewAs } : {})
  ctx.today = today
  return ctx
}

/** result of f(): {v} | {undef: true} | {err: {status, code, message, field?}} | {throws} */
export function capture(f) {
  try {
    const v = f()
    return v === undefined ? { undef: true } : { v: JSON.parse(JSON.stringify(v)) ?? null }
  } catch (e) {
    if (e && typeof e.status === 'number' && typeof e.code === 'string') {
      const o = { status: e.status, code: e.code, message: e.message }
      if (e.field !== undefined) o.field = e.field
      return { err: o }
    }
    return { throws: String(e?.message ?? e) }
  }
}

/** canonical JSON (sorted keys) of a row */
export function canon(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
}

/** row key: id (number_sequences: tenant + scope) */
export const keyOf = (r) => r.id ?? `${r.tenant_id}:${r.scope}`
/** snapshot of tables (id -> canonical JSON) to diff against after side effects */
export function snap(db, tables) {
  const o = {}
  for (const t of tables) o[t] = new Map(db[t].map((r) => [keyOf(r), canon(r)]))
  return o
}
/** {table: {changed: [rows of the tenant, table order], deleted: [ids]}} for tables that changed */
export function diff(before, db, tenantId) {
  const out = {}
  const mine = (t, r) => (t === 'tenants' ? r.id : r.tenant_id) === tenantId
  for (const [t, m] of Object.entries(before)) {
    const now = db[t].filter((r) => mine(t, r))
    const ids = new Set(now.map(keyOf))
    const changed = now.filter((r) => m.get(keyOf(r)) !== canon(r)).map((r) => JSON.parse(JSON.stringify(r)))
    const deleted = [...m.entries()].filter(([id, j]) => !ids.has(id) && mine(t, JSON.parse(j))).map(([id]) => id)
    if (changed.length || deleted.length) out[t] = { changed, deleted }
  }
  return out
}

export function addDays(s, n) {
  return M.cal.addDays(s, n)
}

export function writeGz(name, value) {
  const file = path.join(ROOT, 'backend/tests/golden/vectors', name + '.json.gz')
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value), { level: 9 }))
  const n = JSON.stringify(value).length
  console.log(`${name}: ${(n / 1e6).toFixed(2)} MB raw -> ${(fs.statSync(file).size / 1e3).toFixed(0)} KB`)
}

/** the tenants with data, and per tenant the users (active + deactivated, no platform admins) */
export function tenantsOf(fx) {
  return ['tn_seereon', 'tn_kalinga'].filter((t) => fx.tables.users.some((u) => u.tenant_id === t))
}
export function usersOf(db, tid) {
  return db.users.filter((u) => u.tenant_id === tid && !u.is_super_admin)
}
export function adminOf(db, tid) {
  return usersOf(db, tid).find((u) => u.role_key === 'ceo' && u.status === 'active') ?? usersOf(db, tid).find((u) => u.status === 'active')
}

/* ---------------- case runner ----------------
 * A case = { fixture, tenant, setup?, steps: [{ c?: 'user|today|viewAs', nc?: true, fn: 'A.milestoneState', args, post?, w?: true, wt?: [tables to diff] }] }
 * args: literals, or { $row: [table, id] } | { $undef: 1 } | { $cal: 1 } | { $liveMs: 1 } | { $tasksOf: projectId } | { $prev: stepIndex }
 * Each step gets r (captured result) and, with w, d (side effects on the tenant's rows). */
export const WRITE_TABLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/tests/golden/gen/engine_db.tables.json'), 'utf8'))
const B36_NOW = FIXED.toString(36)
/** generated step ids (Date.now() based) are normalised: they depend on a per-process counter */
export function normIds(v) {
  if (typeof v === 'string') return v.includes(B36_NOW) ? '$genid' : v
  if (Array.isArray(v)) return v.map(normIds)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normIds(x)]))
  return v
}

const POST = {
  entries: (v) => [...v.entries()],
  keys: (v) => [...v.keys()],
  ids: (v) => v.map((r) => r.id),
  costed: (v) => v.map((e) => [e.id, e.week_status, e.approved, e.rate_ph, e.cost]),
  samples: (v) => ({ byPerson: [...v.byPerson.entries()], byCx: [...v.byCx.entries()], byPersonCx: [...v.byPersonCx.entries()], team: v.team }),
  sched: (v) => ({ schedule: v.schedule, msForecast: [...v.msForecast.entries()] }),
  chainEntries: (v) => v,
}

/* pseudo functions implemented on both sides (tests/golden/engine_env.py PSEUDO) */
const PSEUDO = {
  'X.calDays': (ctx, from, n) => Array.from({ length: n }, (_, i) => M.cal.isWorkingDay(M.cal.addDays(from, i), M.A.cal(ctx))),
  'X.withOverride': (ctx, pid, p) => {
    M.A.setProjectMetricsOverride((c, pr, base) => (pr.id === pid ? { health: 'override_' + base.health, planned_cost: base.planned_cost + 1 } : null))
    try {
      return M.A.projectMetrics(ctx, p)
    } finally {
      M.A.setProjectMetricsOverride(null)
    }
  },
  'X.provision': (ctx, tenantId) => {
    let n = 0
    M.W.provisionWorkflows(M.S.getDb(), tenantId, () => ({ id: `B${++n}`, tenant_id: tenantId, created_at: FIXED_ISO, updated_at: FIXED_ISO, created_by: null, version: 1 }))
  },
}

let ROUTES = null
function routes() {
  if (!ROUTES) {
    ROUTES = {}
    const add = (m) => (p, h) => (ROUTES[`${m} ${p}`] = h)
    M.W.register({ get: add('GET'), put: add('PUT'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') })
  }
  return ROUTES
}

function fnOf(name) {
  if (PSEUDO[name]) return PSEUDO[name]
  if (name.startsWith('route:')) {
    const h = routes()[name.slice(6)]
    return (ctx, params, body, ifMatch) => h({ ctx, params, query: {}, body: body === undefined ? {} : JSON.parse(JSON.stringify(body)), ifMatch, headers: {} })
  }
  const [mod, fn] = name.split('.')
  const f = M[mod][fn]
  if (typeof f !== 'function') throw new Error('no function ' + name)
  return f
}

function resolve(a, db, ctx, results) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return a
  if ('$row' in a) return db[a.$row[0]].find((r) => r.id === a.$row[1])
  if ('$undef' in a) return undefined
  if ('$nan' in a) return NaN
  if ('$cal' in a) return M.A.cal(ctx)
  if ('$liveMs' in a) return M.A.liveMilestoneMap(ctx)
  if ('$tasksOf' in a) return M.S.rows(ctx, 'tasks').filter((t) => t.project_id === a.$tasksOf)
  if ('$prev' in a) return JSON.parse(JSON.stringify(results[a.$prev].v ?? null))
  return a
}

export function runCase(fx, kase) {
  const db = freshDb(fx, kase.setup ?? {})
  install(db)
  const ctxs = new Map()
  const results = []
  for (const st of kase.steps) {
    let ctx = null
    if (st.c) {
      if (!ctxs.has(st.c)) {
        const [u, today, va] = st.c.split('|')
        ctxs.set(st.c, ctxFor(db, u, today, va || null))
      }
      ctx = ctxs.get(st.c)
    }
    const before = st.w ? snap(db, st.wt ?? WRITE_TABLES) : null
    const r = capture(() => {
      const args = JSON.parse(JSON.stringify(st.args)).map((a) => resolve(a, db, ctx, results)) // the inputs Python sees
      const f = fnOf(st.fn)
      const v = ctx && !st.nc ? f(ctx, ...args) : f(...args)
      return st.post ? POST[st.post](v) : v
    })
    st.r = normIds(r)
    if (st.w) st.d = normIds(diff(before, db, kase.tenant))
    results.push(r)
  }
  return kase
}

export const c = (u, today, va = '') => `${u}|${today}|${va}`
