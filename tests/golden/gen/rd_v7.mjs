// Golden vectors for app/routes/{documents,docs_v7,workflows_v7}.py (ports of src/mock/routes/documents.ts, docsV7.ts,
// workflowsV7.ts) on the full seed, with the route kit (fixed clock, deterministic ids, explicit role permissions):
//   TZ=Asia/Kolkata node backend/tests/golden/gen/rd_v7.mjs -> vectors/rd_v7.json.gz
// Reads of every route for several users / days (later days run the lazy SLA escalation), every exported helper
// (visibleDocuments, canSeeIssued, suggestVars, canView, snapOf, displayOf, wfLinkedAppraisals, wfInboxRows,
// checkRoutable, appraisalTemplate, assertNotWorkflowManaged, startWorkflow, syncAppraisal, generatePayslips,
// issueJoiningLetter) and every write route with valid + invalid bodies, incl. the full five-stage appraisal chain.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('rd_v7', `export * as D from '@/mock/routes/documents'\nexport * as V from '@/mock/routes/docsV7'\nexport * as W from '@/mock/routes/workflowsV7'\nexport * as mc from '@/mock/makerChecker'\nexport * as st from '@/mock/routes/settings'\n`)
const { server, D, V, W, mc } = M
const seed = readEngineSeed()
const T = seed.tables
const TODAY = seed.generated_on
const TABLES = [
  'documents', 'document_versions', 'document_acks', 'document_views', 'files', 'doc_templates', 'issued_documents', 'employee_documents', 'email_templates', 'email_outbox',
  'wf_templates', 'wf_instances', 'appraisals', 'cost_rates', 'change_sets', 'tasks', 'notifications', 'activity_log', 'number_sequences',
]
const row = (db, t, id) => db[t].find((x) => x.id === id)
const FNS = {
  visibleDocuments: (ctx) => D.visibleDocuments(ctx).map((d) => d.id),
  canSeeIssued: (ctx, a) => server.rows(ctx, 'issued_documents').map((d) => [d.id, V.canSeeIssued(ctx, d)]),
  suggestVars: (ctx, a) => V.suggestVars(ctx, a.user),
  generatePayslips: (ctx, a) => V.generatePayslips(ctx, a.run, a.opts),
  issueJoiningLetter: (ctx, a) => V.issueJoiningLetter(ctx, a.user, a.ctc),
  canView: (ctx) => server.rows(ctx, 'wf_instances').map((i) => [i.id, W.canView(ctx, i)]),
  snapOf: (ctx) => server.rows(ctx, 'wf_instances').map((i) => W.snapOf(ctx, i)),
  displayOf: (ctx, a) => a.values.map((v) => W.displayOf(a.field, v === '$undef' ? undefined : v)),
  wfLinkedAppraisals: (ctx) => [...W.wfLinkedAppraisals(ctx)],
  wfInboxRows: (ctx) => W.wfInboxRows(ctx),
  checkRoutable: (ctx, a) => W.checkRoutable(ctx, server.rows(ctx, 'wf_templates').find((t) => t.id === a.template), a.subjects),
  appraisalTemplate: (ctx, a) => W.appraisalTemplate(ctx, a.id),
  assertNotWorkflowManaged: (ctx, a) => W.assertNotWorkflowManaged(ctx, a.id),
  startWorkflow: (ctx, a) => W.startWorkflow(ctx, server.rows(ctx, 'wf_templates').find((t) => t.id === a.template), a.subject, a.context, a.title),
  syncAppraisal: (ctx, a) => W.syncAppraisal(ctx, server.rows(ctx, 'wf_instances').find((i) => i.id === a.id)),
}
const K = kit({ server, T, modules: [D, V, W, mc], tables: TABLES, fns: FNS })
const S = []
const mine = (t, tid) => T[t].filter((x) => x.tenant_id === tid)
const txt = { name: 'notes.txt', mime: 'text/plain', size_bytes: 5, data_url: 'data:text/plain;base64,aGVsbG8=' }
const png = { name: 'scan.PNG', mime: 'image/png', size_bytes: 68, data_url: 'data:image/png;base64,iVBORw0KGgo=' }

/* ---------------- reads (+ lazy SLA sweep / seed payslips) ---------------- */
const READERS = {
  tn_seereon: ['u_santosh', 'u_priya', 'u_debasish', 'u_subhankar', 'u_hritesh', 'u_bijaya', 'u_jagannath', 'u_baishali', 'u_subham', 'u_jayashree'],
  tn_kalinga: ['u_k_ananya', 'u_k_rakesh', 'u_k_sneha'],
}
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2026-10-21', '2026-11-30'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        const C = (m, p, o) => a.call(u, m, p, o)
        // documents
        C('GET', '/documents')
        C('GET', '/documents', { query: { scope: 'company' } })
        C('GET', '/documents', { query: { scope: 'project' } })
        C('GET', '/documents', { query: { archived: 'true' } })
        C('GET', '/documents', { query: { q: 'POLICY', category: 'policy' } })
        for (const p of mine('projects', tid).slice(0, 3)) C('GET', '/documents', { query: { project_id: p.id } })
        C('GET', '/documents', { query: { project_id: 'nope' } })
        C('GET', '/documents/projects')
        C('GET', '/documents/policy-status')
        for (const d of mine('documents', tid)) {
          C('GET', '/documents/:id', { params: { id: d.id } })
          C('GET', '/documents/:id/download', { params: { id: d.id }, query: { preview: '1' } })
        }
        a.fn(u, 'visibleDocuments')
        // docs
        C('GET', '/doc-templates')
        for (const t of mine('doc_templates', tid).slice(0, 4)) C('GET', '/doc-templates/:id', { params: { id: t.id } })
        for (const x of users.slice(0, 5)) {
          C('GET', '/doc-templates/sample/:employeeId', { params: { employeeId: x } })
          C('GET', '/doc-templates/suggest/:employeeId', { params: { employeeId: x } })
          a.fn(u, 'suggestVars', { user: x })
          C('GET', '/employee-docs/person/:userId', { params: { userId: x } })
        }
        C('GET', '/issued-docs')
        C('GET', '/issued-docs', { query: { mine: '1' } })
        C('GET', '/issued-docs', { query: { employee_id: u } })
        C('GET', '/issued-docs', { query: { q: 'letter', from: '2025-01-01', to: '2026-10-31', status: 'acknowledged' } })
        for (const d of mine('issued_documents', tid)) C('GET', '/issued-docs/:id', { params: { id: d.id } })
        a.fn(u, 'canSeeIssued')
        C('GET', '/employee-docs/people')
        C('GET', '/employee-docs/people', { query: { all: '1' } })
        C('GET', '/employee-docs/person/:userId', { params: { userId: 'me' } })
        for (const e of mine('employee_documents', tid).slice(0, 6)) C('GET', '/employee-docs/:id/file', { params: { id: e.id } })
        for (const r of mine('payroll_runs', tid)) C('GET', '/payroll/:id/payslips', { params: { id: r.id } })
        // workflows
        C('GET', '/wf/templates')
        C('GET', '/wf/meta')
        for (const t of mine('wf_templates', tid)) C('GET', '/wf/templates/:id', { params: { id: t.id } })
        for (const tab of ['waiting', 'started', 'about', 'all']) C('GET', '/wf/instances', { query: { tab } })
        C('GET', '/wf/instances', { query: { tab: 'all', status: 'in_progress' } })
        for (const i of mine('wf_instances', tid)) C('GET', '/wf/instances/:id', { params: { id: i.id } })
        for (const ap of mine('appraisals', tid)) C('GET', '/wf/appraisal/:appraisalId', { params: { appraisalId: ap.id } })
        a.fn(u, 'canView')
        a.fn(u, 'wfInboxRows')
      }
      const U = users[0]
      a.fn(U, 'snapOf')
      a.fn(U, 'wfLinkedAppraisals')
      for (const ap of mine('appraisals', tid)) a.fn(U, 'assertNotWorkflowManaged', { id: ap.id })
      for (const t of mine('wf_templates', tid)) {
        a.fn(U, 'appraisalTemplate', { id: t.id })
        for (const x of [...users, 'nobody']) a.fn(U, 'checkRoutable', { template: t.id, subjects: [x] })
      }
      a.fn(U, 'appraisalTemplate', { id: null })
      for (const t of mine('wf_templates', tid).slice(0, 2))
        for (const st of t.stages)
          for (const f of st.fields)
            a.fn(U, 'displayOf', { field: f, values: [null, '$undef', '', 0, 3.5, 4, 'x', true, false, 1500000, -250, '2026-11-01', '2026-02-30', { name: 'a.pdf' }, {}, [1, 2]] })
      for (const type of ['rating', 'percent', 'money', 'date', 'checkbox', 'file', 'text', 'select', 'number'])
        a.fn(U, 'displayOf', { field: { key: 'k', label: 'K', type, required: false, visible_to: [] }, values: [null, '', 0, 3.5, 'x', true, '2026-11-01', 1050075, { name: 'r.pdf' }, { size: 1 }] })
    }))

