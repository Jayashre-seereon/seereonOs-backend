// Golden vectors for app/engine/workflows.py (port of src/mock/workflows.ts — the approval workflow engine and its
// configuration routes): approver resolution and chains for every process x requester x amount x project, custom
// step lists (escalation, self-approval, thresholds, inactive people), every approval record of the six tables
// (ensureWf / advanceApproval / step labels / SLA / route), lazy escalation with pinned `today`s, step validation
// (every error branch), simulations, and the routes GET/PUT/reset/simulate with maker-checker on (Seereon) and off.
//   TZ=Asia/Kolkata node backend/tests/golden/gen/workflows.mjs -> vectors/workflows.json.gz
import { FIXTURES, M, addDays, adminOf, c, freshDb, install, loadFixture, runCase, tenantsOf, usersOf, writeGz } from './_engine_env.mjs'

const RT = ['approval_workflows', 'change_sets', 'notifications', 'activity_log', 'email_outbox']
const PROCESSES = ['leave', 'expense', 'purchase_order', 'vendor_bill', 'timesheet', 'task_review']
const REC_TABLES = { leave_requests: 'leave', expense_claims: 'expense', purchase_orders: 'purchase_order', vendor_bills: 'vendor_bill', timesheet_weeks: 'timesheet', tasks: 'task_review' }
const ENTITY = { leave_requests: 'leave_request', expense_claims: 'expense', purchase_orders: 'purchase_order', vendor_bills: 'vendor_bill', timesheet_weeks: 'timesheet_week', tasks: 'task' }
const inputOf = (r) => {
  const o = { requester_id: r.user_id ?? r.owner_id ?? r.created_by ?? null }
  if (r.amount_paise != null || r.total_paise != null) o.amount_paise = r.amount_paise ?? r.total_paise
  if (r.project_id !== undefined) o.project_id = r.project_id
  if (r.reviewer_id !== undefined) o.reviewer_id = r.reviewer_id
  return o
}

/** custom step lists (as stored on approval_workflows.steps) */
function customSteps(users, projects) {
  const act = users.filter((u) => u.status === 'active')
  const inactive = users.find((u) => u.status !== 'active')
  const st = (id, name, approver, x = {}) => ({ id, name, approver, sla_days: 2, ...x })
  return [
    [],
    [st('a', 'Manager', 'reports_to'), st('b', 'Skip', 'skip_level'), st('c', 'CEO above 25k', 'role', { role_id: 'ceo', min_amount_paise: 2_500_000 })],
    [st('a', 'Self ok', 'reports_to', { allow_self: true }), st('b', 'Me', 'user', { user_id: act[1]?.id, allow_self: true })],
    [st('a', 'Esc', 'reports_to', { escalate_to: { approver: 'role', role_id: 'ceo' } }), st('b', 'Esc2', 'project_pm', { escalate_to: { approver: 'department_head' }, sla_days: 4 })],
    [st('a', 'Inactive', 'user', { user_id: inactive?.id ?? 'nobody', escalate_to: { approver: 'user', user_id: act[2]?.id } }), st('b', 'Dept', 'department_head')],
    [st('a', 'PM or mgr', 'project_pm_or_manager'), st('b', 'Same PM', 'project_pm'), st('c', 'Reviewer', 'task_reviewer', { sla_days: 0 })],
    [st('a', 'Big only', 'role', { role_id: 'cto', min_amount_paise: 10_000_000 }), st('b', 'Bigger', 'role', { role_id: 'hr_manager', min_amount_paise: 50_000_000 })],
    [st('a', 'Bogus', 'bogus'), st('b', 'No role', 'role', { role_id: null }), st('c', 'Unknown role', 'role', { role_id: 'nope' })],
  ]
}

