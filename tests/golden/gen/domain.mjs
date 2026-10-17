// Golden vectors for app/domain/* (ports of src/domain/*.ts), computed by the TypeScript on real inputs (the demo
// seed) plus edge cases:   TZ=Asia/Kolkata node backend/tests/golden/gen/domain.mjs -> tests/golden/vectors/domain.json
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, importTs, writeJson } from '../../../tools/_bundle.mjs'

const D = await importTs(null, {
  name: 'domain',
  contents: `
export * as cal from '@/domain/calendar'
export * as money from '@/domain/money'
export * as costing from '@/domain/costing'
export * as delivery from '@/domain/delivery'
export * as sales from '@/domain/sales'
export * as pw from '@/domain/passwordPolicy'
export * as fs from '@/domain/fileSafety'
export * as pc from '@/domain/permissionCatalog'
export * as totp from '@/domain/totp'
export * as collate from '@/domain/collate'
`,
})
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/var/seed.json'), 'utf8')).tables
const { cal, money, costing, delivery, sales, pw, fs: fsafe, pc, totp } = D
const out = {}
const safe = (f) => {
  try {
    const v = f()
    return v === undefined ? { undef: true } : { v: typeof v === 'number' && !Number.isFinite(v) ? String(v) : v }
  } catch (e) {
    return { throws: String(e.message) }
  }
}

/* ---------------- calendar ---------------- */
const dates = []
for (let i = -400; i <= 800; i += 7) dates.push(cal.addDays('2026-01-01', i))
dates.push('2024-02-29', '2025-02-28', '2026-01-31', '2026-03-31', '2026-05-31', '2026-08-31', '2026-10-31', '2026-12-31', '2027-02-28', '2028-02-29')
const odd = ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '20260105', 'x', '', '2026-06-31', '0026-01-01', '2026-02']
out.calendar = {
  year: new Date().getFullYear(),
  basic: [...dates, ...odd].map((s) => ({
    s, parse: cal.toISO(cal.parseISO(s)), real: cal.isRealISODate(s), add: [-400, -31, -1, 0, 1, 30, 365].map((n) => cal.addDays(s, n)),
    months: [-14, -12, -1, 1, 2, 11, 12, 13].map((n) => cal.addMonths(s, n)), diff: [cal.diffDays(s, '2026-01-01'), cal.diffDays('2026-06-15', s)],
    ws: cal.weekStart(s), sat: cal.saturdayOrdinal(s), fy: [cal.fyStartYear(s), cal.fyStartYear(s, 1), cal.fyStartYear(s, 7)],
    q: safe(() => cal.quarterOf(s)), pm: safe(() => cal.periodRange('month', s)), pq: safe(() => cal.periodRange('quarter', s)), pf: safe(() => cal.periodRange('fy', s)),
    prev: safe(() => cal.previousPeriod('quarter', s)), fmt: [cal.fmtDate(s), cal.fmtDate(s, 'long'), cal.fmtDate(s, 'day')], wl: safe(() => cal.weekLabel(cal.weekStart(s))),
  })),
  months: ['2026-01', '2026-02', '2024-02', '2026-12', '2027-06'].map((ym) => ({ ym, r: cal.monthRange(ym) })),
  fyl: [2024, 2025, 2099, 2100].map((y) => ({ y, l: cal.fyLabel(y), r: cal.fyRange(y), r1: cal.fyRange(y, 1) })),
  tenants: [],
}
const RULES = [
  { 'calendar.weekly_off': [0], 'calendar.saturday_rule': 'some_off', 'calendar.saturday_off_weeks': [2, 4], 'calendar.min_hours_per_day': 9 },
  { 'calendar.weekly_off': [0, 6], 'calendar.saturday_rule': 'all_on', 'calendar.saturday_off_weeks': [], 'calendar.min_hours_per_day': 8 },
  { 'calendar.weekly_off': [0], 'calendar.saturday_rule': 'all_off', 'calendar.saturday_off_weeks': [], 'calendar.min_hours_per_day': 8 },
  { 'calendar.weekly_off': [0], 'calendar.saturday_rule': 'all_on', 'calendar.saturday_off_weeks': [1, 3, 5], 'calendar.min_hours_per_day': 8 },
]
for (const t of seed.tenants) RULES.push(t.settings)
for (const settings of RULES) {
  const tid = seed.tenants[0].id
  const holidays = seed.holidays.filter((h) => h.tenant_id === tid)
  const leave = new Set(seed.leave.filter((l) => l.tenant_id === tid && l.portion === 'full').slice(0, 40).map((l) => l.date))
  const ctx = { settings, holidays, leaveDates: leave }
  const ctx0 = { settings, holidays }
  out.calendar.tenants.push({
    settings, holidays_tenant: tid, leave: [...leave],
    days: dates.map((s) => [cal.dayKind(s, ctx), cal.isWorkingDay(s, ctx0)]),
    between: dates.slice(0, 60).map((s, i) => [s, dates[i + 7], cal.workingDaysBetween(s, dates[i + 7], ctx), cal.workingDaysBetween(dates[i + 7], s, ctx)]),
    inMonth: ['2026-01', '2026-02', '2026-09', '2026-10', '2027-03'].map((ym) => cal.workingDaysInMonth(ym, ctx)),
    addW: dates.slice(0, 40).map((s) => [cal.addWorkingDays(s, 0, ctx), cal.addWorkingDays(s, 1, ctx), cal.addWorkingDays(s, 7, ctx)]),
    avg: [2025, 2026].map((y) => cal.avgWorkingDaysPerMonth(y, ctx0)),
  })
}

