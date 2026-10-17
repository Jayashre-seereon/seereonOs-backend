// Golden vectors for app/routes/{tasks,taskflow,projects}.py (ports of src/mock/routes/{tasks,taskflow,projects}.ts) on
// the full seed:   TZ=Asia/Kolkata node backend/tests/golden/gen/tasks.mjs -> vectors/tasks.json.gz
// The exported helpers (visibility, relations, access, covering, reviewer rules, move rights, create rights, numbering,
// project access, analytics, task detail) for every task / user / project of both tenants on several pinned days, plus
// write scenarios through the route handlers (every response, warning and the rows written).
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

Math.random = () => 0.5 // attachment ids: att_ + (0.5).toString(36).slice(2, 10) = 'att_i' (Python: _rand36 patched)
const M = await loadTs('tasks', `export * as tk from '@/mock/routes/tasks'\nexport * as tf from '@/mock/routes/taskflow'\nexport * as pj from '@/mock/routes/projects'\n`)
const { server, tk, tf, pj } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = [
  'tasks', 'task_reviews', 'task_dependencies', 'milestones', 'projects', 'project_status_history', 'allocations', 'comments', 'change_requests', 'openings', 'pending_tokens',
  'activity_log', 'notifications', 'number_sequences', 'files',
]
const ids = (ctx, t) => server.rows(ctx, t).map((x) => x.id)
const fns = {
  // per task: every exported per-task rule in one compact row
  taskRules: (ctx) => {
    const ms = tk.milestoneMap(ctx)
    return server.rows(ctx, 'tasks').map((t) => [
      t.id, tk.wbsOf(t, ms), tk.toRef(t, ms), tk.concernedManagerOf(ctx, t), tk.relationOf(ctx, t), tk.canSeeTask(ctx, t), tk.taskAccess(ctx, t), tf.reviewerOf(ctx, t), tf.isGeneral(ctx, t),
      tf.canManageGeneral(ctx, t), tf.canSubmit(ctx, t), tf.selfReview(ctx, t), tf.canReviewTask(ctx, t), tf.canMoveTask(ctx, t), tf.reviewStepLabel(t), tk.onLeave(ctx, t.owner_id, ctx.today),
      tf.lateBy(ctx, t.due_on, ctx.today), tf.lateBy(ctx, ctx.today, t.due_on), tf.reviewsOf(ctx, t.id).map((r) => r.id), tf.reschedulesOf(ctx, t.id),
    ])
  },
  taskDetails: (ctx) => server.rows(ctx, 'tasks').map((t) => tk.taskDetail(ctx, t)),
  visibleTasks: (ctx) => server.rows(ctx, 'tasks').map((t) => {
    try {
      return tk.visibleTask(ctx, t.id).id
    } catch (e) {
      return e.code
    }
  }),
  covering: (ctx, a) => a.users.flatMap((u) => a.ranges.map(([f, to]) => [...tk.coveringFor(ctx, u, f, to).entries()])),
  people: (ctx, a) => a.users.map((u) => [u, tf.isTop(ctx, u), a.users.filter((v) => tf.isManagerOf(ctx, u, v))]),
  projectRules: (ctx, a) => server.rows(ctx, 'projects').map((p) => [
    p.id, pj.canView(ctx, p), pj.canEdit(ctx, p), a.users.map((u) => tf.createRights(ctx, p, u)), tf.createRights(ctx, p, null),
    [null, ...server.rows(ctx, 'milestones').filter((m) => m.project_id === p.id).map((m) => m.id)].map((m) => pj.nextTaskNo(ctx, p.id, m, false)),
  ]),
  myProjectIds: (ctx) => [...pj.myProjectIds(ctx)].sort(),
  misc: (ctx) => [tf.generalProjectId(ctx), tf.wideTaskScope(ctx), tk.TASK_RELATION_LABEL, tf.RECURRENCES],
  analytics: (ctx, a) => a.qs.map((q) => tf.taskAnalytics(ctx, q)),
  ensureGeneral: (ctx) => tf.ensureGeneralProject(ctx),
  freezeWbs: (ctx, a) => a.tasks.map((id) => {
    const t = server.find(ctx, 'tasks', id)
    return tk.freezeWbs(t, new Map(server.rows(ctx, 'milestones').map((m) => [m.id, m])))
  }),
  nextTaskNoTake: (ctx, a) => a.list.map(([p, m]) => pj.nextTaskNo(ctx, p, m, true)),
  syncAchieved: (ctx) => {
    for (const m of server.rows(ctx, 'milestones')) pj.syncAchieved(ctx, m.id)
    return server.rows(ctx, 'milestones').map((m) => [m.id, m.achieved_on])
  },
}
const K = kit({ server, T, modules: [pj, tk, tf], tables: TABLES, fns })
const TODAY = seed.generated_on
const S = []
const USERS = { tn_seereon: T.users.filter((u) => u.tenant_id === 'tn_seereon').map((u) => u.id), tn_kalinga: T.users.filter((u) => u.tenant_id === 'tn_kalinga').map((u) => u.id) }
const AQ = [{}, { scope: 'company', group: 'project' }, { scope: 'team', group: 'manager', from: '2026-09-01', to: '2026-10-31' }, { scope: 'me', from: 'bad' }, { group: 'person', to: '2026-10-01' }]