/* ---------------- documents writes ---------------- */
S.push(K.scenario('documents writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  for (const [u, body] of [
    ['u_hritesh', { title: 'My notes', category: 'other', url: 'https://example.com/x' }], ['u_santosh', { project_id: 'p_nope', title: 'X notes', category: 'other' }],
    ['u_santosh', { title: 'ab', category: 'other' }], ['u_santosh', { title: 'Valid title', category: 'nope' }], ['u_santosh', { title: 'Valid title', category: 'policy', visibility: 'world' }],
    ['u_santosh', { title: 'Valid title', category: 'policy' }], ['u_santosh', { title: 'Valid title', category: 'policy', url: 'https://example.com/a', file: txt }],
    ['u_santosh', { title: 'Valid title', category: 'policy', url: 'ftp://example' }], ['u_santosh', { title: 'Valid title', category: 'policy', file: { ...txt, name: 'run.exe' } }],
    ['u_santosh', { title: 'Valid title', category: 'policy', file: { ...txt, size_bytes: 0 } }], ['u_santosh', { title: 'Valid title', category: 'policy', file: { ...txt, size_bytes: 11 * 1024 * 1024 } }],
    ['u_santosh', { title: 'Valid title', category: 'policy', file: { ...txt, data_url: 'nope' } }], ['u_santosh', { title: 'Valid title', category: 'policy', url: 'https://example.com/a', effective_on: '1 May' }],
    ['u_santosh', { title: 'Valid title', category: 'policy', file: { ...txt, mime: 'application/zip' } }], ['u_santosh', { title: 'Valid title', category: 'policy', file: 'x' }],
    ['u_subhankar', { project_id: 'p_rcu', title: 'RCU notes', category: 'other', url: 'https://example.com/x' }],
  ]) C(u, 'POST', '/documents', { body })
  const urls = ['https://Policies.Example.com/travel/2026/../v2/Plan%20A?x=1#top', 'https://example.com', 'http://intranet.example.com/a b', 'https://user:pw@Host.example.com:8443/x/./y/../z/', 'https://münchen.example.de/straße', 'https://example.com/été?q', 'https://[::1].x/y', 'https://a.b/' + 'p'.repeat(150)]
  const ids = []
  for (const [i, url] of urls.entries()) {
    const r = C('u_santosh', 'POST', '/documents', { body: { title: `Link ${i} policy`, category: 'policy', must_read: i % 2 === 0, tags: [' Travel ', 'travel', 'HR', 7, null], url, effective_on: i === 0 ? '2026-11-01' : '', note: i ? 'Initial' : '', description: '  Rules.  ' } })
    if (r.v) ids.push(r.v.id)
  }
  const p1 = C('u_subhankar', 'POST', '/documents', { body: { project_id: 'p_hrms', title: 'Sprint notes', category: 'meeting_notes', file: txt, tags: ['sprint'] } })
  const p2 = C('u_santosh', 'POST', '/documents', { body: { project_id: 'p_crm', title: 'Pricing sheet', category: 'contract', visibility: 'managers', must_read: true, url: 'https://drive.example.com/pricing' } })
  for (const u of ['u_santosh', 'u_hritesh', 'u_subhankar', 'u_bijaya', 'u_priya']) {
    for (const id of [...ids.slice(0, 2), p1.v?.id, p2.v?.id]) C(u, 'GET', '/documents/:id', { params: { id } })
    C(u, 'GET', '/documents')
    C(u, 'GET', '/documents/policy-status')
  }
  const id = p1.v?.id
  C('u_subhankar', 'POST', '/documents/:id/versions', { params: { id }, body: { note: 'tiny', file: txt } })
  C('u_hritesh', 'POST', '/documents/:id/versions', { params: { id }, body: { note: 'Updated after review', file: txt } })
  C('u_subhankar', 'POST', '/documents/:id/versions', { params: { id }, body: { note: 'Updated after the sprint review', url: 'https://example.com/sprint-2' } })
  C('u_subhankar', 'PATCH', '/documents/:id', { params: { id }, body: { title: 'Sprint review notes', must_read: true, tags: ['sprint', 'review'], effective_on: '2026-01-01' } })
  C('u_subhankar', 'PATCH', '/documents/:id', { params: { id }, body: { title: 'x' } })
  C('u_subhankar', 'PATCH', '/documents/:id', { params: { id }, body: { category: 'design' }, ifMatch: 1 })
  C('u_santosh', 'PATCH', '/documents/:id', { params: { id: ids[0] }, body: { visibility: 'managers', effective_on: '', description: null, must_read: 0 } })
  C('u_santosh', 'PATCH', '/documents/:id', { params: { id: ids[1] }, body: { visibility: 'project', must_read: 1, effective_on: '2027-02-30x' } })
  C('u_bijaya', 'POST', '/documents/:id/archive', { params: { id: p2.v?.id } })
  C('u_hritesh', 'POST', '/documents/:id/archive', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/archive', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/archive', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/versions', { params: { id }, body: { note: 'After archive upload', url: 'https://example.com/z' } })
  C('u_hritesh', 'GET', '/documents/:id', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/ack', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/restore', { params: { id } })
  C('u_subhankar', 'POST', '/documents/:id/restore', { params: { id } })
  for (const d of mine('documents', 'tn_seereon')) {
    C('u_hritesh', 'POST', '/documents/:id/ack', { params: { id: d.id } })
    C('u_hritesh', 'POST', '/documents/:id/view', { params: { id: d.id } })
    C('u_bijaya', 'GET', '/documents/:id/download', { params: { id: d.id }, query: { version: '1' } })
  }
  C('u_hritesh', 'POST', '/documents/:id/ack', { params: { id: 'doc_co_handbook' } })
  C('u_hritesh', 'GET', '/documents/:id/download', { params: { id: 'doc_hrms_brd' }, query: { version: 'abc' } })
  C('u_hritesh', 'GET', '/documents/:id/download', { params: { id: 'doc_hrms_brd' }, query: { version: '9' } })
  C('u_subhankar', 'GET', '/documents/:id/download', { params: { id }, query: { version: '2' } })
  for (const u of ['u_santosh', 'u_hritesh', 'u_subhankar']) {
    C(u, 'GET', '/documents')
    C(u, 'GET', '/documents/projects')
    a.fn(u, 'visibleDocuments')
  }
}))