/** validateSteps inputs: [process, input, ack] — every branch */
function validationInputs(users) {
  const act = users.filter((u) => u.status === 'active')
  const inactive = users.find((u) => u.status !== 'active')
  const ok = { id: 's1', name: 'Manager approval', approver: 'reports_to', sla_days: 2 }
  const L = []
  for (const p of ['leave', 'expense', 'task_review']) {
    L.push([p, undefined, false], [p, null, false], [p, [], false], [p, 'x', false], [p, [ok, ok, ok, ok, ok, ok], false], [p, [ok], false], [p, [ok], true])
    L.push([p, [{ ...ok, name: ' a ' }], false], [p, [{ ...ok, name: 'x'.repeat(61) }], false], [p, [{ ...ok, name: 'é'.repeat(30) + '😀'.repeat(15) }], false], [p, [{ ...ok, name: 42 }], false])
    L.push([p, [{ ...ok, approver: 'nobody' }], false], [p, [{ ...ok, approver: 'task_reviewer' }], false], [p, [{ ...ok, approver: 'project_pm' }], false], [p, [{ ...ok, approver: 'project_pm_or_manager' }], false])
    L.push([p, [{ ...ok, approver: 'role' }], false], [p, [{ ...ok, approver: 'role', role_id: 'ceo' }], false], [p, [{ ...ok, approver: 'role', role_id: 'nope' }], false])
    L.push([p, [{ ...ok, approver: 'user', user_id: act[1]?.id }], false], [p, [{ ...ok, approver: 'user', user_id: inactive?.id }], false], [p, [{ ...ok, approver: 'user' }], false])
    L.push([p, [{ ...ok, min_amount_paise: 1000 }, { ...ok, id: 's2' }], false], [p, [{ ...ok, min_amount_paise: '' }], false], [p, [{ ...ok, min_amount_paise: '0' }], false], [p, [{ ...ok, min_amount_paise: 'abc' }], false])
    L.push([p, [{ ...ok, min_amount_paise: 5.5 }], false], [p, [{ ...ok, min_amount_paise: -100 }], false], [p, [{ ...ok, min_amount_paise: 2e12 }], false])
    L.push([p, [{ ...ok, min_amount_paise: 1000 }], false], [p, [{ ...ok, min_amount_paise: 1000 }], true], [p, [ok, { ...ok, id: 's2', min_amount_paise: 5000 }, { ...ok, id: 's3', min_amount_paise: 5000 }], false])
    L.push([p, [ok, { ...ok, id: 's2', min_amount_paise: '2500000' }, { ...ok, id: 's3', approver: 'role', role_id: 'ceo', min_amount_paise: 9000000 }], false])
    L.push([p, [{ ...ok, sla_days: 0 }], false], [p, [{ ...ok, sla_days: 16 }], false], [p, [{ ...ok, sla_days: '3' }], false], [p, [{ ...ok, sla_days: 2.5 }], false], [p, [{ ...ok, sla_days: null }], false])
    L.push([p, [{ ...ok, escalate_to: { approver: 'role', role_id: 'ceo' } }], false], [p, [{ ...ok, escalate_to: { approver: 'reports_to' } }], false], [p, [{ ...ok, escalate_to: { approver: 'task_reviewer' } }], false])
    L.push([p, [{ ...ok, approver: 'role', role_id: 'ceo', escalate_to: { approver: 'role', role_id: 'ceo' } }], false], [p, [{ ...ok, approver: 'role', role_id: 'ceo', escalate_to: { approver: 'role', role_id: 'cto' } }], false])
    L.push([p, [{ ...ok, escalate_to: { approver: 'user', user_id: act[0]?.id } }], false], [p, [{ ...ok, escalate_to: { approver: 'bogus' } }], false], [p, [{ ...ok, escalate_to: {} }], false], [p, [{ ...ok, escalate_to: 'x' }], false])
    L.push([p, [{ ...ok, id: undefined }], false], [p, [{ ...ok, id: 'bad id!' }], false], [p, [{ ...ok, id: 'y'.repeat(41) }], false], [p, [ok, { ...ok }], false], [p, [ok, { ...ok, id: 's2', allow_self: 1 }], false])
    L.push([p, [null], false], [p, [5], false], [p, [{ ...ok, approver: 'skip_level', extra: 1 }], false], [p, [{ ...ok, approver: 'department_head' }], false])
  }
  return L
}

