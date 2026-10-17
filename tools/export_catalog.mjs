// Exports every shared constant the Python API needs from the TypeScript sources (single source of truth) into
// backend/app/catalog/data/<module path>.json, plus generated fixtures (tenant provisioning template).
//   node backend/tools/export_catalog.mjs [--check]
// --check: exits 1 (and lists the files) when the committed JSON differs from a fresh export (also a pytest).
//
// Rules: every exported UPPER_CASE binding of the listed modules whose value is JSON data is written as is (object key
// order preserved; undefined object properties are dropped like JSON.stringify does). A Set becomes an array and is listed under "$types" as "set" (Python: frozenset). Values holding
// functions, Maps, NaN/Infinity or undefined are skipped and listed under "$skipped" with the reason — port those by
// hand. Factories listed in FACTORIES are called with no arguments and written as "name()".
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, importTs } from './_bundle.mjs'

const MODULES = [
  'domain/calendar', 'domain/collate', 'domain/costing', 'domain/delivery', 'domain/fileSafety', 'domain/gst', 'domain/labels', 'domain/money',
  'domain/passwordPolicy', 'domain/permissionCatalog', 'domain/permissions', 'domain/sales', 'domain/totp',
  'types/access', 'api/company', 'reports/datasets', 'reports/planner',
  'mock/analytics', 'mock/approvalKpi', 'mock/costing', 'mock/docMarkup', 'mock/docgen', 'mock/email', 'mock/makerChecker', 'mock/performance',
  'mock/secrets', 'mock/seed', 'mock/twoFactor', 'mock/workflows',
  ...['access', 'admin', 'auth', 'billing', 'clients', 'company', 'dashboards', 'docsV7', 'documents', 'estimates', 'finance', 'hr', 'invoices', 'master',
    'notifications', 'operations', 'payroll', 'people', 'projects', 'reports', 'sales', 'settings', 'spend', 'taskflow', 'tasks', 'timesheets', 'workflowsV7'].map((m) => 'mock/routes/' + m),
  'mock/seeds/access', 'mock/seeds/documentsV7', 'mock/seeds/workflows', 'mock/seeds/master',
  'modules/spend/labels',
]
const FACTORIES = { 'mock/seeds/workflows': ['defaultWfTemplates'] }

const OUT = path.join(ROOT, 'backend/app/catalog/data')

function jsonProblem(v, p = '$', seen = new Set(), inObject = false) {
  if (v === undefined) return inObject ? null : `${p} is undefined` // undefined object properties = absent keys (JSON.stringify drops them)
  if (typeof v === 'function') return `${p} is a function`
  if (typeof v === 'number' && !Number.isFinite(v)) return `${p} is ${v}`
  if (typeof v === 'bigint' || typeof v === 'symbol') return `${p} is a ${typeof v}`
  if (v === null || typeof v !== 'object') return null
  if (v instanceof Map) return `${p} is a Map`
  if (v instanceof Date) return `${p} is a Date`
  if (v instanceof RegExp) return `${p} is a RegExp`
  if (seen.has(v)) return null
  seen.add(v)
  if (v instanceof Set) return [...v].map((x, i) => jsonProblem(x, `${p}[${i}]`, seen)).find(Boolean) ?? null
  if (Array.isArray(v)) return v.map((x, i) => jsonProblem(x, `${p}[${i}]`, seen)).find(Boolean) ?? null
  for (const [k, x] of Object.entries(v)) {
    const r = jsonProblem(x, `${p}.${k}`, seen, true)
    if (r) return r
  }
  return null
}

/** provisioning template: provisionTenant() on an empty DB with placeholder base fields (see app/seeds/provision.py) */
function provisionTemplate(m) {
  const db = {}
  for (const k of m.DB_KEYS) db[k] = []
  const tenant = { id: '$TENANT', name: '$NAME', slug: '$SLUG', status: 'trial', industry: 'it_services', trial_ends_on: null, time_zone: 'Asia/Kolkata', plan_code: 'trial', seats: 5, created_at: '$NOW', logo_data_url: null, theme: { ...m.DEFAULT_THEME }, settings: { ...m.DEFAULT_SETTINGS }, version: 1 }
  db.tenants.push(tenant)
  let n = 0
  m.provisionTenant(db, tenant, () => ({ id: `$ID${n++}`, tenant_id: '$TENANT', created_at: '$NOW', updated_at: '$NOW', created_by: null, version: 1 }))
  const tables = {}
  for (const [k, v] of Object.entries(db)) if (k !== 'tenants' && v.length) tables[k] = v
  return { ids: n, tenant: { maker_checker: tenant.maker_checker, org: tenant.org }, tables }
}

async function exportAll() {
  const imports = MODULES.map((mod, i) => `import * as m${i} from '@/${mod}'`).join('\n')
  const contents = `${imports}
export const mods = { ${MODULES.map((mod, i) => `'${mod}': m${i}`).join(', ')} }
export { provisionTenant } from '@/mock/seeds/access'
export { DEFAULT_SETTINGS, DEFAULT_THEME } from '@/mock/seed'
import { registerAll } from '@/mock/routes'
import { router } from '@/mock/server'
registerAll(router)
`
  const m = await importTs(null, { contents, name: 'catalog' })
  const { DB_KEYS } = await importTs(null, { contents: `export { DB_KEYS } from './ref/tables'`, name: 'tables' })
  const files = {}
  for (const mod of MODULES) {
    const ns = m.mods[mod]
    const out = {}
    const types = {}
    const skipped = {}
    for (const name of Object.keys(ns).sort()) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue
      const v = ns[name]
      const problem = jsonProblem(v)
      if (problem) {
        skipped[name] = problem.replace('$', name)
        continue
      }
      if (v instanceof Set) {
        out[name] = [...v]
        types[name] = 'set'
      } else out[name] = v
    }
    for (const f of FACTORIES[mod] ?? []) {
      const v = ns[f]()
      const problem = jsonProblem(v)
      if (problem) skipped[f + '()'] = problem
      else out[f + '()'] = v
    }
    if (Object.keys(types).length) out.$types = types
    if (Object.keys(skipped).length) out.$skipped = skipped
    files[mod + '.json'] = out
  }
  files['provision/tenant.json'] = provisionTemplate({ ...m, DB_KEYS })
  files['tables.json'] = { DB_KEYS: [...DB_KEYS] }
  return files
}

const files = await exportAll()
const check = process.argv.includes('--check')
const differ = []
for (const [rel, value] of Object.entries(files)) {
  const file = path.join(OUT, rel)
  const text = JSON.stringify(value, null, 1) + '\n'
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) differ.push(rel)
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
}
if (check) {
  if (differ.length) {
    console.error('catalog out of date (run node backend/tools/export_catalog.mjs):\n  ' + differ.join('\n  '))
    process.exit(1)
  }
  console.log(`catalog up to date (${Object.keys(files).length} files)`)
} else console.log(`catalog: ${Object.keys(files).length} files -> ${path.relative(process.cwd(), OUT)}`)
