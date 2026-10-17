// Golden vectors for app/routes/timesheets.py + app/routes/payroll.py (ports of src/mock/routes/timesheets.ts and
// payroll.ts) on the full seed:  TZ=Asia/Kolkata node backend/tests/golden/gen/timesheets.mjs -> vectors/timesheets.json.gz
// Reads for many users / days (lazy locks, approvals, team grid, leave, daily), every write route with valid + invalid
// bodies and allowed + denied users: weekly save rules (min/max hours, steps, future entries, Saturday working /
// Sunday off, holidays, leave sync, HR leave), submit (auto-approve, short-day warnings, multi-step workflow), approve /
// reject / bulk / unlock / unlock-week / deny-unlock (delegation, self, late), daily updates + demo, leave entry, and
// payroll (LWP + unapproved deductions, recalculation, maker-checked finalisation, ledger Salaries row, payslips).
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('timesheets', `export * as ts from '@/mock/routes/timesheets'\nexport * as pr from '@/mock/routes/payroll'\nexport * as mc from '@/mock/makerChecker'\n`)
const { server, ts, pr, mc } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = [
  'timesheet_weeks', 'timesheet_entries', 'leave', 'daily_updates', 'notifications', 'activity_log', 'payroll_runs', 'payroll_lines', 'ledger_entries',
  'change_sets', 'issued_documents', 'number_sequences', 'files', 'email_outbox',
]
const K = kit({
  server, T, modules: [ts, pr, mc], tables: TABLES,
  fns: {
    resolveApprover: (ctx, a) => server.rows(ctx, 'users').map((u) => [u.id, ts.resolveApprover(ctx, u)]),
    canDecide: (ctx) => server.rows(ctx, 'timesheet_weeks').map((w) => [w.id, ts.canDecide(ctx, w)]),
    findWeek: (ctx, a) => ts.findWeek(ctx, a.user, a.monday),
    sweepLocks: (ctx) => {
      ts.sweepLocks(ctx)
      return server.rows(ctx, 'timesheet_weeks').map((w) => [w.id, w.status, w.version])
    },
    demoDateOf: (ctx, a) => a.mondays.map((m) => [ts.demoDateOf(ctx, m), ts.demoDateOf(ctx, m, a.user)]),
    leaveLabel: (_ctx, a) => a.types.map((t) => ts.leaveLabel(t)),
    optionalHolidayOn: (ctx, a) => a.dates.map((d) => ts.optionalHolidayOn(ctx, d)),
    timesheetOverride: (ctx) => ts.timesheetOverride(ctx),
    payrollRunLines: (ctx, a) => pr.payrollRunLines(ctx, a.id),
  },
})
const TODAY = seed.generated_on // 2026-10-15 (Thursday)
const S = []
const SEEREON = ['u_santosh', 'u_subhankar', 'u_hritesh', 'u_bijaya', 'u_jagannath', 'u_jayashree', 'u_pragyasmita', 'u_baishali', 'u_subham', 'u_priya', 'u_debasish']
const WEEKS = ['2026-10-12', '2026-10-05', '2026-09-28', '2026-10-19', '2026-07-06', '2026-10-13', 'abc', '2026-02-30']

// ---------- reads (several days: lazy locks happen on read) ----------
for (const today of [TODAY, '2026-10-19', '2026-10-26', '2026-11-03', '2026-10-17'])
  S.push(K.scenario(`reads seereon ${today}`, 'tn_seereon', today, (a) => {
    a.fn('u_santosh', 'resolveApprover')
    for (const u of SEEREON) {
      a.fn(u, 'canDecide')
      for (const w of WEEKS) a.call(u, 'GET', '/timesheets/:week', { params: { week: w } })
      a.call(u, 'GET', '/timesheet/work-items')
      a.call(u, 'GET', '/timesheet/work-items', { query: { week: '2026-10-05' } })
      a.call(u, 'GET', '/timesheet/work-items', { query: { week: '2026-10-14' } })
      a.call(u, 'GET', '/approvals')
      a.call(u, 'GET', '/approvals/summary')
      for (const n of [undefined, '8', '2', '20', 'x', '5.5']) a.call(u, 'GET', '/approvals/team', { query: n === undefined ? {} : { weeks: n } })
      for (const n of [undefined, '12', '3', 'x']) a.call(u, 'GET', '/team/grid', { query: n === undefined ? {} : { weeks: n } })
      a.call(u, 'GET', '/daily')
      a.call(u, 'GET', '/daily', { query: { date: '2026-10-12' } })
      a.call(u, 'GET', '/daily', { query: { date: '2026-10-09' } })
      for (const sc of [undefined, 'mine', 'team', 'all', 'xyz']) a.call(u, 'GET', '/leave', { query: sc === undefined ? {} : { scope: sc } })
      a.call(u, 'GET', '/leave', { query: { scope: 'all', user: 'u_jagannath', from: '2026-09-01', to: '2026-12-31' } })
      a.call(u, 'GET', '/leave/summary')
      a.call(u, 'GET', '/leave/summary', { query: { fy: '2025' } })
      a.call(u, 'GET', '/holidays-lite')
      a.call(u, 'GET', '/holidays-lite', { query: { from: '2026-10-01', to: '2026-10-31' } })
    }
    // other people's weeks
    for (const [viewer, who] of [['u_subhankar', 'u_hritesh'], ['u_santosh', 'u_jagannath'], ['u_baishali', 'u_hritesh'], ['u_hritesh', 'u_santosh'], ['u_priya', 'u_bijaya'], ['u_santosh', 'u_nope'], ['u_debasish', 'u_ankit'], ['u_hritesh', 'u_bijaya']])
      for (const w of ['2026-10-12', '2026-10-05', '2026-06-01']) a.call(viewer, 'GET', '/timesheets/:week', { params: { week: w }, query: { user: who } })
    a.fn('u_santosh', 'findWeek', { user: 'u_jayashree', monday: '2026-10-12' })
    a.fn('u_santosh', 'findWeek', { user: 'u_jayashree', monday: '2026-01-05' })
    a.fn('u_santosh', 'demoDateOf', { user: 'u_jagannath', mondays: ['2026-10-12', '2026-10-05', '2026-09-28', '2026-11-02', '2026-12-21', '2026-10-19'] })
    a.fn('u_santosh', 'leaveLabel', { types: ['casual', 'sick', 'earned', 'compensatory', 'lwp', 'optional_holiday', 'nope'] })
    a.fn('u_santosh', 'optionalHolidayOn', { dates: ['2026-10-17', '2026-09-15', '2026-10-20', '2026-10-18'] })
    a.fn('u_santosh', 'timesheetOverride')
    a.fn('u_hritesh', 'timesheetOverride')
    a.fn('u_santosh', 'sweepLocks')
  }))
