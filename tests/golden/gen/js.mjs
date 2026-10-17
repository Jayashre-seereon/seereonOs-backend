// Golden vectors for app/js.py, computed by Node (the reference runtime):
//   TZ=Asia/Kolkata node backend/tests/golden/gen/js.mjs   -> backend/tests/golden/vectors/js_*.json
// Collation vectors use EVERY distinct string of the demo seed (names, titles, codes, clients, projects, templates…)
// plus edge cases; tests/golden/test_js.py asserts identical results.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, writeJson } from '../../../tools/_bundle.mjs'

const OUT = path.join(ROOT, 'backend/tests/golden/vectors')
const seedFile = path.join(ROOT, 'backend/var/seed.json')
if (!fs.existsSync(seedFile)) throw new Error('run node backend/tools/export_seed.mjs first')
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')).tables

// deterministic PRNG
let a = 20261015
const rnd = () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* ---------------- collation ---------------- */
const strs = new Set()
const walk = (v) => {
  if (typeof v === 'string') {
    if (v.length <= 160 && !v.startsWith('data:')) strs.add(v)
  } else if (Array.isArray(v)) v.forEach(walk)
  else if (v && typeof v === 'object') Object.values(v).forEach(walk)
}
walk(seed)
const EDGE = [
  '', ' ', 'a', 'A', 'b', 'B', 'á', 'Á', 'à', 'ä', 'å', 'æ', 'Æ', 'ß', 'ss', 'SS', 'é', 'e', 'E', 'É', 'ê', 'ë', 'ñ', 'n', 'ø', 'o', 'œ', 'oe', 'Ø',
  'a b', 'ab', 'a-b', 'a_b', 'a.b', 'a,b', 'a/b', 'a\tb', 'a\nb', 'a  b', 'a1', 'a01', 'a10', 'a2', 'a 2', '1', '01', '001', '10', '2', '9', '1.10', '1.9', '1.2.10', '1.2.9',
  'résumé', 'resume', 'Resume', 'RÉSUMÉ', 'café', 'cafe', 'Cafe', 'co-op', 'coop', 'co op', "o'neil", 'oneil', 'O’Neil', '“quoted”', '"quoted"', '…', '...', '₹100', '$100', '100',
  'x×y', 'x·y', 'a–b', 'a—b', 'a→b', '#1', '@me', '&co', '(a)', '[a]', '{a}', 'Zoë', 'Zoe', 'zoe', 'Ångström', 'Angstrom', 'naïve', 'naive', 'Ⅳ', 'ﬁle', 'file', '½', '1/2',
  'Šárka', 'Sarka', 'Łukasz', 'Lukasz', 'İstanbul', 'Istanbul', 'Ærøskøbing', 'é', 'é', 'Mädchen', 'Mädchen', 'Mxdchen', 'Ma', 'MA', 'mA', 'ma',
]
const all = [...new Set([...strs, ...EDGE])]
const col = new Intl.Collator(undefined)
const num = new Intl.Collator(undefined, { numeric: true })
const sorted = [...all].sort((x, y) => x.localeCompare(y) || (x < y ? -1 : x > y ? 1 : 0))
const sortedNum = [...all].sort((x, y) => num.compare(x, y) || (x < y ? -1 : x > y ? 1 : 0))
const adj = (list, c) => list.slice(1).map((s, i) => c(list[i], s))
const pairs = []
for (let i = 0; i < 30000; i++) {
  const x = all[Math.floor(rnd() * all.length)]
  const y = all[Math.floor(rnd() * all.length)]
  pairs.push([x, y, x.localeCompare(y), num.compare(x, y)])
}
// near pairs (same first letters) — the hard cases
for (let i = 0; i + 1 < sorted.length; i += 1) pairs.push([sorted[i + 1], sorted[i], sorted[i + 1].localeCompare(sorted[i]), num.compare(sorted[i + 1], sorted[i])])
writeJson(path.join(OUT, 'js_collation.json'), { icu: process.versions.icu, sorted, sorted_cmp: adj(sorted, (x, y) => col.compare(x, y)), sorted_num: sortedNum, sorted_num_cmp: adj(sortedNum, (x, y) => num.compare(x, y)), pairs }, { pretty: false })

/* ---------------- numbers ---------------- */
const NUMS = [0, -0, 1, -1, 0.5, -0.5, 1.5, 2.5, -1.5, -2.5, 0.49999999999999994, 1.005, 2.675, 1.45, 8.345, 1.255, 0.1 + 0.2, 1 / 3, 2 / 3, 100, 1e21, 1e20, 123456789.125,
  1e-7, 1e-6, 0.000001234, 1.5e-10, 123e-20, 5e-324, 1.7976931348623157e308, 12345.6789, -12345.6789, 99.995, 0.045, 1234567.891, 3.14159, 1e16, 12345678901234567, 2 ** 53, 2 ** 53 + 2,
  NaN, Infinity, -Infinity, 55000.55 * 100, 0.07 * 100, 4.35 * 100, 1.15 * 100, 39.99, 19.999, 7.5, 33.333333333333336, 66.66666666666667, 0.8500000000000001]