/* ---------- helpers for every user × day ---------- */
for (const [tid, users] of Object.entries(USERS))
  for (const today of [TODAY, '2026-12-20', '2026-08-03'])
    S.push(K.scenario(`helpers ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        if (a.db.users.find((x) => x.id === u).status !== 'active') continue
        a.fn(u, 'taskRules')
        a.fn(u, 'visibleTasks')
        a.fn(u, 'myProjectIds')
        a.fn(u, 'projectRules', { users })
        a.fn(u, 'analytics', { qs: AQ })
      }
      a.fn(users[0], 'misc')
      a.fn(users[0], 'people', { users })
      a.fn(users[0], 'covering', { users, ranges: [[today, today], ['2026-10-12', '2026-10-18'], ['2026-09-01', '2026-12-31'], ['2026-10-20', '2026-10-10']] })
    }))

/* ---------- task detail for every task (two viewers) ---------- */
S.push(K.scenario('details', 'tn_seereon', TODAY, (a) => {
  for (const u of ['u_santosh', 'u_hritesh', 'u_subhankar']) a.fn(u, 'taskDetails')
}))
S.push(K.scenario('details kalinga', 'tn_kalinga', TODAY, (a) => {
  for (const u of ['u_k_ananya', 'u_k_sneha']) a.fn(u, 'taskDetails')
}))

/* ---------- writes ---------- */
S.push(K.scenario('task lifecycle', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = (id) => ({ params: { id } })
  const good = { title: 'Build the leave ledger export', project_id: 'p_hrms', milestone_id: 'ms_hrms_3', owner_id: 'u_hritesh', est_hours: 6.3, start_on: '2026-10-19', due_on: '2026-10-24', complexity: 'medium', tag: 'feature' }
  for (const [u, body] of [
    ['u_subhankar', { ...good, title: 'ab' }], ['u_subhankar', { ...good, project_id: 'p_samet' }], ['u_hritesh', good], ['u_subhankar', { ...good, milestone_id: undefined }],
    ['u_subhankar', { ...good, reviewer_id: 'u_hritesh' }], ['u_subhankar', { ...good, priority: 'P9' }], ['u_subhankar', { ...good, due_on: '2026-10-18' }], ['u_subhankar', { ...good, depends_on: ['t_crm_1'] }],
    ['u_subhankar', { ...good, attachments: [{ name: 'a.pdf', size: 900000 }] }], ['u_subhankar', { ...good, labels: 'x' }],
  ]) C(u, 'POST', '/tasks', { body })
  const c1 = C('u_subhankar', 'POST', '/tasks', { body: { ...good, start_on: '2026-10-18', due_on: '2026-12-05', priority: 'P1', depends_on: ['t_hrms_8'], watcher_ids: ['u_priya', 'u_bijaya'], acceptance_criteria: ['Totals match payroll', { text: ' CSV opens ' }], labels: ['backend', ' export '], parent_task_id: 't_hrms_8', backup_id: 'u_bijaya', attachments: [{ name: 'spec.pdf', size: 12, type: 'application/pdf', data_url: 'data:application/pdf;base64,JVBERi0=' }] } })
  const c2 = C('u_subhankar', 'POST', '/tasks', { body: { title: 'Weekly status report', project_id: 'p_general_seereon', owner_id: 'u_jagannath', est_hours: 2, start_on: '2026-10-16', due_on: '2026-10-16', recurrence: 'weekly', priority: 'high' } })
  C('u_hritesh', 'POST', '/tasks', { body: { title: 'Renew my VPN token', project_id: 'p_general_seereon', owner_id: 'u_hritesh', est_hours: 1, start_on: '2026-10-16', due_on: '2026-10-16', billable: true } })
  const t1 = c1.v?.id ?? 'x'
  const t2 = c2.v?.id ?? 'x'
  C('u_hritesh', 'POST', '/tasks/:id/watch', { ...P(t1), body: { watch: false } })
  C('u_jagannath', 'POST', '/tasks/:id/watch', { ...P(t1), body: {} })
  C('u_hritesh', 'POST', '/tasks/:id/criteria', { ...P(t1), body: { index: 1, done: true } })
  C('u_hritesh', 'POST', '/tasks/:id/criteria', { ...P(t1), body: { index: 9, done: true } })
  C('u_hritesh', 'POST', '/tasks/:id/attachments', { ...P(t1), body: { name: 'notes.txt', size: 3, data_url: 'data:text/plain;base64,YWJj' } })
  C('u_pragyasmita', 'DELETE', '/tasks/:id/attachments/:aid', { params: { id: t1, aid: 'att_i' } })
  C('u_hritesh', 'DELETE', '/tasks/:id/attachments/:aid', { params: { id: t1, aid: 'att_i' } })
  const cm = C('u_hritesh', 'POST', '/tasks/:id/comments', { ...P(t1), body: { body: ' @Bijaya check the totals please '.repeat(4), mentions: ['u_bijaya', 'u_ankit', 7] } })
  C('u_bijaya', 'POST', '/tasks/:id/comments', { ...P(t1), body: { body: 'Looks good', parent_id: cm.v?.id } })
  C('u_bijaya', 'GET', '/tasks/:id/comments', P(t1))
  C('u_hritesh', 'GET', '/tasks/mentions', { query: {} })
  C('u_bijaya', 'GET', '/tasks/mentions', { query: { limit: '1' } })
  // review flow
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_gen_seereon_laptop'), body: { note: 'Laptop reimaged' } })
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_gen_seereon_laptop'), body: { note: 'Laptop reimaged', delay_reason_code: 'dependency', delay_reason: 'Waited for the licence key from IT' } })
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_hrms_5'), body: { note: 'Payroll UI ready', proof_url: 'https://example.com/pr/12' } })
  C('u_subhankar', 'POST', '/tasks/:id/send-back', { ...P('t_hrms_5'), body: { reason: 'Payslip totals are off by one rupee', new_due_on: '2026-10-31' } })
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_hrms_5'), body: { note: 'Fixed the rounding' } })
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 4, note: 'Good' } })
  C('u_santosh', 'POST', '/tasks/:id/approve', { ...P('t_gen_seereon_iso'), body: { quality_rating: '4' } })
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P('t_hrms_6'), body: { quality_rating: 3 } })
  C('u_santosh', 'POST', '/tasks/:id/status', { ...P('t_gen_seereon_bni'), body: { status: 'done', quality_rating: 5 } })
  C('u_hritesh', 'POST', '/tasks/:id/stage', { ...P('t_hrms_10'), body: { stage: 'in_development', progress: 20, note: 'Started' } })
  C('u_hritesh', 'POST', '/tasks/:id/stage', { ...P('t_hrms_10'), body: { stage: 'waiting_feedback', note: 'Client legal on policy sources' } })
  C('u_subhankar', 'POST', '/tasks/:id/stage', { ...P('t_hrms_10'), body: { stage: 'completed', quality_rating: 3 } })
  C('u_subhankar', 'POST', '/tasks/:id/stage', { ...P('t_hrms_10'), body: { stage: 'in_development' } })
  C('u_jagannath', 'POST', '/tasks/:id/progress', { ...P('t_crm_2'), body: { progress: 55, note: 'Reports half done' } })
  C('u_jayashree', 'POST', '/tasks/:id/flag-slip', { ...P('t_crm_3'), body: { note: 'Charts library upgrade broke the layout', new_due_on: '2026-11-01' } })
  C('u_subhankar', 'POST', '/tasks/:id/cancel', { ...P('t_hrms_9'), body: { reason: 'Client dropped shift rosters' } })
  C('u_subhankar', 'POST', '/tasks/:id/status', { ...P('t_crm_2'), body: { status: 'done', quality_rating: 4 } })
  C('u_subhankar', 'POST', '/tasks/:id/status', { ...P('t_crm_3'), body: { status: 'blocked', blocked_reason: 'Waiting on the CRM API keys' } })
  C('u_subhankar', 'POST', '/team-tasks', { body: { owner_id: 'u_hritesh', title: 'Prepare a deck', due_on: '2026-10-24', est_hours: 13, priority: 'urgent' } })
  C('u_subhankar', 'POST', '/team-tasks', { body: { owner_id: 'u_jagannath', title: 'CRM report polish', project_id: 'p_crm', milestone_id: 'ms_crm_2', due_on: '2026-11-20', start_on: '2026-11-16', est_hours: 41 } })
  C('u_jagannath', 'POST', '/tasks/:id/submit', { ...P(t2), body: { note: 'Status report sent' } })
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P(t2), body: { quality_rating: 5 } })
  // project-side task writes
  const pt = C('u_subhankar', 'POST', '/projects/:id/tasks', { ...P('p_hrms'), body: { title: 'Biometric driver', milestone_id: 'ms_hrms_3', owner_id: 'u_pragyasmita', est_hours: 12 } })
  const pt1 = pt.v?.id ?? 'x'
  C('u_subhankar', 'PATCH', '/tasks/:id', { ...P(pt1), body: { priority: 'high', reviewer_id: 'u_santosh', watcher_ids: ['u_hritesh'], labels: ['hw'], owner_id: 'u_jagannath', est_hours: 12.3, due_on: '2026-11-20', due_change_reason: 'Device shipment delayed by vendor', milestone_id: 'ms_hrms_4' } })
  C('u_subhankar', 'PATCH', '/tasks/:id', { ...P(pt1), body: { milestone_id: null } })
  C('u_subhankar', 'PUT', '/tasks/:id/dependencies', { ...P('t_crm_4'), body: { depends_on: ['t_crm_3', 't_crm_2'] } })
  C('u_subhankar', 'PUT', '/tasks/:id/dependencies', { ...P('t_crm_2'), body: { depends_on: ['t_crm_5'] } })
  C('u_subhankar', 'DELETE', '/tasks/:id', P('t_crm_5'))
  C('u_subhankar', 'DELETE', '/milestones/:id', P('ms_crm_2'))
  for (const u of ['u_subhankar', 'u_hritesh', 'u_santosh']) {
    C(u, 'GET', '/tasks', { query: { status: 'all' } })
    C(u, 'GET', '/my-tasks', { query: {} })
    C(u, 'GET', '/team-tasks', {})
    C(u, 'GET', '/team-tasks/review-queue', { query: { all: '1' } })
    C(u, 'GET', '/delivery/risks', { query: {} })
    C(u, 'GET', '/tasks/:id', P(t1))
  }
  a.fn('u_subhankar', 'freezeWbs', { tasks: ['t_mgs_uat1', 'r_01za', 't_hrms_1'] })
  a.fn('u_subhankar', 'nextTaskNoTake', { list: [['p_hrms', 'ms_hrms_2'], ['p_hrms', null], ['p_crm', 'ms_crm_1'], ['p_nope', 'ms_nope']] })
  a.fn('u_subhankar', 'syncAchieved')
}))

S.push(K.scenario('projects lifecycle', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = (id) => ({ params: { id } })
  const pgood = { name: 'Plant maintenance app', client: 'Kalinga Steel', type: 'service', billing_model: 'fixed', stream: 'services', start_on: '2026-11-02', end_on: '2027-03-31', contract_value_paise: 4000000 }
  C('u_hritesh', 'POST', '/projects', { body: pgood })
  C('u_santosh', 'POST', '/projects', { body: { ...pgood, milestones: [{ name: 'Build' }, { name: ' build ' }] } })
  const p1 = C('u_santosh', 'POST', '/projects', { body: { ...pgood, pm_id: 'u_subhankar', priority: '2', milestones: [{ name: 'Design', billing_amount_paise: 1000000 }, { name: 'Build', billing_amount_paise: 2000000 }] } })
  C('u_subhankar', 'POST', '/projects', { body: { ...pgood, name: 'Vendor portal', milestones: [{ name: 'Phase 1', planned_end: '2026-12-15' }, { name: 'Phase 2', planned_end: '2027-03-31' }] } })
  const P1 = p1.v?.id ?? 'x'
  C('u_subhankar', 'PATCH', '/projects/:id', { ...P('p_crm'), body: { name: ' Sales CRM Phase 2b ', end_on: '2026-12-20', contract_value_paise: 100000 } })
  C('u_subhankar', 'POST', '/projects/:id/status', { ...P('p_crm'), body: { status: 'on_hold', reason: 'Client paused for budget review' } })
  C('u_santosh', 'POST', '/projects/:id/milestones', { ...P(P1), body: { name: 'Hypercare', billing_amount_paise: 2000000 } })
  const m3 = C('u_santosh', 'POST', '/projects/:id/milestones', { ...P(P1), body: { name: 'Extra', planned_start: '2026-10-01', planned_end: '2027-05-01' } })
  C('u_santosh', 'PATCH', '/milestones/:id', { ...P(m3.v?.id ?? 'x'), body: { planned_start: '2027-01-01', planned_end: '2027-06-30' } })
  C('u_santosh', 'DELETE', '/milestones/:id', P(m3.v?.id ?? 'x'))
  C('u_santosh', 'POST', '/projects/:id/tasks', { ...P(P1), body: { title: 'Wireframes', owner_id: 'u_hritesh' } })
  const al = C('u_subhankar', 'POST', '/projects/:id/allocations', { ...P('p_hrms'), body: { user_id: 'u_hritesh', milestone_id: 'ms_hrms_3', pct: 80.4, from_on: '2026-11-02', to_on: '2026-11-20' } })
  C('u_subhankar', 'PATCH', '/allocations/:id', { ...P(al.v?.id ?? 'x'), body: { pct: 30 } })
  C('u_subhankar', 'GET', '/projects/:id/load', P('p_hrms'))
  C('u_subhankar', 'DELETE', '/allocations/:id', P(al.v?.id ?? 'x'))
  const cr1 = C('u_subhankar', 'POST', '/projects/:id/change-requests', { ...P('p_hrms'), body: { title: ' Gratuity module ', requested_by_client: ' HR head ', value_paise: 500000, impact_days: 3, proposed_tasks: [{ title: 'Gratuity calc', est_hours: 10.1, owner_id: 'u_hritesh' }, { title: 'Report', est_hours: '6' }] } })
  const CR1 = cr1.v?.id ?? 'x'
  C('u_subhankar', 'POST', '/change-requests/:id/decision', { ...P(CR1), body: { decision: 'approve', milestone: { name: 'Gratuity', planned_end: '2027-01-15' } } })
  C('u_subhankar', 'POST', '/change-requests/:id/add-tasks', { ...P(CR1), body: { start_on: '2026-10-17' } })
  C('u_subhankar', 'POST', '/change-requests/:id/decision', { ...P('r_013r'), body: { decision: 'reject', reason: 'Out of budget this year' } })
  C('u_subhankar', 'PATCH', '/change-requests/:id', { ...P('cr_mgs_2'), body: { hours: 20, note: 'revised' } })
  C('u_subhankar', 'GET', '/projects/:id/change-requests', P('p_hrms'))
  const head = 'Milestone,Task,Owner,Estimated hours,Start,End,Complexity,Depends on,Milestone billing (₹)\n'
  C('u_subhankar', 'POST', '/projects/:id/import', { ...P('p_crm'), body: { text: head + 'Build,,Nobody,abc,2026-13-01,31/02/2026,huge,9.9;x;1.1,\nNew phase,"Quoted, task",hritesh@seereon.co.in,8,2026-11-02,02/11/2026,Very high,2.1,"₹1,50,000"\nNew phase,Loop,Hritesh Panda,4,3 Nov 2026,4-Nov-2026,med,2.2,abc\n' } })
  const prev = C('u_subhankar', 'POST', '/projects/:id/import', { ...P('p_crm'), body: { text: head + 'Build,Report exports,Jagannath Nayak,6,2026-10-20,2026-10-22,High,1.2,\nPhase 3,Mobile view,jayashree@seereon.co.in,8,2026-11-25,27/11/2026,low,,"2,00,000"\nPhase 3,Push alerts,Bijaya Jena,5,26 Nov 2026,30 Nov 2026,,3.1;1.2,\n' } })
  C('u_subhankar', 'POST', '/projects/:id/import', { ...P('p_crm'), query: { mode: 'commit' }, body: { token: prev.v?.token } })
  C('u_santosh', 'POST', '/milestones/:id/invoice', { ...P('ms_hrms_2'), body: { number: 'SCI/26-27/0100', invoiced_on: '2026-10-14', amount_paise: 2500000, file: { name: 'inv.pdf', mime: 'application/pdf', size_bytes: 9, data_url: 'data:application/pdf;base64,JVBERi0=' } } })
  C('u_santosh', 'POST', '/invoices/:id/payments', { ...P('inv_ms_dms_1'), body: { amount_paise: 1000000, paid_on: '2026-10-15', reference: ' UTR123 ' } })
  const op = C('u_subhankar', 'POST', '/openings', { body: { role: ' Python developer ', count: '2', owner_id: 'u_priya', project_id: 'p_hrms', needed_by: '2026-11-30' } })
  C('u_subhankar', 'PATCH', '/openings/:id', { ...P(op.v?.id ?? 'x'), body: { status: 'on_hold' } })
  C('u_subhankar', 'DELETE', '/openings/:id', P(op.v?.id ?? 'x'))
  for (const u of ['u_santosh', 'u_subhankar', 'u_hritesh']) {
    C(u, 'GET', '/projects', { query: {} })
    for (const p of ['p_hrms', 'p_crm', P1]) {
      C(u, 'GET', '/projects/:id', P(p))
      C(u, 'GET', '/projects/:id/money', P(p))
      C(u, 'GET', '/projects/:id/client-view', P(p))
      C(u, 'GET', '/projects/:id/activity', P(p))
    }
    C(u, 'GET', '/openings', {})
  }
}))

S.push(K.scenario('general project on demand', 'tn_kalinga', TODAY, (a) => {
  a.call('u_k_sneha', 'GET', '/tasks/create-options', {})
  a.fn('u_k_ananya', 'ensureGeneral')
  a.call('u_k_ananya', 'POST', '/tasks', { body: { title: 'Kalinga admin task', project_id: 'p_general_kalinga', owner_id: 'u_k_sneha', est_hours: 2, start_on: '2026-10-16', due_on: '2026-10-20' } })
}, [{ kind: 'delete', table: 'projects', id: 'p_general_kalinga' }]))

const STEPS3 = [{ id: 's1', name: 'Reviewer approval', approver: 'task_reviewer', sla_days: 2 }, { id: 's2', name: 'Delivery head review', approver: 'user', user_id: 'u_debasish', sla_days: 1 }, { id: 's3', name: 'CEO sign-off', approver: 'user', user_id: 'u_santosh', sla_days: 3 }]
S.push(K.scenario('multi-step review', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = (id) => ({ params: { id } })
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_hrms_5'), body: { note: 'Payroll UI ready' } })
  C('u_debasish', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 4 } })
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 4, note: 'Fine' } })
  C('u_subhankar', 'GET', '/tasks/:id', P('t_hrms_5'))
  C('u_debasish', 'GET', '/team-tasks/review-queue', { query: {} })
  C('u_debasish', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 5 } })
  C('u_santosh', 'POST', '/tasks/:id/send-back', { ...P('t_hrms_5'), body: { reason: 'One more look at arrears please' } })
  C('u_hritesh', 'POST', '/tasks/:id/submit', { ...P('t_hrms_5'), body: { note: 'Arrears checked' } })
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 4 } })
  C('u_debasish', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 4 } })
  C('u_santosh', 'POST', '/tasks/:id/approve', { ...P('t_hrms_5'), body: { quality_rating: 5, note: 'Ship it' } })
  // a task already in review before the chain existed: the chain is built on the first approval
  C('u_subhankar', 'POST', '/tasks/:id/approve', { ...P('t_hrms_6'), body: { quality_rating: 3 } })
  C('u_debasish', 'POST', '/tasks/:id/approve', { ...P('t_hrms_6'), body: { quality_rating: 3 } })
  C('u_santosh', 'GET', '/tasks/:id', P('t_hrms_6'))
}, [{ kind: 'set', table: 'approval_workflows', id: 'r_016r', values: { steps: STEPS3 } }]))

writeGz('tasks.json.gz', { scenarios: S })
console.log(`tasks: ${S.length} scenarios, ${S.reduce((n, s) => n + s.steps.length, 0)} steps`)
