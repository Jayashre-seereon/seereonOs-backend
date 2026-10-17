// Golden vectors for app/engine/analytics.py (port of src/mock/analytics.ts) — every exported function on every
// fixture DB (seed + harvested snapshots), every tenant with data, every project / milestone / task / user / week,
// with ctx.today pinned to several dates and side effects (sweep, sync) recorded.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/analytics.mjs -> vectors/analytics.json.gz
import { FIXTURES, addDays, adminOf, c, freshDb, loadFixture, runCase, tenantsOf, usersOf, writeGz } from './_engine_env.mjs'

const cases = []
for (const name of FIXTURES) {
  const fx = loadFixture(name)
  const D = fx.day
  const TODAYS = [D, addDays(D, -35), addDays(D, 12), addDays(D, 60)]
  for (const tid of tenantsOf(fx)) {
    const db = freshDb(fx)
    const users = usersOf(db, tid)
    const admin = adminOf(db, tid).id
    const tasks = db.tasks.filter((t) => t.tenant_id === tid)
    const projects = db.projects.filter((p) => p.tenant_id === tid)
    const milestones = db.milestones.filter((m) => m.tenant_id === tid)
    const weeks = db.timesheet_weeks.filter((w) => w.tenant_id === tid && w.submitted_at)

    TODAYS.forEach((today, ti) => {
      const C = c(admin, today)
      /* ---------- A: reads (no sweep first) ---------- */
      const s = []
      s.push({ c: C, fn: 'X.calDays', args: [addDays(D, -20), 41] })
      s.push({ c: C, fn: 'A.weekStatusMap', args: [], post: 'keys' })
      if (ti === 0) s.push({ c: C, fn: 'A.costedEntries', args: [], post: 'costed' })
      s.push({ c: C, fn: 'A.taskActuals', args: [], post: 'entries' })
      for (const u of [...users.map((u) => u.id), null, 'nobody']) s.push({ c: C, fn: 'A.currentRatePH', args: [u] })
      for (const t of tasks) {
        s.push({ c: C, fn: 'A.depsOf', args: [t.id], post: 'ids' })
        s.push({ c: C, fn: 'A.openBlockers', args: [t.id], post: 'ids' })
        s.push({ fn: 'A.earnedHours', args: [{ $row: ['tasks', t.id] }] })
        s.push({ c: C, nc: true, fn: 'A.wbsCode', args: [{ $row: ['tasks', t.id] }, { $liveMs: 1 }] })
        s.push({ c: C, fn: 'A.stageSince', args: [{ $row: ['tasks', t.id] }] })
      }
      for (const m of milestones) {
        for (const [a, b] of [[m.baseline_end, m.planned_end], [m.planned_end, today], [today, m.planned_start], [m.planned_end, m.planned_end]]) s.push({ c: C, fn: 'A.wdVariance', args: [a, b] })
        s.push({ c: C, fn: 'A.milestoneState', args: [{ $row: ['milestones', m.id] }, { $tasksOf: m.project_id }] })
        s.push({ c: C, fn: 'A.milestoneState', args: [{ $row: ['milestones', m.id] }, { $tasksOf: m.project_id }, null] })
        s.push({ c: C, fn: 'A.milestoneState', args: [{ $row: ['milestones', m.id] }, { $tasksOf: m.project_id }, addDays(m.planned_end, 3)] })
      }
      for (const p of projects) {
        s.push({ c: C, fn: 'A.scheduleOf', args: [p.id], post: 'sched' })
        s.push({ c: C, fn: 'A.computeSchedule', args: [{ $row: ['projects', p.id] }] })
      }
      s.push({ c: C, fn: 'A.scheduleOf', args: ['nope'], post: 'sched' })
      s.push({ c: C, fn: 'A.liveMilestoneMap', args: [], post: 'keys' })
      for (const [a, b] of [[addDays(D, -400), addDays(D, 400)], [addDays(D, -30), D], [D, addDays(D, 90)], [addDays(D, 10), D], ['2026-01-31', '2026-06-30']]) s.push({ c: C, fn: 'A.expandLedger', args: [a, b] })
      for (let i = -13; i <= 3; i++) s.push({ c: C, fn: 'A.payrollForMonth', args: [addDays(D.slice(0, 7) + '-15', i * 30.5 | 0).slice(0, 7)] })
      const ranges = [[D.slice(0, 7) + '-01', D], [addDays(D, -365), D], [addDays(D, -90), addDays(D, 90)], [addDays(D, 5), addDays(D, 40)], [D, addDays(D, -1)], [addDays(D, -60), addDays(D, -31)]]
      for (const [a, b] of ranges) for (const o of [{ $undef: 1 }, {}, { scheduled: true }]) s.push({ c: C, fn: 'A.revenueBetween', args: [a, b, o] })
      for (const u of [{ $undef: 1 }, ...users.map((u) => u.id)]) s.push({ c: C, fn: 'A.pipeline', args: [u] })
      for (const u of users) {
        for (const d of [addDays(D, -30), D, addDays(D, 30)]) s.push({ c: C, fn: 'A.allocationOn', args: [u.id, d] })
        for (const [a, b] of [[addDays(D, -30), D], [D, addDays(D, 60)], [D, addDays(D, -1)]]) s.push({ c: C, fn: 'A.avgAllocation', args: [u.id, a, b] })
      }
      for (const w of weeks) s.push({ c: C, fn: 'A.slaDue', args: [w.submitted_at] })
      s.push({ c: C, fn: 'A.effortRatioSamples', args: [], post: 'samples' })
      for (const o of [null, ...users.map((u) => u.id)])
        for (const cx of ['low', 'medium', 'high', 'very_high', 'bogus']) for (const e of [null, 0, 8, 7.3, 40]) s.push({ c: C, fn: 'A.estimateHint', args: [o, cx, e] })
      if (ti === 0) {
        const codes = [...new Set(tasks.map((t) => t.wbs_code).filter(Boolean)), '10.1', '0.5', '.3', 'a.b', '2', '', '1.2.3', '1.10', '1.9']
        for (const a of codes) for (const b of codes.slice(0, 12)) s.push({ fn: 'A.sortWbs', args: [a, b] })
      }
      cases.push({ id: `${name}/${tid}/${today}/reads`, fixture: name, tenant: tid, steps: s })

      /* ---------- B: project metrics (sweep side effects), redaction per viewer ---------- */
      const b = []
      projects.forEach((p, i) => b.push({ c: C, fn: 'A.projectMetrics', args: [{ $row: ['projects', p.id] }], w: i === 0 }))
      const viewers = [...users.filter((u) => u.status === 'active').map((u) => c(u.id, today)), c(admin, today, 'employee'), c(admin, today, 'project_manager')]
      projects.forEach((p, i) => {
        for (const v of viewers) for (const cm of [false, true]) b.push({ c: v, fn: 'A.redactMetrics', args: [{ $prev: i }, cm] })
      })
      projects.forEach((p) => b.push({ c: C, fn: 'A.projectMetrics', args: [{ $row: ['projects', p.id] }] }))
      if (projects.length) b.push({ c: c(admin, today, 'employee'), fn: 'X.withOverride', args: [projects[0].id, { $row: ['projects', projects[0].id] }], w: true })
      cases.push({ id: `${name}/${tid}/${today}/metrics`, fixture: name, tenant: tid, steps: b })
    })

    /* ---------- C: syncMilestoneDates ---------- */
    const sc = []
    milestones.forEach((m, i) => sc.push({ c: c(admin, D), fn: 'A.syncMilestoneDates', args: [m.id, i % 2 === 0], w: true }))
    sc.push({ c: c(admin, D), fn: 'A.syncMilestoneDates', args: [null], w: true })
    sc.push({ c: c(admin, D), fn: 'A.syncMilestoneDates', args: ['nope', true], w: true })
    milestones.forEach((m) => sc.push({ c: c(admin, D), fn: 'A.syncMilestoneDates', args: [m.id, true], w: true }))
    cases.push({ id: `${name}/${tid}/sync`, fixture: name, tenant: tid, steps: sc })

    /* ---------- D: empty milestones — sweep marks, then auto-deletes ---------- */
    const withTasks = milestones.filter((m) => tasks.some((t) => t.milestone_id === m.id))
    const drop = new Set([withTasks[0]?.id, withTasks[withTasks.length - 1]?.id].filter(Boolean))
    const setup = {
      tasks: db.tasks.filter((t) => !drop.has(t.milestone_id)),
      milestones: db.milestones.map((m) => (m.id === withTasks[1]?.id ? { ...m, empty_since: addDays(D, -3) } : m)),
    }
    const sd = []
    sd.push({ c: c(admin, D), fn: 'A.sweepAll', args: [], w: true })
    sd.push({ c: c(admin, addDays(D, 1)), fn: 'A.ensureSwept', args: [], w: true })
    sd.push({ c: c(admin, addDays(D, 1)), fn: 'A.ensureSwept', args: [], w: true })
    sd.push({ c: c(admin, addDays(D, 60)), fn: 'A.ensureSwept', args: [], w: true })
    for (const p of projects) sd.push({ c: c(admin, addDays(D, 100)), fn: 'A.sweepMilestones', args: [{ $row: ['projects', p.id] }], w: true })
    for (const p of projects) sd.push({ c: c(admin, addDays(D, 100)), fn: 'A.projectMetrics', args: [{ $row: ['projects', p.id] }] })
    cases.push({ id: `${name}/${tid}/sweep`, fixture: name, tenant: tid, setup, steps: sd })
  }
}
for (const k of cases) runCase(loadFixtureCached(k.fixture), k)
function loadFixtureCached(n) {
  return (loadFixtureCached.m ??= {})[n] ??= loadFixture(n)
}
const n = cases.reduce((s, k) => s + k.steps.length, 0)
const errs = cases.flatMap((k) => k.steps.filter((s) => s.r.throws).map((s) => `${k.id} ${s.fn}: ${s.r.throws}`))
console.log(`${cases.length} cases, ${n} vectors, ${errs.length} throwing`, errs.slice(0, 5))
writeGz('analytics', { generated_by: 'gen/analytics.mjs', cases })