/* ---------------- money ---------------- */
const P = [0, 1, 50, 99, 100, 150, 9999, 10000, 12345, 99999, 100000, 123456, 1234567, 12345678, 123456789, 1234567890, 99999999, 9999999999, -1, -150, -12345678, 55000.55, 0.5, NaN, null, undefined]
out.money = P.map((p) => ({
  p: p === undefined ? '$undef' : Number.isNaN(p) ? 'NaN' : p,
  m: money.fmtMoney(p), md: money.fmtMoney(p, { decimals: true }), ms: money.fmtMoney(p, { sign: true }), c: money.fmtMoneyCompact(p), r: p === undefined || p === null || Number.isNaN(p) ? null : money.rupees(p),
}))
const V = [0, 0.1234, 0.5, 1, -0.25, 0.1, 0.001, 0.0005, 12.3456, 1 / 3, 2 / 3, 0.995, -0.995, 1e-9, 123456.789, NaN, Infinity, null]
out.pct = V.map((v) => ({ v: v === null ? null : Number.isFinite(v) ? v : String(v), p: money.fmtPct(v), p0: money.fmtPct(v, 0), p2: money.fmtPct(v, 2), n: money.fmtNum(v), n2: money.fmtNum(v, 2), h: v === null ? money.fmtHours(v) : money.fmtHours(v) }))
out.paise = ['₹1,20,000', '1200.50', ' 12 ', 'abc', '', '1e3', 12.345, 0.1 + 0.2, -5.555].map((x) => ({ x, p: money.paise(x) }))
out.change = [[10, 5], [5, 10], [0, 0], [3, 0], [-5, -10], [0, 4]].map(([a, b]) => ({ a, b, c: money.change(a, b) }))

