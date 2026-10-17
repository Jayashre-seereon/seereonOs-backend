// Golden vectors for app/engine/doc_markup.py + app/engine/docgen.py (ports of src/mock/docMarkup.ts, src/mock/docgen.ts):
//   TZ=Asia/Kolkata node backend/tests/golden/gen/docs.mjs -> vectors/docs.json.gz (+ vectors/engine_seed.json.gz)
// Pure markup functions on every template / email body of the seed + edge cases; the docgen engine (standard vars,
// render, reference numbers, issueDocument with its notifications / emails / activity, default provisioning) on the
// full seed with a pinned ctx.today.
import { install, loadTs, makeCtx, norm, readSeed, safe, writeGz } from './_engine.mjs'

const M = await loadTs('docs', `export * as mk from '@/mock/docMarkup'\nexport * as dg from '@/mock/docgen'\nexport { WF_DOC_TEMPLATES, WF_EMAIL_TEMPLATES } from '@/mock/seeds/workflows'\nexport { DEFAULT_DOC_TEMPLATES } from '@/mock/seeds/documentsV7'\n`)
const { server, mk, dg } = M
const seed = readSeed()
writeGz('engine_seed.json.gz', seed)
const T = seed.tables
const out = { generated_on: seed.generated_on, year: new Date().getFullYear() }

/* ---------------- pure markup ---------------- */
const EDGE = [
  '', ' ', '\n\n', 'plain', 'a\r\nb\r\n\r\nc', 'a\rb', '# H1', '## H2 **b**', '### H3 *i*', '#### four', '#nospace', '  # indented', '##\tTab',
  '**bold** and *italic* and **unclosed', '*a* *b *c*', '** x **', '***x***', '*x*y*', 'a ** b ** c', '**a*b**', '* x*', '*﻿x*',
  '---', '___', '--', '- - -', '-----', '- item\n- item 2\n* star', '1. one\n2) two\n3. three\nnot', '1.one', '- a\n1. b', '- x',
  '| a | b |\n|---|---|\n| 1 | 2 |', '| a | b |\n| c | d |', '|a|b|\n|:--|--:|\n|₹ 1,200.50|50%|\n|---|---|\n|x|', '| only |', '|---|', '| a |\n| --- |',
  '| ₹ 3 | Rs. 4 | Rs 5 | −6 | - 7 % | 1.2.3 | 1, | ,1 |', '|x|\n\n|y|', ':::center\nhi\n:::\nback', ':::right\n# r\n:::left\nl', '::: center \nx', ':::middle\nx', ':::',
  'line1\nline2\n\nnext para', '<script>&"\'</script>', '{{ name }} {{name}} {{x-y}} {{ a b }} {{}} {{_}} {{1}}', 'α **β** *γ*', '😀 *😀* **😀**', 'a b', '# x',
  '- a\n\n- b', '| a |\n- b\n# c', '1. a\n- b', '   \n\t\n', '**\n**', ':::center\n| a |\n|---|\n| 1 |\n:::',
]
const bodies = new Map()
const add = (b, cat) => {
  if (typeof b === 'string' && !bodies.has(b)) bodies.set(b, cat)
}
for (const t of T.doc_templates) add(t.body, t.category)
for (const t of M.DEFAULT_DOC_TEMPLATES) add(t.body, t.category)
for (const t of M.WF_DOC_TEMPLATES) add(t.body, t.category)
for (const t of T.email_templates) add(t.body, 'other'), add(t.subject, 'other')
for (const t of M.WF_EMAIL_TEMPLATES) add(t.body, 'other')
for (const d of T.issued_documents) add(d.body_md, d.category)
for (const e of EDGE) add(e, 'other')
const CATS = [...mk.TEMPLATE_CATEGORIES, 'policy']
const CUSTOMS = [[], ['foo_bar', 'employee_name', 'ctc_annual'], ['12', 'constructor', 'x']]
out.markup = [...bodies].map(([body, cat]) => ({
  body,
  cat,
  parse: mk.parseMarkup(body),
  html: mk.markupToHtml(body),
  ph: mk.placeholdersIn(body),
  fill_sample: mk.fillPlaceholders(body, mk.sampleVars(cat)),
  fill_mixed: mk.fillPlaceholders(body, { employee_name: 'A', net_pay: 70000.5, today: null, company: undefined, x: 0, n: -0.1 }),
  proc: CATS.map((c) => CUSTOMS.map((cu) => mk.processPlaceholders(body, c, cu))),
}))
out.inline = EDGE.map((s) => ({ s, runs: mk.parseInline(s), text: mk.runsText(mk.parseInline(s)) }))
const keys = new Set(['foo_bar', 'x', '', 'constructor', 'toString', 'ß_x', '_lead', 'a__b', 'éclair', '1st'])
for (const p of mk.STANDARD_PLACEHOLDERS) keys.add(p.key)
for (const l of Object.values(mk.CATEGORY_PLACEHOLDERS)) for (const p of l) keys.add(p.key)
out.labels = [...keys].map((k) => ({ k, l: mk.labelOf(k) }))
out.catalogue = CATS.map((c) => ({ c, cat: mk.catalogueFor(c), known: [...mk.knownPlaceholders(c, ['zz', 'net_pay'])].sort(), sample: CUSTOMS.map((cu) => Object.entries(mk.sampleVars(c, cu))) }))
const nums = [0, 1, 7, 10, 11, 19, 20, 21, 45, 99, 100, 101, 110, 999, 1000, 1001, 1100, 9999, 10000, 12345, 99999, 100000, 100001, 1234567, 9999999, 10000000, 12345678, 99999999, 100000000, 123456789012, 2.5, 19.99, -42, -0]
for (let i = 0; i < 2000; i += 37) nums.push(i * 997)
const paise = [0, 1, 50, 99, 100, 101, 7000050, 12345.5, -2500, 100000000, 99999999999]
for (const r of T.payroll_lines ?? []) for (const k of Object.keys(r)) if (k.endsWith('_paise') && typeof r[k] === 'number') paise.push(r[k])
for (const r of T.payslips ?? []) for (const k of Object.keys(r)) if (k.endsWith('_paise') && typeof r[k] === 'number') paise.push(r[k])
out.words = nums.map((n) => ({ n, w: mk.numberToIndianWords(n) }))
out.rupees = [...new Set(paise)].map((p) => ({ p, w: mk.rupeesInWords(p) }))
const dates = ['2026-02-30', '2026-02-31', '2026-13-01', '2026-00-05', '0026-01-01', '2026-06-31', '2026-09-05x', '9999-12-31', '2026-04-31', '2026-01-32', '2026-01-00', '0000-01-01', '0000-02-29', '1900-02-29', '2024-02-29', '2026-10-15T23:59:59Z', '', null, undefined, 'x', '2026-1-05', '20261005']
for (const u of T.users) dates.push(u.joined_on)
for (let i = 0; i < 400; i += 3) dates.push(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10))
out.long_dates = dates.map((d) => ({ d: d === undefined ? '$undef' : d, v: dg.longDate(d) }))

