// DB fixtures for the engine golden tests (analytics, performance, approval_kpi, workflows — and costing may reuse
// them): the real demo seed + mid-suite snapshots harvested by B1 (scratchpad/be/harvest/*.json, the mock DB after
// running an API suite), pruned to the tables the engines read or write, gzipped.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/engine_db.mjs [harvest dir]
// -> backend/tests/golden/vectors/engine_db/<name>.json.gz  ({ name, day, tables })
// The vectors are computed from these files (not from today's seed), so tests stay valid when the seed moves.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ROOT } from '../../../tools/_bundle.mjs'

export const KEEP = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/tests/golden/gen/engine_db.tables.json'), 'utf8'))
const OUT = path.join(ROOT, 'backend/tests/golden/vectors/engine_db')
const HARVEST = process.argv[2] ?? '/tmp/claude-0/-home-claude/2b2307b6-a093-5b80-9529-4063edf8f600/scratchpad/be/harvest'

function write(name, day, all) {
  const tables = {}
  for (const k of KEEP) tables[k] = all[k] ?? []
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, name + '.json.gz'), zlib.gzipSync(JSON.stringify({ name, day, tables }), { level: 9 }))
  console.log(name, day, Object.values(tables).reduce((s, t) => s + t.length, 0), 'rows')
}

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/var/seed.json'), 'utf8'))
write('seed', seed.generated_on, seed.tables)
// harvested on 2026-10-14 (the suites ran against that day's demo seed)
for (const h of ['escC', 't2_t_states', 'smokeC']) write(h, '2026-10-14', JSON.parse(fs.readFileSync(path.join(HARVEST, h + '.json'), 'utf8')))
