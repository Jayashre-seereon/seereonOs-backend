// Golden vectors for app/engine/approval_kpi.py (port of src/mock/approvalKpi.ts): the KPI map for several windows and
// pinned `today`s, and every person's KPI, on every fixture DB and tenant.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/approval_kpi.mjs -> vectors/approval_kpi.json.gz
import { FIXTURES, addDays, adminOf, c, freshDb, loadFixture, runCase, tenantsOf, usersOf, writeGz } from './_engine_env.mjs'

const cases = []
const fxs = {}
for (const name of FIXTURES) {
  const fx = (fxs[name] = loadFixture(name))
  const D = fx.day
  for (const tid of tenantsOf(fx)) {
    const db = freshDb(fx)
    const users = usersOf(db, tid)
    const admin = adminOf(db, tid).id
    // a variant with stored `late` flags dropped and decisions spread out, so the recomputed SLA path is exercised
    const weeks = db.timesheet_weeks.map((w, i) => (w.tenant_id === tid && i % 3 === 0 ? { ...w, late: false } : w))
    for (const setup of [{}, { timesheet_weeks: weeks }]) {
      for (const today of [D, addDays(D, -35), addDays(D, -7), addDays(D, 12), addDays(D, 60)]) {
        const C = c(admin, today)
        const s = []
        s.push({ c: C, fn: 'K.approvalKpis', args: [], post: 'entries' })
        for (const d of [30, 7, 90, 365, 0]) s.push({ c: C, fn: 'K.approvalKpis', args: [d], post: 'entries' })
        for (const u of [...users.map((u) => u.id), 'nobody']) for (const d of [{ $undef: 1 }, 30, 90]) s.push({ c: C, fn: 'K.approvalKpi', args: [u, d] })
        cases.push({ id: `${name}/${tid}/${today}/${Object.keys(setup).length}`, fixture: name, tenant: tid, setup, steps: s })
      }
    }
  }
}
for (const k of cases) runCase(fxs[k.fixture], k)
const n = cases.reduce((s, k) => s + k.steps.length, 0)
console.log(`${cases.length} cases, ${n} vectors, throwing:`, cases.flatMap((k) => k.steps.filter((s) => s.r.throws)).length)
writeGz('approval_kpi', { generated_by: 'gen/approval_kpi.mjs', cases })