/* ---------------- docs writes ---------------- */
S.push(K.scenario('docs writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = 'u_priya'
  const body = '# Bonus letter\n\nDear {{employee_name}},\n\nWe are pleased to award you a bonus of {{bonus_amount}} for {{appraisal_period}}.\n\n{{company}}'
  for (const [u, b] of [
    ['u_hritesh', { name: 'Bonus letter', category: 'other', body }], [P, { name: 'Bo', category: 'other', body }], [P, { name: 'offer LETTER', category: 'other', body }],
    [P, { name: 'Bonus letter', category: 'bogus', body }], [P, { name: 'Bonus letter', category: 'other', body: 'Too short' }], [P, { name: 'Bonus letter', category: 'other', body: body + ' {{mystery}} {{other_thing}}' }],
    [P, { name: 'Bonus letter', category: 'other', body: body + ' {{mystery}}' }], [P, { name: 'Bonus letter', category: 'other', body, custom_placeholders: ['Bonus Amount!'] }],
    [P, { name: 'Payslip v2', category: 'payslip', body: 'Payslip for {{employee_name}} for the month, no net pay shown here.' }], [P, { name: 'X'.repeat(81), category: 'other', body }],
    [P, { name: 'Big', category: 'other', body: 'x'.repeat(20001) }],
  ]) C(u, 'POST', '/doc-templates', { body: b })
  const t1 = C(P, 'POST', '/doc-templates', { body: { name: 'Bonus letter', category: 'other', body: body + '\r\n\r\nRegards', custom_placeholders: ['bonus_amount', ' BONUS_AMOUNT '], description: ' One-off bonus ', letterhead: 0 } })
  const t1id = t1.v?.id
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: t1id }, body: { active: false, description: 'Switched off for now' } })
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: t1id }, body: { name: 'Bonus letter 2026' }, ifMatch: 1 })
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: t1id }, body: { name: 'Bonus letter 2026', active: true, custom_placeholders: null } })
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: 'r_02py' }, body: { category: 'other' } })
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: 'r_02py' }, body: { description: 'Monthly payslip' } })
  C(P, 'PATCH', '/doc-templates/:id', { params: { id: 'r_02pw' }, body: { body: 'Short' } })
  for (let i = 0; i < 3; i++) C(P, 'POST', '/doc-templates/:id/duplicate', { params: { id: 'r_02ps' } })
  C(P, 'DELETE', '/doc-templates/:id', { params: { id: 'r_02ps' } })
  C(P, 'DELETE', '/doc-templates/:id', { params: { id: 'r_02py' } })
  const t2 = C(P, 'POST', '/doc-templates/:id/duplicate', { params: { id: 'r_02px' } })
  C('u_hritesh', 'DELETE', '/doc-templates/:id', { params: { id: t2.v?.id } })
  C(P, 'DELETE', '/doc-templates/:id', { params: { id: t2.v?.id } })
  C(P, 'GET', '/doc-templates')
  // preview / issue for every active template
  for (const t of a.db.doc_templates.filter((x) => x.tenant_id === 'tn_seereon').slice(0, 12)) {
    C(P, 'POST', '/doc-templates/:id/preview', { params: { id: t.id }, body: { employee_ids: ['u_hritesh', 'u_bijaya', 'u_hritesh'], vars: { reason: 'Late twice', '9x': 'nine', 'bad key': 'x', employee_name: 'Override' }, per_employee: { u_bijaya: { reason: 'Missed standups' } }, title: ' ' } })
    C('u_santosh', 'POST', '/doc-templates/:id/preview', { params: { id: t.id }, body: { employee_ids: ['u_jayashree'] } })
  }
  C('u_hritesh', 'POST', '/doc-templates/:id/preview', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_hritesh'] } })
  C(P, 'POST', '/doc-templates/:id/preview', { params: { id: 'r_02pw' }, body: { employee_ids: [] } })
  C(P, 'POST', '/doc-templates/:id/preview', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_nope'] } })
  C(P, 'POST', '/doc-templates/:id/preview', { params: { id: 'r_02pw' }, body: { employee_ids: Array.from({ length: 101 }, (_, i) => `u${i}`) } })
  const pw = a.db.doc_templates.find((t) => t.id === 'r_02pw')
  C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_hritesh'] } })
  C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_hritesh', 'u_bijaya'], vars: {} } })
  const fill = (t) => Object.fromEntries((t.body.match(/\{\{\s*(\w+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')).map((k) => [k, `Value for ${k}`]))
  C(P, 'POST', '/doc-templates/:id/issue', { params: { id: t1id }, body: { employee_ids: ['u_hritesh'], vars: { bonus_amount: '₹50,000' } } })
  const iss = C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_hritesh', 'u_bijaya'], vars: fill(pw), title: 'Warning letter' } })
  const dr = C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_jagannath'], status: 'draft', vars: { reason: 'Partial' } } })
  C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02py' }, body: { employee_ids: ['u_hritesh'], vars: { net_pay: '₹1' } } })
  C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02py' }, body: { employee_ids: ['u_hritesh'], vars: fill(a.db.doc_templates.find((t) => t.id === 'r_02py')), allow_manual_payslip: true } })
  for (const t of a.db.doc_templates.filter((x) => x.tenant_id === 'tn_seereon' && x.active).slice(0, 10))
    C('u_santosh', 'POST', '/doc-templates/:id/issue', { params: { id: t.id }, body: { employee_ids: ['u_subham', 'u_baishali'], vars: fill(t), per_employee: { u_subham: { title_note: 'x' } } } })
  const d1 = iss.v?.created?.[0]?.id
  const d2 = iss.v?.created?.[1]?.id
  C(P, 'GET', '/issued-docs/:id', { params: { id: d1 } })
  C('u_hritesh', 'GET', '/issued-docs/:id', { params: { id: d1 } })
  C('u_hritesh', 'POST', '/issued-docs/:id/ack', { params: { id: d1 } })
  C('u_hritesh', 'POST', '/issued-docs/:id/ack', { params: { id: d1 } })
  C(P, 'POST', '/issued-docs/:id/ack', { params: { id: d2 } })
  const dd = dr.v?.created?.[0]?.id
  C('u_jagannath', 'GET', '/issued-docs/:id', { params: { id: dd } })
  C(P, 'POST', '/issued-docs/:id/issue', { params: { id: dd } })
  C(P, 'PATCH', '/issued-docs/:id', { params: { id: dd }, body: { title: 'W' } })
  C(P, 'PATCH', '/issued-docs/:id', { params: { id: dd }, body: { vars: fill(pw), title: 'Warning letter — attendance' }, ifMatch: 1 })
  C(P, 'PATCH', '/issued-docs/:id', { params: { id: dd }, body: { vars: fill(pw), title: 'Warning letter — attendance' } })
  C(P, 'POST', '/issued-docs/:id/issue', { params: { id: dd } })
  C(P, 'POST', '/issued-docs/:id/issue', { params: { id: dd } })
  C(P, 'DELETE', '/issued-docs/:id', { params: { id: dd } })
  const dr2 = C(P, 'POST', '/doc-templates/:id/issue', { params: { id: 'r_02pw' }, body: { employee_ids: ['u_bijaya'], status: 'draft' } })
  const d3 = dr2.v?.created?.[0]?.id
  C(P, 'POST', '/issued-docs/:id/revoke', { params: { id: d3 }, body: { reason: 'Not needed' } })
  C(P, 'POST', '/issued-docs/:id/reissue', { params: { id: d3 } })
  C('u_bijaya', 'POST', '/issued-docs/:id/ack', { params: { id: d3 } })
  C('u_hritesh', 'DELETE', '/issued-docs/:id', { params: { id: d3 } })
  C(P, 'DELETE', '/issued-docs/:id', { params: { id: d3 } })
  for (const d of mine('issued_documents', 'tn_seereon').slice(0, 24)) {
    C(P, 'PATCH', '/issued-docs/:id', { params: { id: d.id }, body: { title: 'Edited' } })
    C(P, 'POST', '/issued-docs/:id/revoke', { params: { id: d.id }, body: { reason: 'no' } })
    C(d.employee_id, 'POST', '/issued-docs/:id/ack', { params: { id: d.id } })
  }
  for (const id of ['r_02rk', 'r_02r8', 'r_02rh']) {
    C(P, 'POST', '/issued-docs/:id/revoke', { params: { id }, body: { reason: 'Issued with the wrong date' } })
    C(P, 'POST', '/issued-docs/:id/revoke', { params: { id }, body: { reason: 'Issued with the wrong date' } })
    const ri = C(P, 'POST', '/issued-docs/:id/reissue', { params: { id } })
    C(P, 'POST', '/issued-docs/:id/reissue', { params: { id } })
    if (ri.v) C(ri.v.doc.employee_id, 'POST', '/issued-docs/:id/ack', { params: { id: ri.v.doc.id } })
  }
  C(P, 'GET', '/issued-docs')
  // employee documents
  for (const b of [{ kind: 'nope', title: 'My PAN', file: png }, { kind: 'pan', title: 'PA', file: png }, { kind: 'pan', title: 'My PAN card' }, { kind: 'pan', title: 'My PAN card', file: { ...png, name: 'scan.gif' } },
    { kind: 'pan', title: 'My PAN card', file: { ...png, size_bytes: 0 } }, { kind: 'pan', title: 'My PAN card', file: { ...png, size_bytes: 6e6 } }, { kind: 'pan', title: 'My PAN card', file: { ...png, data_url: 42 } },
    { kind: 'passport', title: 'My passport', file: png }, { kind: 'passport', title: 'My passport', file: png, expires_on: '2030/01/01' }, { employee_id: 'u_bijaya', kind: 'pan', title: 'Bijaya PAN', file: png }])
    C('u_hritesh', 'POST', '/employee-docs', { body: b })
  const e1 = C('u_hritesh', 'POST', '/employee-docs', { body: { kind: 'passport', title: 'Old passport', file: png, expires_on: '2020-01-01', doc_number: 'P1234567', note: '  scanned  ' } })
  const e2 = C('u_hritesh', 'POST', '/employee-docs', { body: { kind: 'address_proof', title: 'Electricity bill', file: png } })
  const e3 = C(P, 'POST', '/employee-docs', { body: { employee_id: 'u_bijaya', kind: 'experience', title: 'Experience letter — previous employer', file: png, expires_on: '2026-11-20' } })
  const e4 = C(P, 'POST', '/employee-docs', { body: { kind: 'photo', title: 'My photo', file: png } })
  C(P, 'POST', '/employee-docs', { body: { employee_id: 'u_nope', kind: 'photo', title: 'Ghost photo', file: png } })
  const E = (r) => ({ id: r.v?.id })
  C('u_hritesh', 'POST', '/employee-docs/:id/verify', { params: E(e1) })
  C(P, 'POST', '/employee-docs/:id/verify', { params: E(e4) })
  C(P, 'POST', '/employee-docs/:id/reject', { params: E(e1), body: { note: 'blurry' } })
  C(P, 'POST', '/employee-docs/:id/reject', { params: E(e1), body: { note: 'The scan is blurry — upload a clearer copy.' } })
  C(P, 'POST', '/employee-docs/:id/verify', { params: E(e1) })
  C('u_santosh', 'POST', '/employee-docs/:id/verify', { params: E(e2), body: { note: 'Checked against the original' } })
  C('u_santosh', 'POST', '/employee-docs/:id/verify', { params: E(e4) })
  C('u_hritesh', 'GET', '/employee-docs/:id/file', { params: E(e2) })
  C('u_bijaya', 'GET', '/employee-docs/:id/file', { params: E(e2) })
  C('u_hritesh', 'DELETE', '/employee-docs/:id', { params: E(e2) })
  C('u_bijaya', 'DELETE', '/employee-docs/:id', { params: E(e1) })
  C('u_hritesh', 'DELETE', '/employee-docs/:id', { params: E(e1) })
  C('u_bijaya', 'DELETE', '/employee-docs/:id', { params: E(e3) })
  C(P, 'DELETE', '/employee-docs/:id', { params: E(e3) })
  for (const u of [P, 'u_hritesh']) {
    C(u, 'GET', '/employee-docs/people')
    C(u, 'GET', '/employee-docs/person/:userId', { params: { userId: 'u_hritesh' } })
  }
  // joining letters
  for (const [u, ctc] of [['u_hritesh', 7000000], ['u_baishali', null], ['u_k_ananya', 1], ['u_nope', 5]]) a.fn('u_priya', 'issueJoiningLetter', { user: u, ctc })
}))

/* ---------------- payslips ---------------- */
for (const runId of ['pr_prev', 'pr_last'])
  S.push(K.scenario(`payslips ${runId}`, 'tn_seereon', TODAY, (a) => {
    a.call('u_priya', 'GET', '/payroll/:id/payslips', { params: { id: runId } })
    a.call('u_hritesh', 'POST', '/payroll/:id/payslips', { params: { id: runId } })
    a.call('u_priya', 'POST', '/payroll/:id/payslips', { params: { id: runId } })
    a.call('u_priya', 'POST', '/payroll/:id/payslips', { params: { id: runId } })
    a.fn('u_santosh', 'generatePayslips', { run: runId, opts: { notify: false, issued_on: '2026-10-05' } })
    a.fn('u_santosh', 'generatePayslips', { run: 'pr_nope' })
    a.call('u_priya', 'GET', '/issued-docs', { query: { run_id: runId } })
    for (const d of a.db.issued_documents.filter((x) => x.source?.ref_id === runId).slice(0, 15)) {
      a.call('u_priya', 'GET', '/issued-docs/:id', { params: { id: d.id } })
      a.call('u_priya', 'POST', '/issued-docs/:id/revoke', { params: { id: d.id }, body: { reason: 'Recalculated pay' } })
    }
    a.call('u_priya', 'POST', '/payroll/:id/payslips', { params: { id: runId } })
    a.call('u_priya', 'GET', '/payroll/:id/payslips', { params: { id: runId } })
  }, runId === 'pr_last' ? [{ kind: 'set', table: 'payroll_runs', id: 'pr_last', values: { status: 'final', finalised_at: '2026-10-03T09:00:00.000Z', finalised_by: 'u_priya' } }] : []))

/* ---------------- workflows: templates ---------------- */
S.push(K.scenario('wf templates', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const U = 'u_santosh'
  for (const t of mine('wf_templates', 'tn_seereon')) {
    C(U, 'POST', '/wf/templates/check', { body: { template: t, id: t.id } })
    C(U, 'POST', '/wf/templates/check', { body: { template: t } })
  }
  C('u_hritesh', 'POST', '/wf/templates/check', { body: { template: {} } })
  C(U, 'POST', '/wf/templates/check', { body: { template: 'nonsense' } })
  C(U, 'POST', '/wf/templates/check', { body: {} })
  C(U, 'POST', '/wf/templates/check', {
    body: {
      template: {
        name: 'x', process: 'bogus', stages: [
          { key: '1bad', name: '', assignee: 'role', role_key: 'cto', sla_days: 0, fields: [{ key: 'a', label: '', type: 'select', options: ['A', 'a'], min: 'x', max: 1, visible_to: ['nowhere'], max_from: 'zz.yy', override_field: 'nope' }] },
          { key: 'dup', name: 'Dup', assignee: 'user', user_id: 'u_ankit', sla_days: 31, fields: [{ key: 'r', label: 'Rate', type: 'rating', min: 0, max: 9 }, { key: 'r', label: 'Rate again', type: 'text', max_from: 'dup.r' }, { key: 'm', label: 'Money', type: 'money', min: 5, max: 2 }] },
          { key: 'dup', name: 'Dup 2', assignee: 'subject', sla_days: 2.5, fields: [{ key: 'c', label: 'Cap', type: 'percent', max_from: 'dup.r', override_field: 'c' }, { key: 'w', label: 'Why', type: 'text' }, { key: 'd', label: 'D', type: 'percent', override_field: 'w', max_from: 'role_x.q' }] },
          { key: 'subj2', name: 'S', assignee: 'subject', sla_days: 1, fields: [{ key: 's', label: 'Sel', type: 'select', options: ['only'] }, { key: 'b', label: 'Bad', type: 'alien' }] },
          { key: 'role_x', name: 'Role X', assignee: 'role', role_key: 'nope', sla_days: 2, fields: [] }, { key: 'who', name: 'Who', assignee: 'alien', sla_days: 2, fields: [] },
          { key: 'hrx', name: 'HR exec', assignee: 'role', role_key: 'hr_executive', sla_days: 2 }, null === 1 ? {} : { key: 'zz', name: 'Me', assignee: 'user', user_id: 'u_santosh', sla_days: 2 },
          ...Array.from({ length: 6 }, (_, i) => ({ key: `extra_${i}`, name: `Extra ${i}`, assignee: 'reports_to', sla_days: 2 })),
        ],
        on_complete: [{ type: 'teleport' }, { type: 'generate_document', template_key: 'nope' }, { type: 'generate_document', template_key: 'promotion_letter' }, { type: 'send_email', template_key: 'nope', config: { to: 'aliens' } }, { type: 'update_ctc', config: { hike_field: 'dup.r' } }, { type: 'create_task', config: { title: 'x', when: { field: 'no.field', equals: 'y' } } }, { type: 'notify', config: { to: 'role:hr_manager' } }, { type: 'notify', config: { to: 5 } }],
        on_reject: [{ type: 'update_ctc', config: [] }, { type: 'send_email', template_key: 'appraisal_letter', config: 'str' }],
      },
    },
  })
  for (const b of [{ name: 'My flow' }, { name: 'ab' }, { name: 'Annual Appraisal' }, { name: 'My flow', process: 'bogus' }, { name: 'Copy flow', copy_of: 'r_nope' }])
    C(b.name === 'My flow' && !b.process ? 'u_hritesh' : U, 'POST', '/wf/templates', { body: b })
  const ct = C(U, 'POST', '/wf/templates', { body: { name: 'Laptop request', description: 'Ask for a laptop' } })
  const cc = C(U, 'POST', '/wf/templates', { body: { name: 'Promotion (fast track)', copy_of: 'r_02vm', process: '' } })
  C(U, 'POST', '/wf/templates', { body: { name: 'Exit (copy)', copy_of: 'r_02vl', description: '', process: 'general' } })
  const id = ct.v?.id
  const base = C(U, 'GET', '/wf/templates/:id', { params: { id } }).v
  const put1 = {
    ...base, active: true, self_service: true, process: 'general',
    stages: [
      { key: 'request', name: 'Request', assignee: 'initiator', sla_days: 2, fields: [{ key: 'model', label: 'Model', type: 'select', required: true, options: ['Mac', 'ThinkPad', ''], visible_to: ['all', 'all'] }, { key: 'budget', label: 'Budget', type: 'money', required: true, min: 1000000, max: '', visible_to: ['approve'] }, { key: 'why', label: 'Why', type: 'textarea', required: true, min: 20, help: '  Explain  ', visible_to: ['approve', 'subject'] }] },
      { key: 'approve', name: 'Manager approval', assignee: 'reports_to', sla_days: '3', can_send_back: true, fields: [{ key: 'ok', label: 'Approved budget', type: 'money', required: true, visible_to: ['all'], max_from: 'request.budget' }, { key: 'conf', label: 'Confirmed', type: 'checkbox', required: true, visible_to: ['all'] }] },
      { key: 'it', name: 'IT', assignee: 'role', role_key: 'administrator', sla_days: 2, can_send_back: 1, fields: [{ key: 'asset_tag', label: 'Asset tag', type: 'text', required: true, min: 3, visible_to: ['all'] }, { key: 'receipt', label: 'Receipt', type: 'file', required: true, visible_to: ['all'] }, { key: 'handover', label: 'Handover date', type: 'date', required: true, visible_to: ['subject'] }, { key: 'n', label: 'Count', type: 'number', min: -5, max: 5, visible_to: [] }] },
    ],
    on_complete: [{ type: 'notify', config: { to: 'subject', message: 'Your laptop is ready.' } }, { type: 'create_task', config: { to: 'reports_to', title: 'Check laptop setup', due_days: 2 } }, { type: 'notify', config: { to: 'participants' } }],
    on_reject: [{ type: 'notify', config: { to: 'initiator' } }],
  }
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: { ...put1, stages: [] } })
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: put1, ifMatch: 99 })
  C('u_hritesh', 'PUT', '/wf/templates/:id', { params: { id }, body: put1 })
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: put1 })
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: put1 })
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: { ...put1, description: 'Ask IT for a laptop' } })
  C(U, 'PUT', '/wf/templates/:id', { params: { id }, body: { ...put1, name: 'Annual appraisal' } })
  C(U, 'GET', '/wf/templates/:id', { params: { id } })
  C(U, 'POST', '/wf/templates/:id/duplicate', { params: { id: cc.v?.id } })
  for (let i = 0; i < 3; i++) C(U, 'POST', '/wf/templates/:id/duplicate', { params: { id: 'r_02vi' } })
  C('u_priya', 'POST', '/wf/templates/:id/duplicate', { params: { id: 'r_nope' } })
  C('u_hritesh', 'POST', '/wf/templates/:id/duplicate', { params: { id: 'r_02vi' } })
  // a structural change while instances run → warning + revision
  const vi = C(U, 'GET', '/wf/templates/:id', { params: { id: 'r_02vi' } }).v
  const ch = { ...vi, stages: vi.stages.map((s, i) => (i === 0 ? { ...s, instructions: 'Rate yourself honestly.' } : s)) }
  C(U, 'PUT', '/wf/templates/:id', { params: { id: 'r_02vi' }, body: ch })
  C(U, 'PUT', '/wf/templates/:id', { params: { id: 'r_02vi' }, body: ch })
  C(U, 'PUT', '/wf/templates/:id', { params: { id: 'r_02vn' }, body: { ...C(U, 'GET', '/wf/templates/:id', { params: { id: 'r_02vn' } }).v, active: false } })
  C('u_hritesh', 'GET', '/wf/templates')
  C(U, 'GET', '/wf/templates')
}))