S.push(K.scenario('reads kalinga', 'tn_kalinga', TODAY, (a) => {
  for (const u of ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha', 'u_k_arjun', 'u_k_meera']) {
    for (const w of ['2026-10-12', '2026-10-05']) a.call(u, 'GET', '/timesheets/:week', { params: { week: w } })
    a.call(u, 'GET', '/approvals')
    a.call(u, 'GET', '/approvals/team')
    a.call(u, 'GET', '/team/grid')
    a.call(u, 'GET', '/leave', { query: { scope: 'all' } })
    a.call(u, 'GET', '/leave/summary')
    a.call(u, 'GET', '/daily')
  }
}))
// settings variants: no lock, breaks don't count, Saturdays all off / all on, no future entries
for (const [name, values] of [
  ['no lock', { 'timesheet.weekly_lock': false }],
  ['breaks off', { 'calendar.breaks_count': false }],
  ['sat all off', { 'calendar.saturday_rule': 'all_off' }],
  ['sat all on + sunday', { 'calendar.saturday_rule': 'all_on', 'calendar.weekly_off': [] }],
  ['min 8 step 0.25', { 'calendar.min_hours_per_day': 8, 'timesheet.hours_step': 0.25, 'timesheet.allow_future_entries': false, 'timesheet.internal_note_required': false, 'approval.bulk_approve': false }],
])
  S.push(K.scenario(`reads ${name}`, 'tn_seereon', TODAY, (a) => {
    for (const u of ['u_hritesh', 'u_subhankar', 'u_santosh']) {
      for (const w of ['2026-10-12', '2026-10-05', '2026-09-28']) a.call(u, 'GET', '/timesheets/:week', { params: { week: w } })
      a.call(u, 'GET', '/timesheet/work-items')
      a.call(u, 'GET', '/approvals')
      a.call(u, 'GET', '/approvals/team')
      a.call(u, 'GET', '/team/grid')
    }
  }, [{ kind: 'settings', id: 'tn_seereon', values }]))

