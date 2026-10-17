// Exports the demo seed (src/mock/seed.ts buildSeed — the SAME generator the mock and the Node reference use) as JSON
// for the Python loader (python -m app.db.reset / POST /demo/reset).
//   node backend/tools/export_seed.mjs [out.json]      (default backend/var/seed.json)
// Dates in the seed are relative to "today" in the process time zone: run it with the API's TZ (Asia/Kolkata).
// The file keeps every mock table in the mock's key order, rows in array order (= _ord); `passwords` holds the demo
// plaintext passwords (hashed with scrypt by the loader, never stored as given); sessions / login_attempts /
// reset_tokens are dropped exactly like server/db/seed.ts does.
import path from 'node:path'
import { ROOT, importTs, writeJson } from './_bundle.mjs'

const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'backend/var/seed.json'))
const m = await importTs(null, {
  name: 'seed',
  contents: `export { buildSeed } from '@/mock/seed'\nexport { todayISO } from '@/domain/calendar'\n`,
})
const db = m.buildSeed()
// seedMaster re-places users in a microtask once the whole seed ran (server/db/seed.ts awaits before inserting)
await new Promise((r) => setTimeout(r, 0))
const DROP = new Set(['sessions', 'login_attempts', 'reset_tokens'])
const tables = {}
for (const [k, v] of Object.entries(db)) if (!DROP.has(k)) tables[k] = v
writeJson(out, { generated_on: m.todayISO(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, tables }, { pretty: false })
console.log(`seed: ${Object.values(tables).reduce((s, a) => s + a.length, 0)} rows in ${Object.keys(tables).length} tables -> ${path.relative(process.cwd(), out)}`)
