// Shared harness for engine golden generators: the TypeScript mock running over a seed JSON (setStore), contexts with
// pinned ctx.today / explicit permission sets, deterministic ids, timestamp normalisation, gzip vector output.
// The Python side mirrors it in tests/golden/memdb.py.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ROOT, importTs } from '../../../tools/_bundle.mjs'

export const VECTORS = path.join(ROOT, 'backend/tests/golden/vectors')

/** bundle the given TS re-exports (`export * as x from '@/…'` lines) + the mock server */
export async function loadTs(name, contents) {
  return importTs(null, { name, contents: `export * as server from '@/mock/server'\n${contents}` })
}

export function readSeed() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/var/seed.json'), 'utf8'))
}

/** writes vectors/<name>.json.gz; returns the size */
export function writeGz(name, value) {
  fs.mkdirSync(VECTORS, { recursive: true })
  const buf = zlib.gzipSync(JSON.stringify(value), { level: 9 })
  fs.writeFileSync(path.join(VECTORS, name), buf)
  return buf.length
}

/** a fresh deep copy of the seed tables installed as the mock store; ids are deterministic (`gid<n>`) */
export function install(server, seedTables) {
  const db = structuredClone(seedTables)
  for (const k of ['sessions', 'login_attempts', 'reset_tokens', 'passwords']) db[k] ??= []
  let n = 0
  server.setStore({ getDb: () => db, persist() {}, uid: (prefix) => `${prefix}gid${++n}` })
  return db
}

export function makeCtx(server, db, userId, perms, today) {
  const user = db.users.find((u) => u.id === userId)
  const tenant = db.tenants.find((t) => t.id === user.tenant_id)
  return { user, tenant, role: user.role, realRole: user.role, viewAs: null, roleKey: user.role_key, perms: new Set(perms), grants: [], isSuper: !!user.is_super_admin, today, warnings: [] }
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
/** JSON value with ISO timestamps replaced by <ts>; undefined -> {undef:true}; errors -> {throws} */
export function norm(v) {
  return JSON.parse(JSON.stringify(v === undefined ? { $undef: true } : v, (k, x) => (typeof x === 'string' ? x.replace(ISO, '<ts>') : typeof x === 'number' && !Number.isFinite(x) ? `$num:${x}` : x)))
}
export function safe(f) {
  try {
    return { v: norm(f()) }
  } catch (e) {
    if (e && e.status) return { err: { status: e.status, code: e.code, message: e.message, field: e.field ?? null } }
    return { throws: String(e && e.message) }
  }
}