const cases = []
const fxs = {}
for (const name of FIXTURES) {
  const fx = (fxs[name] = loadFixture(name))
  const D = fx.day
  for (const tid of tenantsOf(fx)) {
    const db = freshDb(fx)
    const users = usersOf(db, tid)
    const active = users.filter((u) => u.status === 'active')
    const admin = adminOf(db, tid).id
    const projects = db.projects.filter((p) => p.tenant_id === tid)
    const roles = [...new Set(db.roles.filter((r) => r.tenant_id === tid).map((r) => r.key))]
    const P0 = projects[0]?.id ?? null
    const P1 = projects[1]?.id ?? null
    const C = c(admin, D)
    const custom = customSteps(users, projects)

    /* ---------- resolution ---------- */
    const s = []
    for (const p of [...PROCESSES, 'bogus']) s.push({ c: C, fn: 'W.workflowFor', args: [p] })
    for (const r of [...roles, null, 'bogus']) for (const x of [{ $undef: 1 }, ...users.map((u) => u.id)]) s.push({ c: C, fn: 'W.holderOfRole', args: [r, x] })
    for (const x of [{ $undef: 1 }, ...users.map((u) => u.id)]) s.push({ c: C, fn: 'W.topApprover', args: [x] })
    const configs = [
      { approver: 'reports_to' }, { approver: 'skip_level' }, ...roles.map((r) => ({ approver: 'role', role_id: r })), { approver: 'role', role_id: null }, { approver: 'role' },
      ...users.map((u) => ({ approver: 'user', user_id: u.id })), { approver: 'user', user_id: 'nobody' }, { approver: 'project_pm' }, { approver: 'project_pm_or_manager' },
      { approver: 'department_head' }, { approver: 'task_reviewer' }, { approver: 'bogus' },
    ]
    for (const u of users) {
      const inputs = [{ requester_id: u.id }, { requester_id: u.id, project_id: P0, reviewer_id: u.reports_to_id ?? null }, { requester_id: u.id, project_id: P1, reviewer_id: active[active.length - 1].id }, { requester_id: u.id, project_id: 'nope', reviewer_id: 'nobody' }]
      for (const a of configs) for (const inp of inputs) s.push({ c: C, fn: 'W.resolveApprover', args: [a, inp] })
    }
    s.push({ c: C, fn: 'W.resolveApprover', args: [{ approver: 'reports_to' }, { requester_id: 'nobody' }] })
    for (const p of [...PROCESSES, 'bogus'])
      for (const u of users)
        for (const amt of [{ $undef: 1 }, null, 0, 2_500_000, 2_500_001, 100_000_000])
          for (const pr of [null, P0]) {
            const i = s.length
            s.push({ c: C, fn: 'W.resolveChain', args: [p, { requester_id: u.id, ...(amt?.$undef ? {} : { amount_paise: amt }), project_id: pr, reviewer_id: active[1]?.id ?? null }] })
            if (amt === 2_500_001 && pr === P0) for (const a of [null, admin, ...active.slice(0, 3).map((x) => x.id)]) s.push({ fn: 'W.nextInChain', args: [{ $prev: i }, a] })
          }
    for (const steps of custom)
      for (const u of users)
        for (const amt of [null, 3_000_000, 60_000_000])
          for (const pr of [null, P0]) s.push({ c: C, fn: 'W.resolveChain', args: ['expense', { requester_id: u.id, amount_paise: amt, project_id: pr, reviewer_id: u.reports_to_id ?? null }, steps] })
    for (const p of PROCESSES)
      for (const u of users)
        for (const leg of [null, admin, active[1]?.id])
          for (const amt of [null, 3_000_000]) {
            const i = s.length
            s.push({ c: C, fn: 'W.startApproval', args: [p, { requester_id: u.id, amount_paise: amt, project_id: P0, reviewer_id: u.reports_to_id ?? null }, leg] })
            if (leg === admin) {
              s.push({ fn: 'W.wfPatch', args: [{ $prev: i }] })
              s.push({ fn: 'W.stepLabel', args: [{ $prev: i }] })
              s.push({ c: C, fn: 'W.stepDue', args: [{ $prev: i }] })
              s.push({ c: C, fn: 'W.escalationTarget', args: [{ $prev: i }] })
              s.push({ c: C, fn: 'W.approvalRoute', args: [{ $prev: i }, true] })
              for (const a of [admin, active[1]?.id, 'nobody']) s.push({ c: C, fn: 'W.advanceApproval', args: [{ $prev: i }, a] })
            }
          }
    s.push({ fn: 'W.wfClear', args: [] })
    for (const w of db.approval_workflows.filter((x) => x.tenant_id === tid)) {
      s.push({ c: C, fn: 'W.chainSummary', args: [w.steps] })
      for (const st of w.steps) s.push({ c: C, fn: 'W.stepSummary', args: [st] })
    }
    for (const steps of custom) {
      s.push({ c: C, fn: 'W.chainSummary', args: [steps] })
      for (const st of steps) s.push({ c: C, fn: 'W.stepSummary', args: [st] })
    }
    cases.push({ id: `${name}/${tid}/resolve`, fixture: name, tenant: tid, steps: s })

    /* ---------- approval records ---------- */
    const r = []
    for (const [table, process] of Object.entries(REC_TABLES)) {
      for (const rec of db[table].filter((x) => x.tenant_id === tid)) {
        const row = { $row: [table, rec.id] }
        r.push({ fn: 'W.stepLabel', args: [row] })
        r.push({ c: C, fn: 'W.stepDue', args: [row] })
        r.push({ c: C, fn: 'W.escalationTarget', args: [row] })
        r.push({ c: C, fn: 'W.approvalRoute', args: [row, true] })
        r.push({ c: C, fn: 'W.approvalRoute', args: [row, false] })
        const inp = inputOf(rec)
        for (const [leg, cur] of [[null, { $undef: 1 }], [admin, { $undef: 1 }], [null, null], [rec.approver_id ?? null, active[1]?.id ?? null], [null, 'nobody']]) {
          const i = r.length
          r.push({ c: C, fn: 'W.ensureWf', args: [row, process, inp, leg, cur] })
          r.push({ fn: 'W.stepLabel', args: [{ $prev: i }] })
          r.push({ c: C, fn: 'W.approvalRoute', args: [{ $prev: i }, true] })
          r.push({ c: C, fn: 'W.advanceApproval', args: [{ $prev: i }, rec.approver_id ?? admin] })
          r.push({ c: C, fn: 'W.advanceApproval', args: [{ $prev: i }, admin] })
        }
      }
    }
    // records without ids/fields
    r.push({ c: C, fn: 'W.ensureWf', args: [{}, 'leave', { requester_id: active[2]?.id }, null] })
    r.push({ c: C, fn: 'W.ensureWf', args: [{ approver_id: admin, wf_chain: [], wf_step: 0 }, 'expense', { requester_id: active[2]?.id, amount_paise: 9_000_000 }, null] })
    r.push({ c: C, fn: 'W.ensureWf', args: [{ approver_id: 'x', wf_chain: [{ approver_id: 'x', name: 'A' }], wf_step: 3, updated_at: '2026-01-01T00:00:00.000Z' }, 'timesheet', { requester_id: active[2]?.id }, null] })
    for (const x of [null, undefined, {}, { wf_chain: [{ name: 'A', approver_id: admin }], wf_step: 0 }, { wf_chain: [{ name: 'A', approver_id: admin, sla_days: 0 }, { name: 'B', approver_id: 'u', decided_by: admin, escalated_from: admin, escalate_to_id: admin }], wf_step: 1, wf_step_at: `${D}T03:00:00.000Z` }]) {
      const a = x === undefined ? { $undef: 1 } : x
      r.push({ fn: 'W.stepLabel', args: [a] })
      r.push({ c: C, fn: 'W.stepDue', args: [a] })
      r.push({ c: C, fn: 'W.escalationTarget', args: [a] })
      r.push({ c: C, fn: 'W.approvalRoute', args: [a, true] })
      r.push({ c: C, fn: 'W.approvalRoute', args: [a, false] })
    }
    cases.push({ id: `${name}/${tid}/records`, fixture: name, tenant: tid, steps: r })

    /* ---------- escalation: workflows with escalation targets, every record put on a chain, aged ---------- */
    const esc = freshDb(fx)
    install(esc)
    const st = (id, nm, approver, x = {}) => ({ id, name: nm, approver, sla_days: 2, role_id: null, user_id: null, min_amount_paise: null, escalate_to: null, allow_self: false, ...x })
    for (const w of esc.approval_workflows.filter((x) => x.tenant_id === tid)) {
      w.steps =
        w.process === 'task_review'
          ? [st('e1', 'Reviewer', 'task_reviewer', { escalate_to: { approver: 'project_pm', role_id: null, user_id: null } })]
          : [
              st('e1', 'Manager approval', 'reports_to', { escalate_to: { approver: 'role', role_id: 'ceo', user_id: null } }),
              st('e2', 'Director', 'role', { role_id: 'project_manager', sla_days: 3, escalate_to: { approver: 'skip_level', role_id: null, user_id: null }, min_amount_paise: ['expense', 'purchase_order', 'vendor_bill'].includes(w.process) ? 1_000_000 : null }),
            ]
    }
    const ectx = M.S.buildCtx(esc.users.find((u) => u.id === admin), tid, {})
    ectx.today = D
    let k = 0
    for (const [table, process] of Object.entries(REC_TABLES))
      for (const rec of esc[table].filter((x) => x.tenant_id === tid)) {
        const wf = M.W.startApproval(ectx, process, inputOf(rec), admin)
        k++
        Object.assign(rec, wf, { wf_step_at: `${addDays(D, -(k % 9))}T0${k % 10}:15:00.000Z`, wf_step: k % 4 === 0 && wf.wf_chain.length > 1 ? 1 : 0 })
        if (table === 'tasks') rec.wf_approver_id = wf.approver_id
      }
    const setup = { approval_workflows: esc.approval_workflows, ...Object.fromEntries(Object.keys(REC_TABLES).map((t) => [t, esc[t]])) }
    for (const today of [D, addDays(D, 3), addDays(D, 12), addDays(D, 60)]) {
      const e = []
      const CT = c(admin, today)
      for (const [table] of Object.entries(REC_TABLES))
        for (const rec of esc[table].filter((x) => x.tenant_id === tid)) {
          const row = { $row: [table, rec.id] }
          e.push({ c: CT, fn: 'W.stepDue', args: [row] })
          e.push({ c: CT, fn: 'W.escalationTarget', args: [row] })
          e.push({ c: CT, fn: 'W.escalateIfDue', args: [table, row, ENTITY[table], `Item ${rec.id} “x”`, `/x/${rec.id}`], w: true, wt: [table, 'notifications', 'activity_log'] })
          e.push({ c: CT, fn: 'W.escalateIfDue', args: [table, row, ENTITY[table], `Item ${rec.id}`, `/x/${rec.id}`], w: true, wt: [table, 'notifications', 'activity_log'] })
          e.push({ fn: 'W.stepLabel', args: [row] })
          e.push({ c: CT, fn: 'W.approvalRoute', args: [row, true] })
        }
      cases.push({ id: `${name}/${tid}/escalate/${today}`, fixture: name, tenant: tid, setup, steps: e })
    }

    /* ---------- validation ---------- */
    const v = []
    for (const [p, inp, ack] of validationInputs(users)) v.push({ c: C, fn: 'W.validateSteps', args: [p, inp === undefined ? { $undef: 1 } : inp, ack] })
    cases.push({ id: `${name}/${tid}/validate`, fixture: name, tenant: tid, steps: v })
    // an inactive role (WF_ROLE) and a deactivated escalation target
    const roles2 = db.roles.map((x) => (x.tenant_id === tid && x.key === 'cto' ? { ...x, active: false } : x))
    const v2 = [['expense', [{ id: 's1', name: 'CTO', approver: 'role', role_id: 'cto' }], false], ['leave', [{ id: 's1', name: 'Mgr', approver: 'reports_to', escalate_to: { approver: 'role', role_id: 'cto' } }], false], ['leave', [{ id: 's1', name: 'Mgr', approver: 'reports_to', escalate_to: { approver: 'user', user_id: users.find((u) => u.status !== 'active')?.id ?? 'nobody' } }], false]]
    cases.push({ id: `${name}/${tid}/validate-inactive`, fixture: name, tenant: tid, setup: { roles: roles2 }, steps: v2.map(([p, inp, ack]) => ({ c: C, fn: 'W.validateSteps', args: [p, inp, ack] })) })

    /* ---------- routes ---------- */
    const q = []
    for (const u of users.filter((x) => x.status === 'active')) q.push({ c: c(u.id, D), fn: 'route:GET /workflows', args: [{}] })
    for (const va of ['employee', 'hr_manager', 'project_manager']) q.push({ c: c(admin, D, va), fn: 'route:GET /workflows', args: [{}] })
    const emp = active.find((u) => u.role_key === 'employee')?.id ?? admin
    const W = (proc, body, ifMatch = { $undef: 1 }, who = admin) => q.push({ c: c(who, D), fn: 'route:PUT /workflows/:process', args: [{ process: proc }, body, ifMatch], w: true, wt: RT })
    const ok = [{ id: 's1', name: 'Manager approval', approver: 'reports_to', sla_days: 3 }]
    W('leave', { steps: ok }, { $undef: 1 }, emp)
    W('bogus', { steps: ok })
    W('constructor', { steps: ok })
    W('leave', { steps: [] })
    W('leave', { steps: ok, name: 'ab' })
    W('leave', { steps: ok }, 999)
    W('leave', { steps: ok }, { $nan: 1 })
    W('leave', { steps: [{ id: 's1', name: 'Manager approval', approver: 'reports_to', sla_days: 2 }] })
    W('leave', { steps: ok, name: '  Leave approval v2  ', description: 'd'.repeat(310), require_reason_on_reject: false }, 1)
    W('leave', { steps: ok, name: 'Leave approval v3' })
    W('expense', { steps: [{ id: 'x1', name: 'CEO above 1L', approver: 'role', role_id: 'ceo', min_amount_paise: 10_000_000 }] })
    W('expense', { steps: [{ id: 'x1', name: 'CEO above 1L', approver: 'role', role_id: 'ceo', min_amount_paise: 10_000_000 }], acknowledge_fallback: true })
    W('timesheet', { steps: [{ name: 'Mgr', approver: 'reports_to' }, { name: 'Skip', approver: 'skip_level', escalate_to: { approver: 'role', role_id: 'ceo' } }] })
    W('task_review', { steps: ok, notify_requester: 'yes' })
    for (const p of [...PROCESSES, 'bogus']) q.push({ c: C, fn: 'route:POST /workflows/:process/reset', args: [{ process: p }, {}, { $undef: 1 }], w: true, wt: RT })
    q.push({ c: c(emp, D), fn: 'route:POST /workflows/:process/reset', args: [{ process: 'leave' }, {}, { $undef: 1 }], w: true, wt: RT })
    q.push({ c: C, fn: 'route:POST /workflows/:process/reset', args: [{ process: 'vendor_bill' }, {}, 0], w: true, wt: RT })
    q.push({ c: C, fn: 'route:GET /workflows', args: [{}] })
    // simulations
    const S = (proc, body, who = admin, va = '') => q.push({ c: c(who, D, va), fn: 'route:POST /workflows/:process/simulate', args: [{ process: proc }, body] })
    for (const p of PROCESSES)
      for (const u of users)
        for (const amt of [undefined, null, '', 3_000_000, 2_500_000])
          S(p, { requester_id: u.id, ...(amt === undefined ? {} : { amount_paise: amt }), ...(p === 'expense' || p === 'task_review' ? { project_id: P0 } : {}) })
    for (const steps of custom.slice(1)) for (const u of users.slice(0, 6)) S('expense', { requester_id: u.id, amount_paise: 3_000_000, project_id: P1, steps })
    S('expense', { requester_id: active[2]?.id, steps: [] })
    S('expense', { requester_id: active[2]?.id, steps: [{ name: 'x' }] })
    S('expense', { requester_id: active[2]?.id, amount_paise: -5 })
    S('expense', { requester_id: active[2]?.id, amount_paise: 'abc' })
    S('expense', { requester_id: active[2]?.id, amount_paise: '1200' })
    S('expense', { requester_id: active[2]?.id, project_id: 'nope' })
    S('task_review', { requester_id: active[2]?.id, reviewer_id: admin })
    S('task_review', { requester_id: active[2]?.id, reviewer_id: 'nobody', project_id: P0 })
    S('leave', { requester_id: 'nobody' })
    S('leave', {})
    S('bogus', { requester_id: admin })
    S('leave', { requester_id: admin }, emp)
    S('leave', { requester_id: admin }, admin, 'employee')
    cases.push({ id: `${name}/${tid}/routes`, fixture: name, tenant: tid, steps: q })

    /* ---------- provisioning (idempotent; fills missing processes) ---------- */
    const keep = db.approval_workflows.filter((w) => !(w.tenant_id === tid && (w.process === 'leave' || w.process === 'task_review')))
    cases.push({
      id: `${name}/${tid}/provision`, fixture: name, tenant: tid, setup: { approval_workflows: keep },
      steps: [{ c: C, fn: 'X.provision', args: [tid], w: true }, { c: C, fn: 'X.provision', args: [tid], w: true }, { c: C, fn: 'W.workflowFor', args: ['leave'] }],
    })
  }
}
for (const k of cases) runCase(fxs[k.fixture], k)
const n = cases.reduce((s, k) => s + k.steps.length, 0)
const kinds = {}
for (const k of cases) for (const s of k.steps) kinds[Object.keys(s.r)[0]] = (kinds[Object.keys(s.r)[0]] ?? 0) + 1
console.log(`${cases.length} cases, ${n} vectors`, kinds, cases.flatMap((k) => k.steps.filter((s) => s.r.throws).map((s) => `${k.id} ${s.fn} ${s.r.throws}`)).slice(0, 8))
writeGz('workflows', { generated_by: 'gen/workflows.mjs', cases })