// ---------- weekly save rules ----------
const H = (o) => o
S.push(K.scenario('save rules', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const W = '2026-10-12'
  const put = (rows, o = {}) => C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows }, ...o })
  // shape errors
  put(undefined)
  put('x')
  C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: W }, body: [] })
  put([{ kind: 'nope' }])
  put([{}])
  put([null])
  put(['x'])
  put([{ kind: 'task', task_id: 't_missing', hours: { [W]: 2 } }])
  put([{ kind: 'task', task_id: 42, hours: { [W]: 2 } }])
  put([{ kind: 'task', task_id: 't_hrms_1', hours: { [W]: 2 } }])
  put([{ kind: 'task', task_id: 't_samet_1', hours: { [W]: 2 } }])
  put([{ kind: 'internal', internal_code: 'nope', hours: { [W]: 2 } }])
  put([{ kind: 'internal', internal_code: 'learning', hours: { [W]: 2 } }])
  put([{ kind: 'internal', internal_code: 'learning', note: 'ok', hours: { [W]: 2 } }])
  put([{ kind: 'internal', internal_code: 'breaks', hours: { [W]: 1 } }])
  put([{ kind: 'internal', internal_code: 'learning', note: 'Course', project_id: 'p_nope', hours: { [W]: 2 } }])
  put([{ kind: 'leave', leave_type: 'nope', hours: { [W]: 9 } }])
  put([{ kind: 'leave', hours: { [W]: 9 } }])
  // hours errors
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-19': 2 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { 'not-a-date': 2 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 25 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: -1 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 'abc' } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 2.25 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: '2.5' } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-16': 4 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 10 } }, { kind: 'task', task_id: 't_mgs_5', hours: { [W]: 7 } }])
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 2 } }, { kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-13': 2 } }])
  put([{ kind: 'internal', internal_code: 'learning', note: 'Course', hours: { [W]: 1 } }, { kind: 'internal', internal_code: 'learning', note: ' course ', hours: { '2026-10-13': 1 } }])
  // leave rows: Sunday (weekly off), Saturday 17th (3rd Saturday = working, optional holiday), optional holiday elsewhere
  put([{ kind: 'leave', leave_type: 'casual', hours: { '2026-10-18': 9 } }])
  put([{ kind: 'leave', leave_type: 'optional_holiday', hours: { '2026-10-16': 9 } }])
  put([{ kind: 'leave', leave_type: 'optional_holiday', hours: { '2026-10-17': 9 } }])
  put([{ kind: 'leave', leave_type: 'casual', hours: { '2026-10-16': 4.5 } }])
  // a full valid week: task hours Mon–Sat (Saturday the 17th is a working Saturday), a Sunday hour, internal + note
  const ok = put([
    { kind: 'task', task_id: 't_hrms_5', hours: { [W]: 6, '2026-10-13': 7, '2026-10-14': 5.5, '2026-10-15': 3, '2026-10-17': 2, '2026-10-18': 1 } },
    { kind: 'task', task_id: 't_mgs_5', hours: { [W]: 3, '2026-10-13': 2 } },
    { kind: 'internal', internal_code: 'meeting', note: 'Sprint planning', project_id: 'p_hrms', hours: { '2026-10-14': 1.5 } },
    { kind: 'internal', internal_code: 'breaks', hours: { '2026-10-14': 1 } },
    { kind: 'leave', leave_type: 'sick', hours: { '2026-10-15': 4.5 } },
    { kind: 'task', task_id: 't_gen_seereon_laptop', hours: {} },
  ])
  C('u_hritesh', 'GET', '/timesheets/:week', { params: { week: W } })
  C('u_hritesh', 'GET', '/leave')
  // stale If-Match, then a save that turns the half day into a full day and back
  if (ok.v) put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 6 } }], { ifMatch: ok.v.version - 1 })
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 6 } }, { kind: 'leave', leave_type: 'earned', hours: { '2026-10-15': 9 } }, { kind: 'leave', leave_type: 'sick', hours: { '2026-10-16': 4 } }])
  C('u_hritesh', 'GET', '/leave')
  put([{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 6 } }])
  C('u_hritesh', 'GET', '/leave')
  // HR leave of Jagannath (13th, 14th) is kept as is
  C('u_jagannath', 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows: [{ kind: 'leave', leave_type: 'sick', hours: { '2026-10-13': 9 } }, { kind: 'task', task_id: 't_hrms_4', hours: { '2026-10-12': 9, '2026-10-14': 8 } }] } })
  C('u_jagannath', 'GET', '/timesheets/:week', { params: { week: W } })
  // locked and submitted weeks
  C('u_jagannath', 'PUT', '/timesheets/:week', { params: { week: '2026-10-05' }, body: { rows: [] } })
  C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: '2026-10-05' }, body: { rows: [] } })
  C('u_santosh', 'PUT', '/timesheets/:week', { params: { week: '2026-10-05' }, body: { rows: [] } })
  C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: '2026-10-13' }, body: { rows: [] } })
  // a future week (allowed by the settings) and a past open week
  C('u_pragyasmita', 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows: [{ kind: 'task', task_id: 't_samet_1', hours: { [W]: 2 } }] } })
  C('u_pragyasmita', 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows: [{ kind: 'task', task_id: 't_samet_1', hours: {} }] } })
  C('u_bijaya', 'PUT', '/timesheets/:week', { params: { week: '2026-10-26' }, body: { rows: [{ kind: 'task', task_id: 't_hrms_12', hours: { '2026-10-26': 2 } }] } })
  C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: '2026-11-02' }, body: { rows: [{ kind: 'leave', leave_type: 'casual', hours: { '2026-11-02': 9 } }] } })
}))
S.push(K.scenario('save rules strict settings', 'tn_seereon', TODAY, (a) => {
  const W = '2026-10-12'
  const put = (u, rows) => a.call(u, 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows } })
  put('u_hritesh', [{ kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-16': 2 } }])
  put('u_hritesh', [{ kind: 'leave', leave_type: 'casual', hours: { '2026-10-16': 8 } }])
  put('u_hritesh', [{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 2.25 } }])
  put('u_hritesh', [{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 2.3 } }])
  put('u_hritesh', [{ kind: 'internal', internal_code: 'learning', hours: { [W]: 2 } }])
  put('u_hritesh', [{ kind: 'leave', leave_type: 'casual', hours: { '2026-10-17': 8 } }])
  put('u_hritesh', [{ kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-18': 2 } }])
  put('u_hritesh', [{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 8, '2026-10-13': 7.75, '2026-10-14': 9 } }, { kind: 'leave', leave_type: 'lwp', hours: { '2026-10-15': 4 } }])
  a.call('u_hritesh', 'GET', '/timesheets/:week', { params: { week: W } })
  a.call('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: W } })
  a.call('u_subhankar', 'POST', '/approvals/bulk-approve', { body: { ids: ['wk_hritesh_2026-10-12'] } })
}, [{ kind: 'settings', id: 'tn_seereon', values: { 'calendar.min_hours_per_day': 8, 'timesheet.hours_step': 0.25, 'timesheet.allow_future_entries': false, 'timesheet.internal_note_required': false, 'approval.bulk_approve': false, 'calendar.saturday_rule': 'all_off', 'calendar.weekly_off': [] } }]))

// ---------- submit, copy, unlock request ----------
S.push(K.scenario('submit', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const W = '2026-10-12'
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-19' } })
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-26' } })
  C('u_bijaya', 'POST', '/timesheets/:week/submit', { params: { week: W }, body: { rows: [] } })
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: W }, ifMatch: 99 })
  // copy last week first (rows only, then with hours)
  C('u_hritesh', 'POST', '/timesheets/:week/copy-previous', { params: { week: W } })
  C('u_hritesh', 'POST', '/timesheets/:week/copy-previous', { params: { week: W } })
  C('u_hritesh', 'POST', '/timesheets/:week/copy-previous', { params: { week: W }, body: { with_hours: true } })
  C('u_santosh', 'POST', '/timesheets/:week/copy-previous', { params: { week: '2026-07-06' } })
  C('u_jagannath', 'POST', '/timesheets/:week/copy-previous', { params: { week: '2026-10-05' } })
  const r = C('u_hritesh', 'POST', '/timesheets/:week/submit', {
    params: { week: W },
    body: { rows: [{ kind: 'task', task_id: 't_hrms_5', hours: { [W]: 9, '2026-10-13': 6, '2026-10-14': 9.5 } }, { kind: 'internal', internal_code: 'breaks', hours: { '2026-10-13': 3 } }, { kind: 'task', task_id: 't_mgs_5', hours: {} }] },
  })
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: W } })
  C('u_hritesh', 'PUT', '/timesheets/:week', { params: { week: W }, body: { rows: [] } })
  C('u_subhankar', 'GET', '/approvals')
  C('u_subhankar', 'GET', '/approvals/summary')
  // the top person auto-approves; a rejected week is resubmitted
  C('u_santosh', 'POST', '/timesheets/:week/submit', { params: { week: W }, body: { rows: [{ kind: 'internal', internal_code: 'admin', note: 'Board prep', hours: { [W]: 9, '2026-10-13': 9 } }] } })
  C('u_subham', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-05' } })
  C('u_santosh', 'GET', '/approvals')
  // unlock requests
  C('u_jayashree', 'POST', '/timesheets/:week/unlock-request', { params: { week: '2026-10-05' }, body: { reason: 'abc' } })
  C('u_jayashree', 'POST', '/timesheets/:week/unlock-request', { params: { week: '2026-10-05' }, body: { reason: '  I was on a client site with no laptop access all week — need to log it  ' } })
  C('u_jayashree', 'POST', '/timesheets/:week/unlock-request', { params: { week: W }, body: { reason: 'Need to fix it' } })
  C('u_jagannath', 'POST', '/timesheets/:week/unlock-request', { params: { week: '2026-10-05' }, body: { reason: 'Forgot to submit' } })
  C('u_santosh', 'POST', '/timesheets/:week/unlock-request', { params: { week: '2026-06-01' }, body: { reason: 'Old week, please' } })
  C('u_subhankar', 'GET', '/approvals')
  C('u_santosh', 'GET', '/approvals/team')
  if (r.v) C('u_hritesh', 'GET', '/timesheets/:week', { params: { week: W } })
}))
// multi-step timesheet workflow (manager, then CEO) with a delegate
S.push(K.scenario('multi-step workflow', 'tn_seereon', '2026-11-03', (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const W = '2026-11-02'
  C('u_bijaya', 'POST', '/timesheets/:week/submit', { params: { week: W }, body: { rows: [{ kind: 'task', task_id: 't_hrms_12', hours: { '2026-11-02': 9, '2026-11-03': 9 } }] } })
  C('u_hritesh', 'GET', '/approvals')
  C('u_hritesh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-11-02' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-11-02' } })
  C('u_santosh', 'GET', '/approvals')
  C('u_santosh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-11-02' } })
  C('u_bijaya', 'GET', '/timesheets/:week', { params: { week: W } })
  // the delegate decides a pre-existing submitted week (Subhankar → Hritesh, 2–6 Nov)
  C('u_hritesh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-10-05' } })
  C('u_hritesh', 'POST', '/approvals/:weekId/reject', { params: { weekId: 'wk_pragyasmita_2026-09-28' }, body: { reason: 'Split the client hours by task please' } })
}, [{ kind: 'set', table: 'approval_workflows', id: 'r_016q', values: { description: 'Manager then CEO', steps: [{ id: 's1', name: 'Manager approval', approver: 'reports_to', sla_days: 2 }, { id: 's2', name: 'CEO approval', approver: 'role', role_id: 'ceo', sla_days: 2 }] } }]))