/* ---------------- docgen engine (full seed) ---------------- */
const TODAYS = ['2026-10-15', '2027-01-01', '2026-02-28']
const tenants = T.tenants.filter((t) => T.users.some((u) => u.tenant_id === t.id))
out.std = []
for (const t of tenants) {
  const users = T.users.filter((u) => u.tenant_id === t.id)
  for (const u of users)
    for (const issuer of [users[0].id, u.id, null, 'u_nobody'])
      out.std.push({ t: t.id, e: u.id, i: issuer, today: TODAYS[out.std.length % 3], v: dg.standardVarsFor(seed.tables, t.id, u.id, issuer, TODAYS[out.std.length % 3]) })
  out.std.push({ t: t.id, e: 'u_nobody', i: null, today: '2026-10-15', v: dg.standardVarsFor(seed.tables, t.id, 'u_nobody', null, '2026-10-15') })
}
out.render = []
for (const tpl of T.doc_templates) {
  const users = T.users.filter((u) => u.tenant_id === tpl.tenant_id).slice(0, 3)
  for (const u of users) {
    const vars = { ...dg.standardVarsFor(seed.tables, tpl.tenant_id, u.id, users[0].id, '2026-10-15'), ref_no: 'R/1', net_pay: '₹1.00' }
    out.render.push({ body: tpl.body, vars, v: dg.renderBody(tpl.body, vars) })
  }
}