/* ---------------- workflows: instances ---------------- */
const fillWf = (fields, over = {}) => {
  const v = {}
  for (const f of fields ?? []) {
    if (f.type === 'rating') v[f.key] = 4
    else if (f.type === 'number' || f.type === 'percent') v[f.key] = Math.min(f.max ?? 100, Math.max(f.min ?? 0, 8))
    else if (f.type === 'money') v[f.key] = Math.max(100000, f.min ?? 0)
    else if (f.type === 'select') v[f.key] = f.options?.[0]
    else if (f.type === 'date') v[f.key] = '2026-11-02'
    else if (f.type === 'checkbox') v[f.key] = true
    else if (f.type === 'file') v[f.key] = { name: 'proof.pdf', size: 1234 }
    else v[f.key] = 'Reviewed carefully: everything here looks complete, correct and well documented.'
  }
  return { ...v, ...over }
}
const VIEWERS = ['u_jayashree', 'u_subhankar', 'u_santosh', 'u_priya', 'u_debasish', 'u_hritesh']
for (const mcOn of [true, false])
  S.push(K.scenario(`wf appraisal chain mc=${mcOn}`, 'tn_seereon', TODAY, (a) => {
    const C = (u, m, p, o) => a.call(u, m, p, o)
    const P = 'u_priya'
    for (const b of [{ template_id: 'r_02vi', subject_ids: ['u_jayashree'] }, { template_id: 'r_02vi', subject_id: 'u_hritesh' }])
      C('u_hritesh', 'POST', '/wf/instances', { body: b })
    for (const b of [
      { template_id: 'r_02vi', subject_ids: [] }, { template_id: 'r_nope', subject_ids: ['u_jayashree'] }, { template_id: 'r_02vj', subject_ids: ['u_jayashree'], cycle_id: 'ac_h1_fy2627' },
      { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_h2_fy2526' }, { template_id: 'r_02vi', subject_ids: ['u_jayashree', 'u_hritesh'], cycle_id: 'ac_h1_fy2627' },
      { template_id: 'r_02vi', subject_ids: ['u_jagannath'], cycle_id: 'ac_h1_fy2627' }, { template_id: 'r_02vi', subject_ids: ['r_000x'] }, { template_id: 'r_02vi', subject_ids: ['u_ankit'] },
      { template_id: 'r_02vi', subject_ids: Array.from({ length: 101 }, (_, i) => `u${i}`) }, { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_nope' },
    ]) C(P, 'POST', '/wf/instances', { body: b })
    const ap = C(P, 'POST', '/wf/instances', { body: { template_id: 'r_02vi', subject_ids: ['u_jayashree', 'u_jayashree', ' '], cycle_id: 'ac_h1_fy2627', note: 'H1 review — please complete by Friday', title: 'One title' } })
    const id = ap.v?.created?.[0]?.id
    const view = () => {
      for (const u of VIEWERS) C(u, 'GET', '/wf/instances/:id', { params: { id } })
      C(P, 'GET', '/wf/appraisal/:appraisalId', { params: { appraisalId: 'apr_h1_jayashree' } })
      C('u_jayashree', 'GET', '/wf/instances', { query: { tab: 'about' } })
      a.fn(P, 'syncAppraisal', { id })
    }
    view()
    const form = (u) => C(u, 'GET', '/wf/instances/:id', { params: { id } }).v?.form?.fields
    const act = (u, body, ifMatch) => C(u, 'POST', '/wf/instances/:id/act', { params: { id }, body, ifMatch })
    const f1 = form('u_jayashree')
    act('u_jayashree', { action: 'submit', values: {} })
    act('u_jayashree', { action: 'submit', values: fillWf(f1, { goals_rating: 4.3 }) })
    act('u_jayashree', { action: 'submit', values: fillWf(f1, { goals_rating: '0.5' }) })
    act('u_jayashree', { action: 'submit', values: fillWf(f1, { achievements: 'Did my work.' }) })
    act('u_jayashree', { action: 'submit', values: fillWf(f1, { achievements: 'y'.repeat(5001) }) })
    act('u_jayashree', { action: 'reject', reason: 'I do not want this review' })
    act('u_jayashree', { action: 'send_back', reason: 'I do not want this review' })
    act('u_jayashree', { action: 'dance' })
    act('u_jayashree', { action: 'submit', values: fillWf(f1) }, 99)
    act('u_subhankar', { action: 'submit', values: fillWf(f1) })
    act('u_jayashree', { action: 'submit', note: 'Self review done', values: fillWf(f1, { goals_rating: '4', competency_rating: 3.5, overall_self_rating: 4, achievements: 'Delivered the payroll module for HRMS and automated two monthly reports.', challenges: '', development_needs: 'SAP CPI training' }) })
    view()
    const f2 = form('u_subhankar')
    C('u_subhankar', 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: { recommended_hike_pct: 15 } } })
    C('u_jayashree', 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: {} } })
    for (const over of [{ recommended_hike_pct: 55 }, { recommended_hike_pct: 'abc' }, { promotion: 'Maybe' }, { delivery: 0 }, { feedback: 'short' }])
      act('u_subhankar', { action: 'submit', values: fillWf(f2, over) })
    act('u_subhankar', { action: 'send_back', reason: 'short' })
    act('u_subhankar', { action: 'submit', note: 'Strong half', values: fillWf(f2, { delivery: 4, quality: 4.5, ownership: 4, collaboration: 3.5, overall_rating: 4, feedback: 'Consistently delivered on payroll features with good quality.', recommended_hike_pct: 12.345, promotion: 'Ready in 6 months', private_comments: 'Keep an eye on workload.' }) })
    view()
    for (const [u, b] of [['u_hritesh', { user_id: 'u_debasish', note: 'Santosh is travelling' }], [P, { user_id: 'u_ankit', note: 'Santosh is travelling' }], [P, { user_id: 'u_santosh', note: 'Santosh is travelling' }], [P, { user_id: 'u_jayashree', note: 'Santosh is travelling' }], [P, { user_id: 'u_debasish', note: 'away' }], [P, { user_id: 'u_debasish', note: 'Santosh is travelling this week' }]])
      C(u, 'POST', '/wf/instances/:id/reassign', { params: { id }, body: b })
    act('u_santosh', { action: 'submit', values: {} })
    const f3 = form('u_debasish')
    act('u_debasish', { action: 'send_back', reason: 'Please recheck the ratings once more.' })
    view()
    act('u_subhankar', { action: 'submit', values: fillWf(form('u_subhankar'), { recommended_hike_pct: 11 }) })
    view()
    act('u_santosh', { action: 'submit', values: fillWf(f3, { calibrated_rating: 4, hike_decision: 'Modify', endorsed_hike_pct: 10, unit_comments: 'Calibrated against the unit.' }) })
    view()
    const f4 = form(P)
    C(P, 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: { normalised_hike_pct: 9, effective_date: '2026-11-01', band_check: 'ignored' } } })
    C(P, 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: { normalised_hike_pct: 'x' } } })
    C(P, 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: 'str' } })
    act(P, { action: 'submit', values: fillWf(f4, { effective_date: '2026-13-01' }) })
    act(P, { action: 'submit', values: fillWf(f4, { band_check: 'Within band', final_rating: 4, normalised_hike_pct: 9, new_designation: 'Senior Consultant', effective_date: '2026-11-01', hr_comments: 'Normalised to the pool.' }) })
    view()
    for (const b of ['x', 'y'.repeat(2001), 'Looks good — approving at the normalised hike unless anyone objects today.']) C('u_santosh', 'POST', '/wf/instances/:id/comments', { params: { id }, body: { body: b } })
    const f5 = form('u_santosh')
    C('u_santosh', 'POST', '/wf/instances/:id/preview', { params: { id }, body: { values: { approved_hike_pct: 11 } } })
    act('u_santosh', { action: 'submit', values: fillWf(f5, { approved_hike_pct: 11, override_reason: 'Because' }) })
    act('u_santosh', { action: 'submit', values: fillWf(f5, { approved_hike_pct: 9, override_reason: '', finance_comments: 'Approved.' }), note: 'Approved' })
    view()
    const done = C('u_santosh', 'GET', '/wf/instances/:id', { params: { id } }).v
    const ref = (k) => done?.outputs?.find((o) => o.kind === k)?.ref_id ?? 'x'
    C('u_jayashree', 'GET', '/issued-docs/:id', { params: { id: ref('document') } })
    C('u_jayashree', 'POST', '/issued-docs/:id/ack', { params: { id: ref('document') } })
    C('u_debasish', 'POST', '/changes/:id/reject', { params: { id: ref('cost_rate_change') }, body: { reason: 'Hike is above the budget for this quarter.' } })
    view()
    act('u_santosh', { action: 'submit', values: {} })
    C('u_santosh', 'POST', '/wf/instances/:id/cancel', { params: { id }, body: { reason: 'Too late to cancel this one' } })
    C(P, 'POST', '/wf/instances', { body: { template_id: 'r_02vi', subject_ids: ['u_jayashree'], cycle_id: 'ac_h1_fy2627' } })
    a.fn(P, 'wfLinkedAppraisals')
    a.fn(P, 'assertNotWorkflowManaged', { id: 'apr_h1_jayashree' })
    for (const u of VIEWERS) a.fn(u, 'wfInboxRows')
  }, mcOn ? [] : [{ kind: 'set', table: 'tenants', id: 'tn_seereon', values: { maker_checker: { ...T.tenants.find((t) => t.id === 'tn_seereon').maker_checker, entities: ['role'] } } }]))