const numbers = NUMS.map((n) => ({
  n: Number.isFinite(n) ? n : String(n),
  neg0: Object.is(n, -0),
  str: String(n),
  round: Number.isFinite(Math.round(n)) ? Math.round(n) : String(Math.round(n)),
  fixed: [0, 1, 2, 3].map((d) => n.toFixed(d)),
  json: JSON.stringify(n),
  intl0: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n),
  intl2: new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n),
  intl02: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n),
  intl01: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(n),
  locale: n.toLocaleString('en-IN'),
}))
const STRS = ['', ' ', '12', ' 12 ', '12px', '1e3', '1e', '.5', '5.', '0x1A', '0b11', '0o7', '-0', '+5', 'Infinity', '-Infinity', 'infinity', 'abc', '1,000', '1_000', '\t\n42 ', '3.14.15', '00012', '-12.5e-1', '  -.5  ', 'NaN', '٣', '1 2']
const conv = STRS.map((s) => ({ s, number: String(Number(s)), int: String(parseInt(s)), int16: String(parseInt(s, 16)), float: String(parseFloat(s)) }))
const other = [null, true, false, [], [5], [1, 2], {}, undefined].map((v) => ({ v: v === undefined ? '$undef' : v, number: String(Number(v)), str: String(v) }))
writeJson(path.join(OUT, 'js_numbers.json'), { numbers, conv, other })

/* ---------------- dates ---------------- */
const OPTS = [
  { day: 'numeric', month: 'long', year: 'numeric' }, { month: 'short', year: '2-digit' }, { day: 'numeric', month: 'short' }, { month: 'short', year: 'numeric' }, { month: 'short' },
  { month: 'long', year: 'numeric' }, { day: 'numeric', month: 'short', year: 'numeric' }, { weekday: 'short', day: 'numeric' }, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  { day: 'numeric' }, {},
]
const dates = []
for (let i = 0; i < 400; i += 3) {
  const d = new Date(2025, 11, 1 + i)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  dates.push({ iso, out: OPTS.map((o) => d.toLocaleDateString('en-IN', o)) })
}
const stamps = []
for (let i = 0; i < 300; i++) {
  const ms = Date.UTC(2026, 0, 1) + Math.floor(rnd() * 365 * 86400) * 1000
  const iso = new Date(ms).toISOString()
  stamps.push({ iso, out: new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }), parse: Date.parse(iso) })
}
const parses = ['2026-09-05', '2026-09-05T10:00:00Z', '2026-09-05T10:00:00.123Z', '2026-09-05T10:00:00', '2026-09-05T10:00', '2026-02-30', '2026-13-01', 'x', '2026-09-05T10:00:00+05:30', '2026-09-05T10:00:00.5Z'].map((s) => ({ s, ms: String(Date.parse(s)) }))
writeJson(path.join(OUT, 'js_dates.json'), { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, opts: OPTS, dates, stamps, parses })

/* ---------------- strings / sort / misc ---------------- */
const sortDefault = [[10, 9, 1, 100, 2], ['b', 'a', 'B', 'A', 'é', 'e', '10', '9'], [3, 'a', null, true, 25, 1]].map((xs) => ({ in: xs, out: [...xs].sort() }))
const splits = [['a,b,,c', ',', undefined], ['a,b,c', ',', 2], ['abc', '', undefined], ['', ',', undefined], ['a', 'a', undefined]].map(([s, sep, lim]) => ({ s, sep, lim: lim ?? null, out: s.split(sep, lim) }))
const uri = ['a b', 'é', 'x/y?z=1&q', "!*'()~-_.", '₹', '😀'].map((s) => ({ s, enc: encodeURIComponent(s) }))
const trims = ['  a  ', ' a ', '﻿a\t', '​a​'].map((s) => ({ s, out: s.trim() }))
const mods = [[7, 3], [-7, 3], [7, -3], [-7, -3], [5.5, 2], [-5.5, 2], [0, 5], [5, 0]].map(([x, y]) => ({ x, y, out: String(x % y) }))
const pads = [['5', 3, '0'], ['12345', 3, '0'], ['ab', 6, 'xy']].map(([s, w, f]) => ({ s, w, f, start: s.padStart(w, f), end: s.padEnd(w, f) }))
writeJson(path.join(OUT, 'js_strings.json'), { sortDefault, splits, uri, trims, mods, pads, lens: ['abc', '😀', 'a😀b', 'é'].map((s) => ({ s, n: s.length })) })
console.log(`js vectors: ${all.length} strings, ${pairs.length} pairs, ${numbers.length} numbers, ${dates.length} dates, ${stamps.length} stamps`)