/* issueDocument scenarios: each on a fresh copy of the seed; the new rows of the touched tables are recorded */
const TABLES = ['issued_documents', 'notifications', 'email_outbox', 'activity_log', 'number_sequences', 'doc_templates', 'email_templates']
function scenario(name, tenantId, issuerId, today, run, pre) {
  const db = install(server, seed.tables)
  if (pre) pre(db)
  const before = Object.fromEntries(TABLES.map((k) => [k, db[k].length]))
  const ctx = makeCtx(server, db, issuerId, [], today)
  const res = safe(() => run(ctx))
  const added = Object.fromEntries(TABLES.map((k) => [k, norm(db[k].slice(before[k]))]))
  const seqs = norm(db.number_sequences.filter((s) => s.tenant_id === tenantId))
  return { name, tenant: tenantId, issuer: issuerId, today, res, added, seqs, warnings: ctx.warnings }
}
out.issue = []
for (const t of tenants) {
  const users = T.users.filter((u) => u.tenant_id === t.id && u.status === 'active')
  const issuer = users[0].id
  const tpls = T.doc_templates.filter((x) => x.tenant_id === t.id)
  tpls.forEach((tpl, i) => {
    const emp = users[i % users.length].id
    const today = TODAYS[i % 3]
    out.issue.push({ input: { template_key: tpl.key, employee_id: emp }, ...scenario('key', t.id, issuer, today, (ctx) => dg.issueDocument(ctx, { template_key: tpl.key, employee_id: emp })) })
    if (i % 3 === 0) {
      const input = { template_id: tpl.id, employee_id: emp, vars: { ctc_annual: 840000, note: null, gone: undefined, '7': 'seven', ref_no: '' }, title: 'Custom', status: 'draft' }
      out.issue.push({ input: norm(input), ...scenario('draft', t.id, issuer, today, (ctx) => dg.issueDocument(ctx, input)) })
    }
    if (i % 4 === 1) {
      const input = { template_key: tpl.key, employee_id: emp, vars: { ref_no: 'X/1', month_label: 'Sept 2026', net_pay: '₹70,000.00' }, period: '2026-09', notify: false, issued_on: '2026-09-30', source: { kind: 'payroll', ref_id: 'r1' } }
      out.issue.push({ input, ...scenario('nonotify', t.id, issuer, today, (ctx) => dg.issueDocument(ctx, input)) })
    }
    if (tpl.category === 'payslip') {
      const input = { template_key: tpl.key, employee_id: emp, vars: { month_label: 'September 2026', net_pay: '₹70,000.00' }, period: '2026-09' }
      out.issue.push({ input, ...scenario('payslip', t.id, issuer, today, (ctx) => dg.issueDocument(ctx, input)) })
      const input2 = { template_key: tpl.key, employee_id: emp, period: null }
      out.issue.push({ input: input2, ...scenario('payslip2', t.id, issuer, today, (ctx) => dg.issueDocument(ctx, input2)) })
    }
  })
  out.issue.push({ input: { template_key: 'nope', employee_id: issuer }, ...scenario('missing-tpl', t.id, issuer, '2026-10-15', (ctx) => dg.issueDocument(ctx, { template_key: 'nope', employee_id: issuer })) })
  out.issue.push({ input: { template_key: tpls[0].key, employee_id: 'u_nobody' }, ...scenario('missing-emp', t.id, issuer, '2026-10-15', (ctx) => dg.issueDocument(ctx, { template_key: tpls[0].key, employee_id: 'u_nobody' })) })
  // a workspace without the v7 defaults: ensureDocDefaults provisions them (ids are random: compared without ids)
  out.issue.push({
    input: { defaults: true },
    ...scenario('defaults', t.id, issuer, '2026-10-15', (ctx) => dg.ensureDocDefaults(ctx), (db) => {
      db.number_sequences = db.number_sequences.filter((s) => !(s.tenant_id === t.id && s.scope === 'docs_v7_defaults'))
      db.doc_templates = db.doc_templates.filter((x) => !(x.tenant_id === t.id && (x.key === 'offer_letter' || x.key === 'payslip')))
      db.email_templates = db.email_templates.filter((x) => !(x.tenant_id === t.id && x.key === 'custom'))
    }),
  })
  // nextRef directly
  out.issue.push({ input: { ref: true }, ...scenario('ref', t.id, issuer, '2027-03-31', (ctx) => [dg.nextRef(ctx, 'payslip', '2026-09', ''), dg.nextRef(ctx, 'payslip', null, 'E1'), dg.nextRef(ctx, 'offer_letter', '2026-09', 'E1'), dg.nextRef(ctx, 'other', null, '')]) })
}
const size = writeGz('docs.json.gz', out)
console.log(`docs vectors: ${out.markup.length} bodies, ${out.std.length} std, ${out.render.length} render, ${out.issue.length} issue scenarios -> ${size} bytes`)