S.push(K.scenario('multi-step reject and skip', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  C('u_subhankar', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-12' }, body: { rows: [{ kind: 'internal', internal_code: 'admin', note: 'Planning', hours: { '2026-10-12': 9, '2026-10-13': 9, '2026-10-14': 9 } }] } })
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-12' }, body: { rows: [{ kind: 'task', task_id: 't_hrms_5', hours: { '2026-10-12': 9, '2026-10-13': 9, '2026-10-14': 9 } }] } })
  C('u_subhankar', 'GET', '/approvals')
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_hritesh_2026-10-12' } })
  C('u_santosh', 'GET', '/approvals')
  C('u_santosh', 'POST', '/approvals/:weekId/reject', { params: { weekId: 'wk_hritesh_2026-10-12' }, body: { reason: 'Hours look too high' } })
  C('u_hritesh', 'POST', '/timesheets/:week/submit', { params: { week: '2026-10-12' } })
  C('u_subhankar', 'POST', '/approvals/bulk-approve', { body: { ids: ['wk_hritesh_2026-10-12', 'wk_hritesh_2026-10-05'] } })
  C('u_santosh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_subhankar_2026-10-12' } })
  C('u_santosh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_hritesh_2026-10-12' } })
  C('u_hritesh', 'GET', '/timesheets/:week', { params: { week: '2026-10-12' } })
  // a pre-workflow submitted week gets its chain built on approval (legacy step)
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-10-05' } })
  C('u_santosh', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_bijaya_2026-10-05' } })
}, [{ kind: 'set', table: 'approval_workflows', id: 'r_016q', values: { steps: [{ id: 's1', name: 'Manager approval', approver: 'reports_to', sla_days: 2 }, { id: 's2', name: 'CEO approval', approver: 'role', role_id: 'ceo', sla_days: 2 }] } }]))

