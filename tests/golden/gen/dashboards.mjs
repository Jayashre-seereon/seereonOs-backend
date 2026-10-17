// Golden vectors for app/routes/dashboards.py (port of src/mock/routes/dashboards.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/dashboards.mjs -> vectors/dashboards.json.gz
// Every dashboard, insight view and the scorecard for every user of both tenants on several days and weeks, plus the
// exports (mentionsOf, personWeekScore, SCORE_WEIGHTS / SCORE_THRESHOLDS); the rows written by the lazy sweeps.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('dashboards', `export * as da from '@/mock/routes/dashboards'\nexport * as co from '@/mock/costing'\n`) // costing installs the project-metrics override, as in the app
const { server, da } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['milestones', 'allocations', 'activity_log', 'notifications', 'timesheet_weeks']
const K = kit({
  server, T, modules: [da], tables: TABLES,
  fns: {
    mentionsOf: (ctx, a) => a.users.map((u) => da.mentionsOf(ctx, u, a.limit)),
    personWeekScore: (ctx, a) => a.users.flatMap((u) => a.weeks.map((w) => da.personWeekScore(ctx, server.rows(ctx, 'users').find((x) => x.id === u), w))),
    consts: () => ({ w: da.SCORE_WEIGHTS, t: da.SCORE_THRESHOLDS }),
  },
})
const TODAY = seed.generated_on
const S = []
const VIEWS = ['tasks_at_risk', 'blocked', 'overdue_milestones', 'effort_ratio', 'allocation', 'timesheet_compliance', 'approval_kpi', 'stale_deals', 'predictions', 'estimation', 'nope', 'constructor']
const READERS = { tn_seereon: ['u_santosh', 'u_debasish', 'u_subhankar', 'u_hritesh', 'u_priya', 'u_baishali', 'u_subham', 'u_jayashree'], tn_kalinga: ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha', 'u_k_meera'] }
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2026-12-21', '2026-08-03'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      const people = a.db.users.filter((u) => u.tenant_id === tid).map((u) => u.id)
      for (const u of users) {
        for (const query of [{}, { period: 'quarter', week: '2026-09-09' }, { period: 'fy', anchor: '2025-08-10' }, { period: 'month', anchor: '2099-01-01' }, { period: 'bogus', anchor: '2026-06-15' }])
          a.call(u, 'GET', '/dashboards/ceo', { query })
        for (const query of [{}, { week: '2026-09-23' }]) a.call(u, 'GET', '/dashboards/pm', { query })
        a.call(u, 'GET', '/dashboards/sales')
        a.call(u, 'GET', '/dashboards/ops')
        for (const query of [{}, { week: '2026-10-05' }, { week: '2099-01-05' }, ...people.slice(0, 6).map((user) => ({ user })), { user: 'u_nobody' }])
          a.call(u, 'GET', '/dashboards/employee', { query })
        for (const query of [{}, { user: people[2] }, { user: 'u_nobody' }]) a.call(u, 'GET', '/dashboards/mentions', { query })
        a.call(u, 'GET', '/rules/score')
        a.call(u, 'GET', '/insights')
        for (const view of VIEWS) a.call(u, 'GET', '/insights/:view', { params: { view } })
        for (const query of [{}, { week: '2026-09-02' }, { week: '2027-01-04' }, { week: 'garbage' }]) a.call(u, 'GET', '/scorecard', { query })
      }
      a.fn(users[0], 'mentionsOf', { users: people, limit: 5 })
      a.fn(users[0], 'personWeekScore', { users: people, weeks: ['2026-09-07', '2026-10-12', '2026-10-19', '2026-07-06'] })
      a.fn(users[0], 'consts')
    }))

writeGz('dashboards.json.gz', { scenarios: S })
console.log(`dashboards: ${S.length} scenarios, ${S.reduce((n, s) => n + s.steps.length, 0)} steps`)
