// Golden vectors for app/routes/finance.py (port of src/mock/routes/finance.ts) on the full seed:
//   TZ=Asia/Kolkata node backend/tests/golden/gen/finance.mjs -> vectors/finance.json.gz
// Ledger / entries / P&L reads over many ranges and days, every ledger write (valid + invalid, locked rows), and
// monthlyPnl for 18 months.
import { loadTs, writeGz } from './_engine.mjs'
import { kit, readEngineSeed } from './_routes_kit.mjs'

const M = await loadTs('finance', `export * as fi from '@/mock/routes/finance'\nexport * as co from '@/mock/costing'\n`)
const { server, fi } = M
const seed = readEngineSeed()
const T = seed.tables
const TABLES = ['ledger_entries', 'activity_log']
const K = kit({ server, T, modules: [fi], tables: TABLES, fns: { monthlyPnl: (ctx, a) => fi.monthlyPnl(ctx, a.ym) } })
const TODAY = seed.generated_on
const S = []
const RANGES = [{}, { from: '2026-10-01', to: '2026-10-31' }, { from: '2026-04-01', to: '2027-03-31' }, { from: '2026-07-01', to: '2026-09-30' }, { from: '2025-01-01', to: '2026-12-31' }, { from: '2026-11-01', to: '2026-12-31' },
  { from: 'bad', to: '2026-10-31' }, { from: '2026-10-31', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-02' }, { to: '2026-10-05' }, { from: '2026-10-15', to: '2026-10-15' }]
for (const [tid, users] of Object.entries({ tn_seereon: ['u_santosh', 'u_priya', 'u_hritesh', 'u_debasish'], tn_kalinga: ['u_k_ananya', 'u_k_sneha'] }))
  for (const today of [TODAY, '2027-01-03', '2026-04-01'])
    S.push(K.scenario(`reads ${tid} ${today}`, tid, today, (a) => {
      for (const u of users) {
        for (const q of RANGES) a.call(u, 'GET', '/finance/ledger', { query: q })
        for (const q of [{ kind: 'income' }, { kind: 'expense', category: 'Rent' }, { status: 'expected' }, { project_id: 'p_hrms' }, { stream: 'products' }, { recurring: 'true' }, { q: '  SALARY ' }, { q: 'prj-007' }])
          a.call(u, 'GET', '/finance/ledger', { query: { from: '2026-04-01', to: '2027-03-31', ...q } })
        for (const q of [{}, { scope: 'all' }, { scope: 'x' }]) a.call(u, 'GET', '/finance/ledger/entries', { query: q })
        a.call(u, 'GET', '/finance/projects-lite')
        for (const q of RANGES) a.call(u, 'GET', '/finance/pnl', { query: q })
      }
      for (const ym of ['2025-10', '2026-01', '2026-03', '2026-04', '2026-09', '2026-10', '2026-11', '2027-02']) a.fn(users[0], 'monthlyPnl', { ym })
    }, today === '2027-01-03' ? [{ kind: 'settings', id: tid, values: { 'finance.opening_cash_paise': 250000000 } }] : []))

S.push(K.scenario('ledger writes', 'tn_seereon', TODAY, (a) => {
  const C = (u, m, p, o) => a.call(u, m, p, o)
  const U = 'u_santosh'
  for (const body of [{}, { kind: 'x' }, { kind: 'income' }, { kind: 'income', category: '  ' }, { kind: 'income', category: 'Consulting', description: 'ab' }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: '100' },
    { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 1.5 }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100 }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: '2026-1-1' },
    { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, until_on: 'x' }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, status: 'odd' },
    { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, stream: 'odd' }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, recurring: true, until_on: '2026-01-01' },
    { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, project_id: 'nope' }, { kind: 'income', category: 'Consulting', description: 'Retainer', amount_paise: 100, date: TODAY, status: 'paid' },
    { kind: 'expense', category: 'Rent', description: 'Rent', amount_paise: 100, date: TODAY, status: 'received' }, { kind: 'income', category: 5, description: 'Retainer', amount_paise: 100, date: TODAY }])
    C(U, 'POST', '/finance/ledger', { body })
  const e1 = C(U, 'POST', '/finance/ledger', { body: { kind: 'income', category: ' Consulting ', description: '  Monthly retainer — Mahanadi ', amount_paise: 2500000, date: '2026-08-01', recurring: true, until_on: '2027-01-31', stream: 'services', project_id: 'p_hrms' } })
  const e2 = C(U, 'POST', '/finance/ledger', { body: { kind: 'expense', category: 'Marketing', description: 'Expo stall', amount_paise: 450000, date: '2026-11-20', stream: 'products' } })
  C(U, 'POST', '/finance/ledger', { body: { kind: 'expense', category: 'Rent', description: 'Office rent', amount_paise: 4600000, date: '2026-04-05', recurring: 1 } })
  C('u_priya', 'POST', '/finance/ledger', { body: { kind: 'expense', category: 'Rent', description: 'x', amount_paise: 1, date: TODAY } })
  if (e1.v) {
    const id = e1.v.id
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { amount_paise: 2600000 }, ifMatch: 7 })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { amount_paise: 2600000, description: '  ', id: 'x', version: 9, locked: true } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { amount_paise: 2600000, description: ' Retainer v2 ', until_on: '2026-01-01' } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { recurring: false, category: ' Consulting fees ', stream: '' } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { status: 'paid' } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { kind: 'expense' } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id }, body: { project_id: 'nope' } })
    C(U, 'GET', '/finance/ledger', { query: { from: '2026-04-01', to: '2027-03-31' } })
    C(U, 'GET', '/finance/ledger/entries', { query: { scope: 'all' } })
    C(U, 'DELETE', '/finance/ledger/:id', { params: { id }, ifMatch: 1 })
    C(U, 'DELETE', '/finance/ledger/:id', { params: { id } })
  }
  if (e2.v) C(U, 'PATCH', '/finance/ledger/:id', { params: { id: e2.v.id }, body: { status: 'expected', stream: 'products' } })
  const locked = a.db.ledger_entries.filter((l) => l.tenant_id === 'tn_seereon' && (l.locked || l.invoice_id)).slice(0, 2)
  for (const l of locked) {
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id: l.id }, body: { amount_paise: l.amount_paise + 1 } })
    C(U, 'PATCH', '/finance/ledger/:id', { params: { id: l.id }, body: { amount_paise: l.amount_paise, description: 'Renamed locked row' } })
    C(U, 'DELETE', '/finance/ledger/:id', { params: { id: l.id } })
  }
  C(U, 'DELETE', '/finance/ledger/:id', { params: { id: 'nope' } })
  C(U, 'GET', '/finance/pnl', { query: { from: '2026-04-01', to: '2027-03-31' } })
}))

const size = writeGz('finance.json.gz', { generated_on: seed.generated_on, scenarios: S })
console.log(`finance vectors: ${S.length} scenarios (${S.reduce((s, x) => s + x.steps.length, 0)} steps) -> ${size} bytes`)
