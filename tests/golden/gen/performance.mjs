// Golden vectors for app/engine/performance.py (port of src/mock/performance.ts): every task, every person, every
// manager's team, every project, several windows and pinned `today`s, on every fixture DB and tenant.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/performance.mjs -> vectors/performance.json.gz
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
    const tasks = db.tasks.filter((t) => t.tenant_id === tid)
    const projects = db.projects.filter((p) => p.tenant_id === tid)
    for (const today of [D, addDays(D, -35), addDays(D, 12), addDays(D, 60)]) {
      const C = c(admin, today)
      const s = []
      for (const v of [-3, -1, 0, 1, 2.5]) s.push({ fn: 'P.timelinessOf', args: [v] })
      for (const t of tasks) {
        s.push({ fn: 'P.isCancelled', args: [{ $row: ['tasks', t.id] }] })
        s.push({ c: C, fn: 'P.taskTimeliness', args: [{ $row: ['tasks', t.id] }] })
        const done = t.done_on ?? addDays(t.due_on, 4)
        s.push({ c: C, fn: 'P.workingDayVariance', args: [t.due_on, done] })
        s.push({ c: C, fn: 'P.workingDayVariance', args: [done, t.due_on] })
      }
      const W = [{}, { from: addDays(today, -30), to: today }, { from: addDays(today, -90) }, { to: addDays(today, -10) }, { from: today, to: addDays(today, -1) }]
      for (const w of W) {
        s.push({ c: C, fn: 'P.taskStats', args: [w] })
        for (const u of users) s.push({ c: C, fn: 'P.taskStats', args: [{ ...w, userIds: [u.id] }] })
        for (const p of projects) s.push({ c: C, fn: 'P.taskStats', args: [{ ...w, projectId: p.id }] })
        s.push({ c: C, fn: 'P.taskStats', args: [{ ...w, userIds: [] }] })
        s.push({ c: C, fn: 'P.taskStats', args: [{ ...w, userIds: users.map((u) => u.id), projectId: projects[0]?.id }] })
      }
      for (const u of users) {
        s.push({ c: C, fn: 'P.reportsOf', args: [u.id], post: 'ids' })
        s.push({ c: C, fn: 'P.teamOf', args: [u.id], post: 'ids' })
        // a manager's team stats (as the people dashboards do)
        const team = []
        const walk = (id, d) => {
          if (d > 8) return
          for (const x of users) if (x.reports_to_id === id && x.status === 'active') team.push(x.id), walk(x.id, d + 1)
        }
        walk(u.id, 0)
        if (team.length) s.push({ c: C, fn: 'P.taskStats', args: [{ userIds: team, from: addDays(today, -60), to: today }] })
      }
      cases.push({ id: `${name}/${tid}/${today}`, fixture: name, tenant: tid, steps: s })
    }
  }
}
for (const k of cases) runCase(fxs[k.fixture], k)
const n = cases.reduce((s, k) => s + k.steps.length, 0)
console.log(`${cases.length} cases, ${n} vectors, throwing:`, cases.flatMap((k) => k.steps.filter((s) => s.r.throws)).length)
writeGz('performance', { generated_by: 'gen/performance.mjs', cases })
