// Derives the collation weights app/js.py needs to reproduce String.prototype.localeCompare / Intl.Collator (ICU root
// collation, the default locale of the Node reference) for Latin text, from Node itself:
//   node backend/tools/gen_collation.mjs           -> backend/app/js_collation.json
// For every character of the covered blocks that does not decompose (NFD) and does not expand, it sorts the characters
// with the default collator and assigns ranks: primary (sensitivity "base"), secondary within the primary ("accent"),
// tertiary within the secondary ("variant"). Combining marks get a secondary rank (primary 0). Characters that expand
// (ß -> ss, … -> ..., ligatures, compatibility forms) are stored as their expansion plus a tertiary flag.
// Numeric mode (numeric: true) is derived the same way; digit runs are compared by value (see js.py).
// The golden vectors (tests/golden/gen/collation.mjs) prove the result on every string of the demo seed.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_bundle.mjs'

const RANGES = [
  [0x09, 0x0d], [0x20, 0x7e], [0xa0, 0x24f], [0x250, 0x2af], [0x2b0, 0x2ff], [0x300, 0x36f], [0x370, 0x3ff], [0x1e00, 0x1eff],
  [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2100, 0x214f], [0x2150, 0x218f], [0x2190, 0x21ff], [0x2200, 0x22ff], [0x2300, 0x23ff],
  [0x2460, 0x24ff], [0x2500, 0x257f], [0x25a0, 0x25ff], [0x2600, 0x26ff], [0x2700, 0x27bf], [0xfb00, 0xfb06], [0xfe50, 0xfe6f], [0xff01, 0xff5e],
]
const col = new Intl.Collator(undefined)
const base = new Intl.Collator(undefined, { sensitivity: 'base' })
const accent = new Intl.Collator(undefined, { sensitivity: 'accent' })
const MANUAL = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ẞ': 'SS', 'ĸ': 'q', 'þ': 'th', 'Þ': 'TH' }

const chars = []
for (const [a, b] of RANGES) for (let c = a; c <= b; c++) {
  const s = String.fromCodePoint(c)
  if (/\p{Cn}|\p{Cs}|\p{Co}/u.test(s)) continue
  chars.push(s)
}
const isMark = (s) => /\p{M}/u.test(s)
const expansions = {}
const simple = []
const marks = []
for (const s of chars) {
  if (s.normalize('NFD') !== s) continue // handled through NFD in js.py
  if (isMark(s)) {
    marks.push(s)
    continue
  }
  const cands = [MANUAL[s], s.normalize('NFKD')].filter((x) => x && x !== s && [...x].length > 1)
  const exp = cands.find((x) => base.compare(s, x) === 0)
  if (exp) {
    expansions[s] = { to: exp.normalize('NFD'), cmp: col.compare(s, exp), cmp_upper: col.compare(s, exp.toUpperCase()) } // tertiary relation to the expansion (and to its upper case)
    continue
  }
  simple.push(s)
}
// single elements: rank by the full order
simple.sort((a, b) => col.compare(a, b) || (a < b ? -1 : 1))
const weights = {}
let p = 0, s2 = 0, t = 0
for (let i = 0; i < simple.length; i++) {
  const c = simple[i]
  if (i === 0) p = s2 = t = 1
  else {
    const prev = simple[i - 1]
    if (base.compare(prev, c) !== 0) (p++, (s2 = 1), (t = 1))
    else if (accent.compare(prev, c) !== 0) (s2++, (t = 1))
    else if (col.compare(prev, c) !== 0) t++
  }
  // characters ignorable at primary level (compare equal to '' at base strength) get primary 0
  const ignorable = base.compare(c, '') === 0
  weights[c] = ignorable ? [0, s2, t] : [p, s2, t]
}
// combining marks: secondary rank among marks (order of "a"+mark at accent strength); tertiary from variant order
const markOrder = marks.map((m) => ['a' + m, m]).sort((x, y) => col.compare(x[0], y[0]) || (x[1] < y[1] ? -1 : 1))
let ms = 1, mt = 1
const markW = {}
for (let i = 0; i < markOrder.length; i++) {
  const [s, m] = markOrder[i]
  if (i > 0) {
    const prev = markOrder[i - 1][0]
    if (accent.compare(prev, s) !== 0) (ms++, (mt = 1))
    else if (col.compare(prev, s) !== 0) mt++
  }
  markW[m] = [0, accent.compare('a', s) === 0 ? 0 : ms + 1, mt] // +1: above the common secondary of base letters
}
const out = {
  icu: process.versions.icu,
  unicode: process.versions.unicode,
  locale: col.resolvedOptions().locale,
  weights,
  marks: markW,
  expansions,
  max_primary: p,
}
const file = path.join(ROOT, 'backend/app/js_collation.json')
fs.writeFileSync(file, JSON.stringify(out) + '\n')
console.log(`collation: ${Object.keys(weights).length} chars, ${Object.keys(markW).length} marks, ${Object.keys(expansions).length} expansions, ${p} primaries (ICU ${process.versions.icu}) -> ${path.relative(process.cwd(), file)}`)
