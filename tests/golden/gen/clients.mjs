// Golden vectors for app/routes/clients.py (port of src/mock/routes/clients.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/clients.mjs -> vectors/clients.json.gz
// Reads (which sync the client master and send renewal reminders) for several users / days, every write route with
// valid + invalid bodies, and contractRenewals (used by /spend/summary). costing.ts is loaded like in the app (it
// installs the project-metrics override used for client health).
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('clients', `export * as sp from '@/mock/routes/spend'\nexport * as cl from '@/mock/routes/clients'\nexport * as co from '@/mock/costing'\n`)
const { server, sp, cl } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['clients', 'contracts', 'projects', 'deals', 'files', 'activity_log', 'notifications']
const K = kit({ server, T, modules: [sp, cl], tables: TABLES, fns: { contractRenewals: (ctx) => cl.contractRenewals(ctx) } })
const TODAY = seed.generated_on
const S = []
const file = (name = 'c.pdf', size = 1000) => ({ name, mime: '', size_bytes: size, data_url: 'data:application/pdf;base64,JVBERi0xLjQK' })

const READERS = { tn_seereon: ['u_santosh', 'u_baishali', 'u_subham', 'u_hritesh', 'u_priya'], tn_kalinga: ['u_k_ananya', 'u_k_meera', 'u_k_sneha'] }
for (const [tid, users] of Object.entries(READERS))
  for (const today of [TODAY, '2026-12-20', '2027-06-01'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        a.call(u, 'GET', '/clients')
        a.call(u, 'GET', '/clients', { query: { mine: '1' } })
        for (const c of a.db.clients.filter((x) => x.tenant_id === tid)) a.call(u, 'GET', '/clients/:id', { params: { id: c.id } })
        a.call(u, 'GET', '/clients/:id', { params: { id: 'nope' } })
        a.call(u, 'GET', '/clients-lite')
        a.fn(u, 'contractRenewals')
      }
      a.call(users[0], 'GET', '/spend/summary')
    }, tid === 'tn_seereon' ? [
      { kind: 'insert', table: 'deals', row: { ...T.deals.find((d) => d.tenant_id === 'tn_seereon'), id: 'd_newco', client: 'Konark Steels Pvt Ltd', contact: 'R. Das', email: 'rd@konark.in', phone: '98', stage: 'proposal', title: 'Konark MES' } },
      { kind: 'insert', table: 'ledger_entries', row: { ...T.ledger_entries.find((l) => l.kind === 'income' && !l.invoice_id), id: 'le_x', description: 'Retainer — Mahanadi minerals group (Q2)', date: '2026-09-01', status: 'received', amount_paise: 1234500 } },
    ] : []))