// ---------- approvals ----------
S.push(K.scenario('approvals', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = (weekId) => ({ params: { weekId } })
  C('u_hritesh', 'POST', '/approvals/:weekId/approve', P('wk_hritesh_2026-10-05'))
  C('u_baishali', 'POST', '/approvals/:weekId/approve', P('wk_hritesh_2026-10-05'))
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', P('wk_nope'))
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', { ...P('wk_hritesh_2026-10-05'), ifMatch: 99 })
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', P('wk_hritesh_2026-10-05'))
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', P('wk_hritesh_2026-10-05'))
  C('u_subhankar', 'POST', '/approvals/:weekId/approve', P('wk_pragyasmita_2026-09-28'))
  C('u_santosh', 'POST', '/approvals/:weekId/approve', P('wk_priya_2026-09-28'))
  C('u_debasish', 'POST', '/approvals/:weekId/approve', P('wk_baishali_2026-10-05'))
  // reject
  C('u_subhankar', 'POST', '/approvals/:weekId/reject', { ...P('wk_bijaya_2026-10-05'), body: { reason: 'no' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/reject', { ...P('wk_bijaya_2026-10-05'), body: { reason: '  Please add the task notes  ' }, ifMatch: 99 })
  C('u_subhankar', 'POST', '/approvals/:weekId/reject', { ...P('wk_bijaya_2026-10-05'), body: { reason: '  Please add the task notes  ' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/reject', { ...P('wk_bijaya_2026-10-05'), body: { reason: 'again please' } })
  C('u_bijaya', 'GET', '/timesheets/:week', { params: { week: '2026-10-05' } })
  // bulk
  C('u_subhankar', 'POST', '/approvals/bulk-approve', { body: {} })
  C('u_subhankar', 'POST', '/approvals/bulk-approve', { body: { ids: 'x' } })
  C('u_santosh', 'POST', '/approvals/bulk-approve', { body: { ids: ['wk_baishali_2026-10-05', 'wk_nope', 'wk_santosh_2026-10-12', 'wk_debasish_2026-10-05', 'wk_hritesh_2026-10-05', 'wk_baishali_2026-10-05', 5] } })
  C('u_subhankar', 'POST', '/approvals/bulk-approve', { body: { ids: ['wk_hritesh_2026-10-05', 'wk_baishali_2026-10-05'] } })
  // unlock (locked weeks of Jagannath — requested — and Jayashree — not requested)
  const U = (u, weekId, body) => C(u, 'POST', '/approvals/:weekId/unlock', { ...P(weekId), body })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: 3 })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: 0, reason: 'Reopening for fixes' })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: 8, reason: 'Reopening for fixes' })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: '2.5', reason: 'Reopening for fixes' })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: '3', reason: 'Reopening so you can log the client visit properly before payroll runs at month end' })
  U('u_subhankar', 'wk_jayashree_2026-10-05', { days: 3, reason: 'again' })
  U('u_hritesh', 'wk_jagannath_2026-10-05', { days: 2 })
  U('u_subhankar', 'wk_jagannath_2026-10-05', { days: 2 })
  U('u_jayashree', 'wk_jayashree_2026-10-05', { days: 2 })
  C('u_jayashree', 'GET', '/timesheets/:week', { params: { week: '2026-10-05' } })
  C('u_jayashree', 'PUT', '/timesheets/:week', { params: { week: '2026-10-05' }, body: { rows: [{ kind: 'task', task_id: 't_mgs_6', hours: { '2026-10-05': 9 } }] } })
  // deny unlock
  C('u_subhankar', 'POST', '/approvals/:weekId/deny-unlock', { ...P('wk_pragyasmita_2026-10-05'), body: { reason: 'Not needed' } })
  // unlock-week for a week without a timesheet
  const UW = (u, body) => C(u, 'POST', '/approvals/unlock-week', { body })
  UW('u_subhankar', {})
  UW('u_subhankar', { user_id: 'u_hritesh', week_start: '2026-06-02' })
  UW('u_subhankar', { user_id: 'u_nope', week_start: '2026-06-01' })
  UW('u_subhankar', { user_id: 'u_subhankar', week_start: '2026-06-01' })
  UW('u_subhankar', { user_id: 'u_hritesh', week_start: '2026-10-12' })
  UW('u_baishali', { user_id: 'u_hritesh', week_start: '2026-06-01' })
  UW('u_subhankar', { user_id: 'u_hritesh', week_start: '2026-06-01', days: 5 })
  UW('u_subhankar', { user_id: 'u_hritesh', week_start: '2026-06-01', days: 5, reason: 'Back-filling June for the audit' })
  UW('u_santosh', { user_id: 'u_priya', week_start: '2026-06-08', days: 1, reason: 'Audit back-fill' })
  C('u_subhankar', 'GET', '/approvals/team')
  C('u_santosh', 'GET', '/team/grid')
}))
S.push(K.scenario('deny unlock', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = { params: { weekId: 'wk_jagannath_2026-10-05' } }
  C('u_jagannath', 'POST', '/approvals/:weekId/deny-unlock', { ...P, body: { reason: 'Nope nope' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/deny-unlock', { ...P, body: { reason: 'no' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/deny-unlock', { ...P, body: { reason: 'The week is already in payroll' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/deny-unlock', { ...P, body: { reason: 'The week is already in payroll' } })
  C('u_subhankar', 'POST', '/approvals/:weekId/deny-unlock', { params: { weekId: 'wk_hritesh_2026-10-05' }, body: { reason: 'The week is already in payroll' } })
  C('u_jagannath', 'GET', '/timesheets/:week', { params: { week: '2026-10-05' } })
  C('u_subhankar', 'GET', '/approvals')
}))

// ---------- daily updates + demo ----------
for (const today of [TODAY, '2026-10-16', '2026-10-19'])
  S.push(K.scenario(`daily ${today}`, 'tn_seereon', today, (a) => {
    const C = (u, m, p, o) => a.call(u, m, p, o)
    for (const body of [{}, { done: 'tiny' }, { done: 'Finished the payslip exporter', date: '2099-01-01' }, { done: 'Finished the payslip exporter', date: '2026-10-01' },
      { done: 'Finished the payslip exporter' }, { done: 'Finished the payslip exporter', proof_url: 'ftp://x' }, { done: 'Finished the payslip exporter', proof_url: 'https://nodot' },
      { done: '  Finished the payslip exporter  ', proof_url: ' https://git.example.com/commit/1 ', blocker: '  Waiting for the HR sign-off  ' },
      { done: 'Finished the payslip exporter v2', proof_url: 'https://git.example.com/commit/2', blocker: 'Still waiting', demo_shown: true },
      { done: 'Fixed the import', proof_url: 'http://x.io', date: '2026-10-14' }])
      C('u_hritesh', 'POST', '/daily', { body })
    C('u_santosh', 'POST', '/daily', { body: { done: 'Board review prepared', proof_url: 'https://docs.example.com/b', blocker: 'Need numbers' } })
    for (const body of [{}, { demo_shown: true }, { demo_shown: true, demo_note: 'tiny' }, { demo_shown: true, demo_note: 'Demoed the leave approval flow end to end' }, { demo_shown: false, demo_note: 'ignored' }, { date: '2026-10-05', demo_shown: false }, { date: '2026-10-21' }])
      C('u_hritesh', 'POST', '/daily/demo', { body })
    C('u_jagannath', 'POST', '/daily/demo', { body: { demo_shown: true, demo_note: 'Biometric sync shown to the client' } })
    C('u_hritesh', 'GET', '/daily')
    C('u_subhankar', 'GET', '/daily')
    C('u_santosh', 'GET', '/daily', { query: { date: today } })
  }, [{ kind: 'settings', id: 'tn_seereon', values: { 'daily.proof_required': today !== '2026-10-19' } }]))

// ---------- leave ----------
S.push(K.scenario('leave', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const L = (u, body) => C(u, 'POST', '/leave', { body })
  L('u_hritesh', {})
  L('u_hritesh', { type: 'casual' })
  L('u_hritesh', { type: 'casual', from: '2026-10-22', to: '2026-10-21' })
  L('u_hritesh', { type: 'casual', from: '2026-10-22', to: '2027-01-30' })
  L('u_hritesh', { type: 'casual', portion: 'half', from: '2026-10-22', to: '2026-10-23' })
  L('u_hritesh', { type: 'casual', from: '2026-10-18' })
  L('u_hritesh', { type: 'casual', from: '2026-10-24', to: '2026-10-25' })
  L('u_hritesh', { type: 'nope', from: '2026-10-22' })
  L('u_hritesh', { type: 'casual', from: '2026/10/22' })
  L('u_hritesh', { user_id: 'u_bijaya', type: 'casual', from: '2026-10-22' })
  L('u_hritesh', { type: 'optional_holiday', from: '2026-10-22' })
  L('u_hritesh', { type: 'casual', from: '2026-10-05' })
  L('u_jayashree', { type: 'casual', from: '2026-10-06' })
  L('u_hritesh', { type: 'casual', from: '2026-10-21', to: '2026-10-27' })
  L('u_hritesh', { type: 'casual', from: '2026-10-21', to: '2026-10-27' })
  L('u_hritesh', { type: 'sick', portion: 'half', from: '2026-11-04' })
  L('u_hritesh', { type: 'optional_holiday', from: '2026-10-17' })
  L('u_priya', { user_id: 'u_ankit', type: 'casual', from: '2026-10-22' })
  L('u_priya', { user_id: 'u_nope', type: 'casual', from: '2026-10-22' })
  L('u_priya', { user_id: 'u_jayashree', type: 'lwp', from: '2026-10-05', to: '2026-10-06' })
  L('u_priya', { user_id: 'u_bijaya', type: 'earned', from: '2026-10-29', to: '2026-11-03' })
  L('u_priya', { user_id: 'u_bijaya', type: 'earned', from: '2026-10-29', to: '2026-11-03' })
  L('u_priya', { user_id: 'u_hritesh', type: 'casual', from: '2026-10-05' })
  C('u_hritesh', 'GET', '/leave')
  C('u_priya', 'GET', '/leave', { query: { scope: 'all' } })
  C('u_hritesh', 'GET', '/timesheets/:week', { params: { week: '2026-10-19' } })
  C('u_bijaya', 'GET', '/timesheets/:week', { params: { week: '2026-10-26' } })
  // deletions
  const own = a.db.leave.filter((x) => x.user_id === 'u_hritesh' && x.date >= '2026-10-21').map((x) => x.id)
  if (own[0]) {
    C('u_bijaya', 'DELETE', '/leave/:id', { params: { id: own[0] } })
    C('u_hritesh', 'DELETE', '/leave/:id', { params: { id: own[0] } })
    C('u_hritesh', 'DELETE', '/leave/:id', { params: { id: own[0] } })
  }
  const hrLeave = a.db.leave.find((x) => x.user_id === 'u_bijaya' && x.source === 'hr' && x.date === '2026-10-26')
  if (hrLeave) {
    C('u_bijaya', 'DELETE', '/leave/:id', { params: { id: hrLeave.id } })
    C('u_priya', 'DELETE', '/leave/:id', { params: { id: hrLeave.id } })
  }
  for (const x of a.db.leave.filter((l) => l.tenant_id === 'tn_seereon' && ['u_pragyasmita', 'u_jagannath', 'u_bijaya'].includes(l.user_id) && l.date < '2026-10-12').slice(0, 4)) {
    C(x.user_id, 'DELETE', '/leave/:id', { params: { id: x.id } })
    C('u_priya', 'DELETE', '/leave/:id', { params: { id: x.id } })
  }
  C('u_priya', 'GET', '/leave/summary')
  C('u_subhankar', 'GET', '/leave/summary')
  C('u_hritesh', 'GET', '/leave/summary')
}))
S.push(K.scenario('leave optional holiday balance', 'tn_seereon', TODAY, (a) => {
  a.call('u_hritesh', 'POST', '/leave', { body: { type: 'optional_holiday', from: '2026-10-17' } })
  a.call('u_jayashree', 'POST', '/leave', { body: { type: 'optional_holiday', from: '2026-10-17' } })
  a.call('u_priya', 'POST', '/leave', { body: { user_id: 'u_bijaya', type: 'optional_holiday', from: '2026-10-17' } })
  a.call('u_hritesh', 'GET', '/leave')
}, [{ kind: 'insert', table: 'leave_policies', row: { id: 'lp_oh', tenant_id: 'tn_seereon', created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z', created_by: null, version: 1, type: 'optional_holiday', annual_days: 1, carry_forward_max: 0, accrual: 'upfront' } }]))

// ---------- payroll ----------
for (const [name, values, today] of [
  ['payroll', {}, TODAY],
  ['payroll no deduction', { 'pay.deduct_unapproved_days': false, 'pay.target_default': 'rate' }, TODAY],
  ['payroll early november', {}, '2026-11-04'],
])
  S.push(K.scenario(name, 'tn_seereon', today, (a) => {
    const C = (u, m, p, o) => a.call(u, m, p, o)
    C('u_hritesh', 'GET', '/payroll')
    C('u_santosh', 'GET', '/payroll')
    C('u_santosh', 'GET', '/payroll/:id', { params: { id: 'pr_prev' } })
    C('u_santosh', 'GET', '/payroll/:id', { params: { id: 'pr_last' } })
    C('u_santosh', 'GET', '/payroll/:id', { params: { id: 'nope' } })
    a.fn('u_santosh', 'payrollRunLines', { id: 'pr_last' })
    for (const body of [{}, { month: '2026-13' }, { month: '2026-9' }, { month: '2099-01' }, { month: '2026-08' }])
      C('u_santosh', 'POST', '/payroll/run', { body })
    C('u_hritesh', 'POST', '/payroll/run', { body: { month: '2026-09' } })
    C('u_santosh', 'POST', '/payroll/run', { body: { month: '2026-09' } })
    const oct = C('u_santosh', 'POST', '/payroll/run', { body: { month: '2026-10' } })
    C('u_santosh', 'POST', '/payroll/run', { body: { month: '2026-07' } })
    C('u_santosh', 'POST', '/payroll/:id/recompute', { params: { id: 'pr_prev' } })
    C('u_santosh', 'POST', '/payroll/:id/recompute', { params: { id: 'pr_last' }, ifMatch: 99 })
    C('u_santosh', 'POST', '/payroll/:id/recompute', { params: { id: 'pr_last' } })
    // approvals since the draft change the next recalculation
    C('u_subhankar', 'POST', '/approvals/:weekId/approve', { params: { weekId: 'wk_pragyasmita_2026-09-28' } })
    C('u_santosh', 'POST', '/payroll/:id/recompute', { params: { id: 'pr_last' } })
    // finalise: maker-checker is on for payroll in Seereon -> request, then the checker approves
    C('u_hritesh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_last' } })
    C('u_santosh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_prev' } })
    C('u_santosh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_last' }, ifMatch: 99 })
    const fin = C('u_santosh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_last' } })
    C('u_santosh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_last' } })
    C('u_santosh', 'POST', '/payroll/:id/recompute', { params: { id: 'pr_last' } })
    C('u_santosh', 'POST', '/payroll/run', { body: { month: '2026-09' } })
    C('u_santosh', 'GET', '/payroll')
    C('u_santosh', 'GET', '/payroll/:id', { params: { id: 'pr_last' } })
    const cs = fin.v?.change?.id
    if (cs) {
      C('u_santosh', 'POST', '/changes/:id/approve', { params: { id: cs }, body: {} })
      C('u_debasish', 'POST', '/changes/:id/approve', { params: { id: cs }, body: {} })
    }
    C('u_santosh', 'GET', '/payroll/:id', { params: { id: 'pr_last' } })
    C('u_santosh', 'POST', '/payroll/:id/finalise', { params: { id: 'pr_last' } })
    if (oct.v?.run?.id) {
      const f2 = C('u_debasish', 'POST', '/payroll/:id/finalise', { params: { id: oct.v.run.id } })
      if (f2.v?.change?.id) C('u_santosh', 'POST', '/changes/:id/approve', { params: { id: f2.v.change.id }, body: {} })
    }
    C('u_santosh', 'GET', '/payroll')
    a.fn('u_santosh', 'payrollRunLines', { id: 'pr_last' })
  }, Object.keys(values).length ? [{ kind: 'settings', id: 'tn_seereon', values }] : []))