/* ---------------- costing / delivery / sales ---------------- */
out.costing = {
  cph: [[100000, 22, 9], [5000000, 0, 9], [123456, 23.8, 8]].map(([a, b, c]) => costing.costPerHour(a, b, c)),
  rateOn: seed.users.slice(0, 20).flatMap((u) => ['2025-01-01', '2026-04-01', '2026-10-01', '2030-01-01'].map((d) => [u.id, d, costing.rateOn(seed.cost_rates, u.id, d)?.id ?? null])),
  ratios: [[100, 60], [0, 10], [50, 0], [-10, 5]].map(([r, c]) => [costing.marginPct(r, c), costing.markupPct(r, c), costing.effortRatio(r, c)]),
  health: [],
  comp: [[100000, 20, 500000, 600000], [100000, 20, null, 50000], [123457, 15, 0, 0], [100000, 20, 500000, 499999, 90]].map((a) => costing.salesCompensation(...a)),
  milestones: [
    'Design | 2L\nBuild | 1,50,000\nUAT\n\nGo-live | 75K',
    'A|1.5 lakh\nB|₹2,00,000\nC|abc\nA|10\n|5\nX'.repeat(1),
    'Line one\r\nline ONE | 1cr\nThree | Rs.500\nFour|12.5k\nFive | 1e3',
    'x'.repeat(130) + ' | 10',
    '',
  ].map((t) => costing.parseMilestoneLines(t)),
  cat: ['software', 'nope'].map(costing.additionalCategoryLabel),
  short: ['fixed', 'tm', 'subscription', 'ams_retainer', 'x'].map(costing.commercialShort),
}
for (const m of [null, -0.1, 0.1, 0.3]) for (const e of [null, 1, 1.3]) for (const o of [undefined, 0, 1, 2]) out.costing.health.push([m, e, o ?? null, costing.projectHealth({ projectedMargin: m, effortRatio: e, floor: 0.25, alert: 1.2, overdueMilestones: o })])
out.delivery = {
  tasks: seed.tasks.map((t) => [t.id, delivery.stageOf(t), delivery.progressOf(t)]),
  extra: [{ status: 'todo' }, { status: 'in_review' }, { status: 'in_progress', progress: 10, stage: 'uat' }, { status: 'done', progress: 3 }, { status: 'blocked', progress: 150 }].map((t) => [delivery.stageOf(t), delivery.progressOf(t)]),
  sfs: ['new', 'uat', 'completed', 'blocked'].flatMap((s) => ['todo', 'in_review', 'done'].map((c) => delivery.statusForStage(s, c))),
  prio: [1, 3, 5, 9].map(delivery.priorityLabel),
  cpd: [[3000000, 23.8], [3000000, 0], [1234567, 21.5, 15]].map((a) => delivery.costPerDay(...a)),
  rc: [[123456, 50, 22], [100000, 33.3, 17], [5000, 100, 0]].map((a) => delivery.resourceCost(...a)),
  mm: [-150, -100, 0, 25, 33.3, 99].map((x) => [delivery.marginFromMarkup(x), delivery.markupFromMargin(x), delivery.priceFromMarkup(123457, x), delivery.markupFromPrice(1000, 1000 + x)]),
}
out.sales = {
  deals: seed.deals.map((d) => sales.dealValue(d)),
  phones: ['', ' ', '+91 90907 05533', '9090705533', '12345', '(080) 1234-5678', '+1-800-FLOWERS', '1234567890123456', '+', ' 98765 43210 '].map((p) => sales.validPhone(p)),
  emails: ['', 'a@b.co', 'a@b', 'x y@z.in', ' a@b.in '].map((e) => sales.validEmail(e)),
  median: [[], [3], [3, 1], [5, 1, 3], [1, 2, 3, 4], [10, 2, 33, 4]].map((x) => sales.median(x)),
}

/* ---------------- password policy ---------------- */
const PW = ['short', 'Password@123', 'welcome2026!', '1234567890', 'aaaaaaaaaaaa', 'RitikaPass123', 'ritika@2026', 'correct horse battery staple', 'x'.repeat(129), 'abcdefg', 'Seereon@123', 'Seereon@2026x', 'qwertyuiopqwertyuiop', '😀😀😀😀😀', 'santosh@seereon.co.in', 'Santosh123!', null, undefined]
out.password = PW.flatMap((p) => [[10, 'ritika@x.in'], [4, null], [12, 'santosh@seereon.co.in'], [undefined, undefined]].map(([min, email]) => ({ p: p === undefined ? '$undef' : p, min: min ?? null, email, r: pw.checkPassword(p, { min, email }) })))

/* ---------------- file safety ---------------- */
const b64 = (s) => Buffer.from(s, 'latin1').toString('base64')
const PNG = '\x89PNG\r\n\x1a\n' + '\0'.repeat(20)
const files = [
  'data:image/png;base64,' + b64(PNG), 'data:image/png;base64,' + b64('<html><script>x</script>'), 'data:text/html;base64,' + b64('<p>'), 'data:image/svg+xml;base64,' + b64('<svg onload="x()"></svg>'),
  'data:image/svg+xml;base64,' + b64('<?xml version="1.0"?><svg><rect/></svg>'), 'data:application/pdf;base64,' + b64('%PDF-1.4 ...'), 'data:application/pdf;base64,' + b64(PNG), 'data:;base64,' + b64('hello'),
  'data:text/plain;base64,' + b64('<script>'), 'data:text/csv;charset=utf-8;base64,' + b64('a,b'), 'data:image/png,notbase64', 'data:image/png;base64,@@@@', 'data:application/octet-stream;base64,' + b64('<!DOCTYPE html>'),
  'data:image/jpeg;base64,' + b64('\xff\xd8\xff\xe0'), 'data:image/svg+xml;base64,' + b64('<svg><a href="https://x"/></svg>'), 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + b64('PK\x03\x04xx'),
  'data:application/msword;base64,' + b64('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'), 'data:image/gif;base64,' + b64('GIF89a'), 'data:application/xml;base64,' + b64('<?xml?>'), 'data:image/webp;base64,' + b64('RIFF0000WEBPVP8 '),
  'data:image/png;base64,' + b64('\xef\xbb\xbf  <svg></svg>'), 'data:text/plain;base64,' + b64('x'.repeat(5000)),
]
out.files = files.map((f) => ({ f, r: fsafe.checkDataUrl(f), r10: fsafe.checkDataUrl(f, 0), rs: fsafe.checkDataUrl(f, 'abc') }))
const bodies = [
  { logo: files[0] }, { a: { b: [{ data_url: files[1] }] } }, [{ x: files[3] }], { file: { mime: 'text/html', data: files[0] } }, { file: { type: ' application/javascript ', data: files[0] } },
  { attachments: [{ size_bytes: 1, data_url: files[21] }] }, { attachments: [{ size: 99999, data_url: files[21] }] }, { deep: { a: { b: { c: { d: { e: { f: { g: { h: { i: files[1] } } } } } } } } } },
  { note: 'data: not a url', n: 5 }, { ok: files[0], bad: files[2] }, null, 'data:text/html;base64,AAAA',
]
out.bodies = bodies.map((b) => ({ b, r: fsafe.findFileProblem(b) }))