S.push(K.scenario('clients writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const U = 'u_santosh'
  for (const [i, body] of [{}, { name: 'A' }, { name: 'infosys' }, { name: 'New Co', gstin: 'bad' }, { name: 'New Co', email: 'x@y' }, { name: 'New Co', payment_terms_days: -1 }, { name: 'New Co', owner_id: 'nope' },
    { name: 'New Co', state: 'Atlantis' }, { name: 'New Co', state_code: '99' }, { name: 'New Co', gstin: '29AABCI1681G1ZF', state: 'Odisha' }, { name: 'New Co', country: 'USA', gstin: '29AABCI1681G1ZF' },
    { name: 'New Co', pincode: '123' }, { name: 'New Co', pan: 'bad' }, { name: 'New Co', gstin: '29AABCI1681G1ZF', pan: 'AAAAA1111A' }, { name: 'New Co', status: 'odd' }].entries())
    C(U, 'POST', '/clients', { body: body.name === 'New Co' ? { ...body, name: `New Co ${i}` } : body })
  const n1 = C(U, 'POST', '/clients', { body: { name: '  Konark Steels ', gstin: '21aabck1234d1z5', city: 'Cuttack', email: 'ap@konark.in', payment_terms_days: '45', owner_id: 'u_baishali', status: 'active', notes: ' n ' } })
  C(U, 'POST', '/clients', { body: { name: 'Acme GmbH', country: 'Germany', state: 'Berlin', status: 'churned' } })
  C(U, 'POST', '/clients', { body: { name: 'Orissa Mining', state: 'orissa', country: 'in' } })
  C('u_hritesh', 'POST', '/clients', { body: { name: 'Nope Co' } })
  C(U, 'PATCH', '/clients/:id', { params: { id: 'cl_dr' }, body: { name: 'Digitalratha Technologies' }, ifMatch: 9 })
  C(U, 'PATCH', '/clients/:id', { params: { id: 'cl_dr' }, body: { name: 'Digitalratha Technologies', status: 'dormant' } })
  C(U, 'PATCH', '/clients/:id', { params: { id: 'cl_mgs' }, body: { status: 'churned' } })
  C(U, 'PATCH', '/clients/:id', { params: { id: 'cl_mgs' }, body: { status: 'active', billing_address: 'Plot 5' } })
  if (n1.v) C(U, 'PATCH', '/clients/:id', { params: { id: n1.v.id }, body: { gstin: '' , pan: ''} })
  C(U, 'GET', '/clients')
  // contracts
  for (const body of [{}, { title: 'AB' }, { title: 'AMC' }, { title: 'AMC', kind: 'xx' }, { title: 'AMC', kind: 'amc', value_paise: -1 }, { title: 'AMC', kind: 'amc', value_paise: 1.5 }, { title: 'AMC', kind: 'amc' },
    { title: 'AMC', kind: 'amc', start_on: '2026-10-01' }, { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2026-09-01' }, { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2027-09-30', renewal_on: '2028-01-01' },
    { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2027-09-30', project_id: 'nope' }, { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2027-09-30', status: 'expired' },
    { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2027-09-30', file: { name: 'x' } }, { title: 'AMC', kind: 'amc', start_on: '2026-10-01', end_on: '2027-09-30', file: file('big.pdf', 11 * 1024 * 1024) }])
    C(U, 'POST', '/clients/:id/contracts', { params: { id: 'cl_mmg' }, body })
  const k1 = C(U, 'POST', '/clients/:id/contracts', { params: { id: 'cl_mmg' }, body: { title: 'HRMS AMC', kind: 'amc', value_paise: 1800000, start_on: '2026-10-01', end_on: '2026-12-01', auto_renew: 1, project_id: 'p_hrms', file: file() } })
  const k2 = C(U, 'POST', '/clients/:id/contracts', { params: { id: 'cl_mmg' }, body: { title: 'Mutual NDA', kind: 'nda', start_on: '2026-10-01', end_on: '2028-09-30', status: 'draft' } })
  C(U, 'POST', '/clients/:id/contracts', { params: { id: 'nope' }, body: {} })
  if (k1.v) {
    const id = k1.v.id
    C(U, 'GET', '/clients/:id', { params: { id: 'cl_mmg' } })
    C(U, 'PATCH', '/contracts/:id', { params: { id }, body: { end_on: '2027-03-31', file: { name: 'v2.pdf', data_url: 'data:application/pdf;base64,JVBERi0xLjQK', size_bytes: 10 } }, ifMatch: 1 })
    C(U, 'PATCH', '/contracts/:id', { params: { id }, body: { notes: 'x' }, ifMatch: 1 })
    C(U, 'POST', '/contracts/:id/renew', { params: { id }, body: { months: 0 } })
    C(U, 'POST', '/contracts/:id/renew', { params: { id }, body: { value_paise: -5 } })
    C(U, 'POST', '/contracts/:id/renew', { params: { id }, body: { months: '13', value_paise: 1980000 } })
    C(U, 'POST', '/contracts/:id/renew', { params: { id }, body: {} })
    C(U, 'DELETE', '/contracts/:id', { params: { id } })
  }
  if (k2.v) {
    C(U, 'POST', '/contracts/:id/renew', { params: { id: k2.v.id }, body: { months: 1, notes: '  ' } })
    C(U, 'DELETE', '/contracts/:id', { params: { id: k2.v.id }, ifMatch: 3 })
    C(U, 'DELETE', '/contracts/:id', { params: { id: k2.v.id } })
  }
  for (const c of a.db.contracts.filter((x) => x.tenant_id === 'tn_seereon' && x.status === 'active').slice(0, 3)) {
    C(U, 'POST', '/contracts/:id/renew', { params: { id: c.id }, body: { months: 1 } })
    C(U, 'PATCH', '/contracts/:id', { params: { id: c.id }, body: { status: 'terminated' } })
  }
  C(U, 'GET', '/clients')
  a.fn(U, 'contractRenewals')
}))
// month overflow on renewals (31st), leap years
S.push(K.scenario('renewal month overflow', 'tn_seereon', TODAY, (a) => {
  for (const [s, e, m] of [['2025-01-31', '2026-01-30', 1], ['2025-03-01', '2026-02-28', 12], ['2024-03-01', '2028-02-28', 1], ['2025-08-31', '2026-08-30', 6], ['2025-12-31', '2026-12-30', 2]]) {
    const r = a.call('u_santosh', 'POST', '/clients/:id/contracts', { params: { id: 'cl_dr' }, body: { title: `Term ${s}`, kind: 'sow', start_on: s, end_on: e, status: 'active' } })
    if (r.v) a.call('u_santosh', 'POST', '/contracts/:id/renew', { params: { id: r.v.id }, body: { months: m } })
  }
}))

const size = writeGz('clients.json.gz', { generated_on: seed.generated_on, scenarios: S })
console.log(`clients vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