// maker-checker off (Kalinga): direct finalisation needs “Finalise payroll”; payslips + ledger row
S.push(K.scenario('payroll kalinga', 'tn_kalinga', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const r = C('u_k_ananya', 'POST', '/payroll/run', { body: { month: '2026-09' } })
  const id = r.v?.run?.id
  if (id) {
    C('u_k_ananya', 'POST', '/payroll/:id/finalise', { params: { id }, perms: ['payroll.run'] })
    C('u_k_ananya', 'POST', '/payroll/:id/finalise', { params: { id } })
    C('u_k_ananya', 'POST', '/payroll/:id/finalise', { params: { id } })
    C('u_k_ananya', 'GET', '/payroll/:id', { params: { id } })
  }
  C('u_k_ananya', 'POST', '/payroll/run', { body: { month: '2026-08' } })
  C('u_k_ananya', 'GET', '/payroll')
}))
// Salaries ledger row already present for the month (replaced / zeroed duplicates)
S.push(K.scenario('payroll ledger replace', 'tn_kalinga', TODAY, (a) => {
  const r = a.call('u_k_ananya', 'POST', '/payroll/run', { body: { month: '2026-09' } })
  if (r.v?.run?.id) a.call('u_k_ananya', 'POST', '/payroll/:id/finalise', { params: { id: r.v.run.id } })
}, [
  { kind: 'insert', table: 'ledger_entries', row: { id: 'le_sal1', tenant_id: 'tn_kalinga', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', created_by: null, version: 1, kind: 'expense', category: 'Salaries', description: 'Sept salaries (estimate)', amount_paise: 100, date: '2026-09-05', recurring: false, until_on: null, status: 'expected', project_id: null, milestone_id: null, invoice_id: null, stream: null, locked: false } },
  { kind: 'insert', table: 'ledger_entries', row: { id: 'le_sal2', tenant_id: 'tn_kalinga', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', created_by: null, version: 1, kind: 'expense', category: 'Salaries', description: 'Sept bonus', amount_paise: 200, date: '2026-09-25', recurring: false, until_on: null, status: 'expected', project_id: null, milestone_id: null, invoice_id: null, stream: null, locked: false } },
]))

const size = writeGz('timesheets.json.gz', { generated_on: seed.generated_on, scenarios: S })
console.log(`timesheets vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
void H