S.push(K.scenario('wf instance actions', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const P = 'u_priya'
  const act = (u, id, body) => C(u, 'POST', '/wf/instances/:id/act', { params: { id }, body })
  // reject at HR, send back, reject with on_reject actions
  act(P, 'wfi_02wf', { action: 'reject', reason: 'short' })
  act(P, 'wfi_02wf', { action: 'reject', reason: 'Band exception not justified for this cycle.' })
  act(P, 'wfi_02wf', { action: 'reject', reason: 'Band exception not justified for this cycle.' })
  for (const u of ['u_priya', 'u_bijaya', 'u_santosh']) C(u, 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wf' } })
  act(P, 'wfi_02wd', { action: 'submit', values: {} })
  act('u_subhankar', 'wfi_02wd', { action: 'send_back', reason: 'Please add your HRMS achievements as well.' })
  const h1 = C('u_hritesh', 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wd' } }).v
  act('u_hritesh', 'wfi_02wd', { action: 'submit', values: fillWf(h1?.form?.fields, { achievements: 'Delivered payroll APIs and the HRMS integration with the bank.' }) })
  const h2 = C('u_subhankar', 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wd' } }).v
  act('u_subhankar', 'wfi_02wd', { action: 'submit', values: fillWf(h2?.form?.fields, { recommended_hike_pct: 10 }) })
  for (const u of ['u_hritesh', 'u_subhankar', 'u_santosh', 'u_priya']) C(u, 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wd' } })
  act('u_santosh', 'wfi_02wd', { action: 'send_back', reason: 'Please recheck the hike recommendation.' })
  // onboarding an invited joiner: IT → manager → letter needs an account
  const o1 = C('u_debasish', 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wp' } }).v
  act('u_debasish', 'wfi_02wp', { action: 'submit', values: fillWf(o1?.form?.fields) })
  const o2 = C('u_subhankar', 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wp' } }).v
  act('u_subhankar', 'wfi_02wp', { action: 'submit', values: fillWf(o2?.form?.fields) })
  C('u_subhankar', 'GET', '/wf/instances/:id', { params: { id: 'wfi_02wp' } })
  C(P, 'POST', '/wf/instances', { body: { template_id: 'r_02vk', subject_ids: ['r_000x'] } })
  // start every template for several subjects (direct + route), then cancel paths
  for (const t of mine('wf_templates', 'tn_seereon'))
    for (const s of ['u_subham', 'u_pragyasmita', 'u_baishali', 'u_debasish', 'u_santosh', 'u_ankit', 'r_000x', 'u_nope'])
      a.fn('u_priya', 'startWorkflow', { template: t.id, subject: s, context: { note: ' started by golden ' }, title: s === 'u_subham' ? '' : undefined })
  const sb = C(P, 'POST', '/wf/instances', { body: { template_id: 'r_02vj', subject_ids: ['u_bijaya', 'u_jagannath'], note: 'Confirmation due' } })
  const sid = sb.v?.created?.[0]?.id
  C('u_bijaya', 'POST', '/wf/instances/:id/cancel', { params: { id: sid }, body: { reason: 'I am not the initiator here' } })
  C(P, 'POST', '/wf/instances/:id/cancel', { params: { id: sid }, body: { reason: 'too short' } })
  C(P, 'POST', '/wf/instances/:id/cancel', { params: { id: sid }, body: { reason: 'Started for the wrong person, sorry.' } })
  C(P, 'POST', '/wf/instances/:id/cancel', { params: { id: sid }, body: { reason: 'Started for the wrong person, sorry.' } })
  C(P, 'POST', '/wf/instances/:id/reassign', { params: { id: sid }, body: { user_id: 'u_debasish', note: 'Whatever this is' } })
  C(P, 'POST', '/wf/instances/:id/comments', { params: { id: sid }, body: { body: 'After cancel, a comment still works.' } })
  // self-service start by an employee, initiator-stage reject
  C('u_subham', 'POST', '/wf/instances', { body: { template_id: 'r_02vn', subject_id: 'u_subham', note: 'Please approve my document' } })
  C('u_subham', 'POST', '/wf/instances', { body: { template_id: 'r_02vn', subject_ids: ['u_subham', 'u_hritesh'] } })
  const sc = C(P, 'POST', '/wf/instances', { body: { template_id: 'r_02vn', subject_ids: ['u_subham'] } })
  act(P, sc.v?.created?.[0]?.id ?? 'nope', { action: 'reject', reason: 'The initiator stage cannot reject this' })
  for (const u of VIEWERS) for (const tab of ['waiting', 'started', 'about', 'all']) C(u, 'GET', '/wf/instances', { query: { tab } })
}))

// SLA escalation at later days (sweep inside GET /wf/instances and the inbox feed)
for (const today of ['2026-10-20', '2026-10-27'])
  S.push(K.scenario(`wf sweep ${today}`, 'tn_seereon', today, (a) => {
    a.fn('u_santosh', 'wfInboxRows')
    for (const u of VIEWERS) a.call(u, 'GET', '/wf/instances', { query: { tab: 'waiting' } })
    a.fn('u_subhankar', 'wfInboxRows')
    for (const i of mine('wf_instances', 'tn_seereon')) a.call('u_santosh', 'GET', '/wf/instances/:id', { params: { id: i.id } })
  }))

const size = writeGz('rd_v7.json.gz', { generated_on: TODAY, scenarios: S })
console.log(`rd_v7: ${S.length} scenarios, ${S.reduce((n, s) => n + s.steps.length, 0)} steps, ${(size / 1e3).toFixed(0)} KB`)
void row
