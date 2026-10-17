// Golden vectors for the pure helpers exported by the RC route modules (src/mock/routes/access.ts, master.ts):
// withDependencies, cleanPermissions, permLabel, diffSummary, isAccessAdmin, formatEmployeeCode — computed by the
// TypeScript on every permission key, every seed role (all tenants) and edge cases.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/rc_people.mjs -> tests/golden/vectors/rc_people.json
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, importTs, writeJson } from '../../../tools/_bundle.mjs'

const M = await importTs(null, {
  name: 'rc_people',
  contents: `
export * as access from '@/mock/routes/access'
export * as master from '@/mock/routes/master'
export * as pc from '@/domain/permissionCatalog'
`,
})
const { access, master, pc } = M
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/var/seed.json'), 'utf8')).tables
const safe = (f) => {
  try {
    const v = f()
    return v === undefined ? { undef: true } : { v }
  } catch (e) {
    return { throws: { status: e.status ?? null, code: e.code ?? null, message: String(e.message), field: e.field ?? null } }
  }
}
// deterministic pseudo-random subsets of the catalogue
let s = 42
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
const keys = pc.PERMISSION_KEYS
const subsets = [[], ...keys.map((k) => [k])]
for (let i = 0; i < 120; i++) subsets.push(keys.filter(() => rnd() < 0.15 + (i % 5) * 0.1))
const roleLists = seed.roles.map((r) => r.permissions)
const lists = [...subsets, ...roleLists]
const out = { withDependencies: [], cleanPermissions: [], permLabel: [], diffSummary: [], isAccessAdmin: [], formatEmployeeCode: [] }
for (const l of lists) out.withDependencies.push({ in: l, out: safe(() => access.withDependencies([...l])) })
const cleanInputs = [
  ...lists.slice(0, 60),
  'tasks.edit', null, 7, {}, [1], [null], ['nope'], ['a', 'b', 'c', 'd', 'e', 'f'], ['users.view', 'users.view', 'roles.view'], ['x', 'users.view'], [true, false],
  ['zeta', 'alpha', 3, 'users.manage', 'users.view'],
]
for (const inp of cleanInputs) {
  out.cleanPermissions.push({ in: inp, field: 'permissions', out: safe(() => access.cleanPermissions(inp)) })
  out.cleanPermissions.push({ in: inp, field: 'extra_permissions', out: safe(() => access.cleanPermissions(inp, 'extra_permissions')) })
}
for (const k of [...keys, 'nope', '', 'x.y']) out.permLabel.push({ in: k, out: safe(() => access.permLabel(k)) })
for (let i = 0; i < lists.length; i++)
  for (const j of [0, 7, (i * 13) % lists.length]) out.diffSummary.push({ a: lists[i], b: lists[j], out: safe(() => access.diffSummary(lists[i], lists[j])) })
for (const l of lists) out.isAccessAdmin.push({ in: l, out: safe(() => access.isAccessAdmin(l)) })
for (const p of ['EMP', 'SCI', 'KS', 'A', 'X1', ''])
  for (const n of [0, 1, 7, 12, 99, 100, 999, 1000, 12345, 1.5]) out.formatEmployeeCode.push({ p, n, out: safe(() => master.formatEmployeeCode(p, n)) })
writeJson('backend/tests/golden/vectors/rc_people.json', out, { pretty: false })
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])))