/* ---------------- permissions ---------------- */
const roles = seed.roles
out.perms = seed.users.map((u) => {
  const rd = roles.find((r) => r.tenant_id === u.tenant_id && r.key === u.role_key)
  return { id: u.id, r: pc.effectivePermissions(rd && rd.active ? rd.permissions : [], u.extra_permissions ?? [], u.revoked_permissions ?? []) }
})
out.permsExtra = [pc.effectivePermissions(undefined), pc.effectivePermissions(['x', 'users.view', 'ai.use', 'ai.use'], ['tasks.edit', 'bogus'], ['users.view'])]

/* ---------------- totp ---------------- */
const key = new TextEncoder().encode('12345678901234567890')
const b32 = totp.base32Encode(key)
out.totp = {
  b32,
  hotp: [0, 1, 2, 59, 1111111109, 37037036, 37037037, 41152263, 666666666].map((c) => [c, totp.hotp(key, c), totp.hotp(key, c, 8), totp.hotp(key, c, 8, 'sha256')]),
  totp: [59_000, 1111111109_000, 1234567890_000, 2000000000_000].map((t) => [t, totp.totp(b32, t)]),
  verify: [[totp.totp(b32, 1_700_000_000_000), 1_700_000_000_000, null], [totp.totp(b32, 1_700_000_000_000 - 30_000), 1_700_000_000_000, null], [totp.totp(b32, 1_700_000_000_000 - 60_000), 1_700_000_000_000, null], [totp.totp(b32, 1_700_000_000_000), 1_700_000_000_000, totp.totpStep(1_700_000_000_000)], ['12345', 1_700_000_000_000, null], [' 287 082 ', 59_000, null]].map(([c, now, after]) => [c, now, after, totp.verifyTotp(b32, c, { now, afterStep: after })]),
  b32x: ['', 'MZXW6YTBOI', 'mzxw6ytboi', 'MZXW 6YTB-OI==', 'MZXW1', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'].map((s) => { const r = totp.base32Decode(s); return [s, r ? Buffer.from(r).toString('hex') : null] }),
  b32e: ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '\xff\x00\x10'].map((s) => totp.base32Encode(Buffer.from(s, 'latin1'))),
  url: [totp.otpauthUrl('SeereonOS', 'a@b.co', 'ABC'), totp.otpauthUrl('Seereon OS', 'ritika+1@x.in', 'XYZ')],
  rc: [['salt', 'abcde-fghij'], ['s2', 'ABCDE FGHIJ'], ['', '']].map(([s, c]) => [totp.normalizeRecoveryCode(c), totp.hashRecoveryCode(s, c)]),
  sha: ['', 'abc', 'tn_seereon.xyz', 'é😀'].map((s) => totp.sha256Hex(s)),
  cte: [['a', 'a'], ['a', 'b'], ['abc', 'ab'], ['', '']].map(([x, y]) => totp.constantTimeEqual(x, y)),
}

// the seed rows used as inputs travel with the vectors (the seed changes every day: dates are relative to today)
out.inputs = {
  holidays: seed.holidays, leave_tenant: seed.tenants[0].id, cost_rates: seed.cost_rates, deals: seed.deals, roles: seed.roles, users: seed.users,
  tasks: seed.tasks.map((t) => ({ id: t.id, status: t.status, ...(t.stage !== undefined ? { stage: t.stage } : {}), ...(t.progress !== undefined ? { progress: t.progress } : {}) })),
}
writeJson(path.join(ROOT, 'backend/tests/golden/vectors/domain.json'), out, { pretty: false })
console.log('domain vectors written')
