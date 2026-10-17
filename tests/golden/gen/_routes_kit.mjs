// Route-scenario kit for route-module golden generators (gen/spend.mjs, clients.mjs, finance.mjs, estimates.mjs):
// a frozen clock (every new Date() / Date.now() is the same instant, so timestamp sorts keep insertion order), the
// route handlers of the given TS modules captured from register(), and scenario(): a fresh seed copy, setup ops, a
// sequence of route calls / direct function calls by given users (pinned today), recording every response, the
// warnings and the rows written per table. The Python replay is tests/golden/route_kit.py.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { VECTORS, install, makeCtx, norm, safe } from './_engine.mjs'

const RealDate = Date
export const FIXED = RealDate.parse('2026-10-15T06:30:00.000Z')
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (a.length) super(...a)
    else super(FIXED)
  }
  static now() {
    return FIXED
  }
}

export function readEngineSeed() {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(VECTORS, 'engine_seed.json.gz'))).toString('utf8'))
}

export function applySetup(db, op) {
  if (op.kind === 'strip') {
    const r = db[op.table].find((x) => x.id === op.id)
    for (const k of op.keys) delete r[k]
  } else if (op.kind === 'set') {
    const r = db[op.table].find((x) => x.id === op.id)
    Object.assign(r, structuredClone(op.values))
  } else if (op.kind === 'settings') {
    const t = db.tenants.find((x) => x.id === op.id)
    t.settings = { ...t.settings, ...op.values }
  } else if (op.kind === 'insert') {
    db[op.table].push(structuredClone(op.row))
  } else if (op.kind === 'delete') {
    db[op.table] = db[op.table].filter((x) => x.id !== op.id)
  }
}

export function kit({ server, T, modules, tables, fns = {} }) {
  const routes = []
  const cap = (method) => (p, h) => routes.push({ method, p, h })
  const r = { get: cap('GET'), post: cap('POST'), put: cap('PUT'), patch: cap('PATCH'), del: cap('DELETE') }
  for (const m of modules) m.register(r)
  const route = (method, p) => {
    const x = routes.find((y) => y.method === method && y.p === p)
    if (!x) throw new Error(`no route ${method} ${p}`)
    return x.h
  }
  const perms = (db, uid) => server.permissionsOf(db.users.find((u) => u.id === uid))
  const keyOf = (row) => JSON.stringify(norm(row))
  const mine = (db, t, tid) => (db[t] ?? []).filter((x) => (t === 'tenants' ? x.id === tid : x.tenant_id === tid))
  return {
    routes,
    scenario(name, tid, today, build, setup = []) {
      const db = install(server, T)
      for (const op of setup) applySetup(db, op)
      const before = {}
      for (const t of tables) before[t] = new Map(mine(db, t, tid).map((x) => [x.id ?? JSON.stringify(x), keyOf(x)]))
      const steps = []
      const ctxOf = (uid, po) => makeCtx(server, db, uid, po ?? perms(db, uid), today)
      const api = {
        db,
        call(uid, method, p, { params = {}, query = {}, body = {}, ifMatch, perms: po } = {}) {
          const ctx = ctxOf(uid, po)
          const res = safe(() => route(method, p)({ ctx, params, query, body: structuredClone(body), ifMatch, headers: {} }))
          steps.push({ op: 'call', uid, perms: [...ctx.perms], method, p, params, query, body, ifMatch: ifMatch ?? null, res, warnings: ctx.warnings })
          return res
        },
        fn(uid, name, args = {}, po) {
          const ctx = ctxOf(uid, po)
          const res = safe(() => fns[name](ctx, args))
          steps.push({ op: 'fn', uid, perms: [...ctx.perms], name, args, res, warnings: ctx.warnings })
          return res
        },
      }
      build(api)
      const diff = {}
      for (const t of tables) {
        const now = mine(db, t, tid)
        const ids = new Set(now.map((x) => x.id ?? JSON.stringify(x)))
        diff[t] = { changed: norm(now.filter((x) => before[t].get(x.id ?? JSON.stringify(x)) !== keyOf(x))), removed: [...before[t].keys()].filter((i) => !ids.has(i)) }
      }
      return { name, tenant: tid, today, setup, steps, diff }
    },
  }
}
