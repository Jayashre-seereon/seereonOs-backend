// Persistence + multi-instance realism against the REAL stack (things the in-browser mock cannot test).
//   node backend/tests/e2e/multi.mjs           (needs: API A on :8000 and API B on :8001, same DB, DEMO_MODE=true;
//                                               backend/tests/e2e/stack.sh starts them; this script restarts them)
// Env: A_URL, B_URL, DATABASE_URL (owner), STACK (path of stack.sh)
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { sqlSync } from './sql.mjs'
import { createHmac } from 'node:crypto'

const A = process.env.A_URL ?? 'http://localhost:8000'
const B = process.env.B_URL ?? 'http://localhost:8001'
const DBURL = process.env.DATABASE_URL ?? 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos'
const STACK = process.env.STACK ?? path.resolve(import.meta.dirname, 'stack.sh')
const PW = 'Seereon@123'
let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  cond ? pass++ : fail++
  console.log(cond ? 'PASS' : 'FAIL', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '')
}
async function call(base, method, p, { token, body, ifMatch } = {}) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = 'Bearer ' + token
  if (ifMatch !== undefined) h['If-Match'] = String(ifMatch)
  const init = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }
  // a restarted server closes pooled keep-alive sockets: retry once on a socket error
  const r = await fetch(base + '/api/v1' + p, init).catch(() => fetch(base + '/api/v1' + p, init))
  const j = await r.json().catch(() => ({}))
  return { status: r.status, data: j.data, error: j.error }
}
const login = async (base, who, pw = PW) => call(base, 'POST', '/auth/login', { body: { email: who.includes('@') ? who : who + '@seereon.co.in', password: pw } })
const tok = async (base, who) => (await login(base, who)).data?.token
const sql = async (q, args = []) => sqlSync(DBURL, q, args)
/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) of a base32 secret */
function totp(secret, t = Date.now()) {
  const A32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = '', out = []
  for (const ch of secret) bits += A32.indexOf(ch).toString(2).padStart(5, '0')
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)))
  const h = createHmac('sha1', Buffer.from(out)).update(msg).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

function restart(port) {
  execFileSync('bash', [STACK, '--no-build', '--no-reset', '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] })
}

async function main() {
  const reset = await fetch(A + '/api/v1/demo/reset', { method: 'POST' })
  ok('demo reset', reset.ok)

  /* 0. static frontend: SPA fallback for app routes, real 404 for missing build assets */
  const spa = await fetch(A + '/projects/p_rcu')
  const miss = await fetch(A + '/assets/index-doesnotexist.js')
  ok('SPA fallback serves index.html for an app route; a missing asset is a 404 (not HTML)', spa.status === 200 && /text\/html/.test(spa.headers.get('content-type') ?? '') && miss.status === 404 && !/text\/html/.test(miss.headers.get('content-type') ?? ''), [spa.status, miss.status, miss.headers.get('content-type')])

  /* 1. sessions are shared: login on A, use on B */
  const sA = await tok(A, 'santosh')
  const me = await call(B, 'GET', '/me', { token: sA })
  ok('token issued by A works on B', me.status === 200 && me.data?.user?.email === 'santosh@seereon.co.in', me.status)
  const stored = await sql('SELECT count(*)::int n FROM sessions WHERE token_hash = encode(sha256($1::bytea), \'hex\')', [sA])
  ok('session stored as SHA-256 hash only', stored[0].n === 1)

  /* 2. write on A, read on B — repeated (cache coherence via tenant_table_versions) */
  let coherent = 0
  // tasks are not maker-checked (a users PATCH becomes a pending change set), so a task title is the probe
  const task = (await call(A, 'GET', '/tasks/t_rcu_3', { token: sA })).data
  let ver = task?.version ?? task?.task?.version
  for (let i = 0; i < 12; i++) {
    const [w, r] = i % 2 ? [A, B] : [B, A]
    const title = 'Budget total report fixes ' + i
    const u = await call(w, 'PATCH', '/tasks/t_rcu_3', { token: sA, body: { title }, ifMatch: ver })
    if (u.status !== 200) { ok('PATCH on ' + (w === A ? 'A' : 'B'), false, u); break }
    ver = u.data.version
    const g = await call(r, 'GET', '/tasks/t_rcu_3', { token: sA })
    const gt = g.data?.task ?? g.data
    if (gt?.title === title && gt?.version === ver) coherent++
    else console.log('   incoherent', i, gt?.title, gt?.version, ver)
  }
  ok('12 alternating writes: the other instance reads each write immediately', coherent === 12, coherent)

  /* 3. If-Match across instances: stale version from B after A wrote */
  const s1 = await call(A, 'PATCH', '/tasks/t_rcu_3', { token: sA, body: { title: 'X1' }, ifMatch: ver })
  const s2 = await call(B, 'PATCH', '/tasks/t_rcu_3', { token: sA, body: { title: 'X2' }, ifMatch: ver })
  ok('optimistic concurrency across instances (second writer gets 409 STALE)', s1.status === 200 && s2.status === 409 && s2.error?.code === 'STALE', [s1.status, s2.status, s2.error?.code])

  /* 4. concurrent writes to one tenant on both instances (advisory lock + read-set check) all land */
  const sB = await tok(B, 'santosh')
  const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 ? A : B, 'PATCH', '/me/prefs', { token: i % 2 ? sA : sB, body: { ['k' + i]: i } })))
  ok('10 parallel writes split over A and B: all 200', parallel.every((r) => r.status === 200), parallel.map((r) => r.status))
  const prefs = (await call(B, 'GET', '/me', { token: sA })).data?.user?.prefs ?? {}
  ok('…and every one of them landed (no lost update)', Array.from({ length: 10 }, (_, i) => prefs['k' + i] === i).every(Boolean), prefs)

  /* 5. out-of-band SQL write is visible on both instances (statement trigger bumps the version) */
  await sql("UPDATE users SET title = 'Set by SQL' WHERE id = 'u_hritesh'")
  const ga = await call(A, 'GET', '/users/u_hritesh', { token: sA })
  const gb = await call(B, 'GET', '/users/u_hritesh', { token: sA })
  ok('out-of-band SQL UPDATE seen by A and B', ga.data?.title === 'Set by SQL' && gb.data?.title === 'Set by SQL', [ga.data?.title, gb.data?.title])

  /* 6. 2FA setup on A, verify on B (pending_tokens table, was process memory) */
  const sP = await tok(A, 'priya')
  const setup = await call(A, 'POST', '/me/2fa/setup', { token: sP })
  ok('2FA setup on A', setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.data?.secret ?? ''), setup.status)
  const now2fa = Date.now()
  const verify = await call(B, 'POST', '/me/2fa/verify', { token: sP, body: { code: totp(setup.data.secret, now2fa) } })
  ok('2FA verify on B (secret pending in DB, not in A memory)', verify.status === 200 && verify.data?.user?.two_factor === true && verify.data?.recovery_codes?.length === 10, [verify.status, verify.error])
  const left = await sql("SELECT count(*)::int n FROM pending_tokens WHERE kind = 'two_factor_setup'")
  ok('2FA pending secret removed after verify', left[0].n === 0, left[0].n)
  const sealed = await sql("SELECT payload->>'secret' s FROM pending_tokens WHERE kind = 'two_factor' AND user_id = 'u_priya'")
  ok('2FA secret sealed at rest (AES-GCM), not the base32 key', sealed.length === 1 && /^v1\.[0-9a-f]{8}:/.test(sealed[0].s) && !sealed[0].s.includes(setup.data.secret), sealed[0]?.s?.slice(0, 12))
  const again = await call(A, 'POST', '/me/2fa/verify', { token: sP, body: { code: '123456' } })
  ok('2FA verify without a setup → 409 TWO_FACTOR_SETUP', again.status === 409 && again.error?.code === 'TWO_FACTOR_SETUP', again.error?.code)
  const ch = await call(A, 'POST', '/auth/login', { body: { email: 'priya@seereon.co.in', password: PW } })
  ok('2FA sign-in on A → mfa_required, no session', ch.status === 200 && ch.data?.mfa_required === true && !ch.data?.token, ch.status)
  const fin = await call(B, 'POST', '/auth/login/mfa', { body: { mfa_token: ch.data?.mfa_token, code: totp(setup.data.secret, now2fa + 30000) } })
  ok('2FA second step on B (challenge in DB) → session', fin.status === 200 && typeof fin.data?.token === 'string', [fin.status, fin.error])
  const dis = await call(A, 'POST', '/me/2fa/disable', { token: sP, body: { password: PW } })
  ok('2FA disable', dis.status === 200 && dis.data?.two_factor === false, dis.status)

  /* 7. WBS import preview on A, commit on B */
  const t = new Date().toISOString().slice(0, 10)
  const add = (d) => new Date(Date.parse(t) + d * 864e5).toISOString().slice(0, 10)
  const csv = ['Milestone,Task,Owner,Estimated hours,Start,End,Complexity,Depends on,Milestone billing', `B3 import phase,Import task one,Hritesh Panda,8,${add(1)},${add(3)},Low,,`, `B3 import phase,Import task two,Hritesh Panda,6,${add(4)},${add(6)},Medium,,`].join('\n')
  const prev = await call(A, 'POST', '/projects/p_rcu/import', { token: sA, body: { text: csv } })
  ok('WBS preview on A', prev.status === 200 && prev.data?.token && prev.data?.error_count === 0, [prev.status, prev.error, prev.data?.rows?.map((r) => r.errors)])
  const commit = await call(B, 'POST', '/projects/p_rcu/import?mode=commit', { token: sA, body: { token: prev.data?.token } })
  ok('WBS commit on B (preview pending in DB, not in A memory)', commit.status === 200 && commit.data?.tasks === 2, [commit.status, commit.error, commit.data])
  const twice = await call(A, 'POST', '/projects/p_rcu/import?mode=commit', { token: sA, body: { token: prev.data?.token } })
  ok('WBS token is single-use (409 WBS_INVALID)', twice.status === 409 && twice.error?.code === 'WBS_INVALID', twice.error?.code)
  const other = await call(A, 'POST', '/projects/p_rcu/import', { token: sA, body: { text: csv } })
  const sS = await tok(A, 'subhankar')
  const foreign = await call(B, 'POST', '/projects/p_rcu/import?mode=commit', { token: sS, body: { token: other.data?.token } })
  ok("another user cannot commit someone else's preview", foreign.status === 409 || foreign.status === 403, [foreign.status, foreign.error?.code])
  await sql("UPDATE pending_tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [other.data?.token])
  const expired = await call(B, 'POST', '/projects/p_rcu/import?mode=commit', { token: sA, body: { token: other.data?.token } })
  ok('expired WBS preview → 409 WBS_INVALID', expired.status === 409 && expired.error?.code === 'WBS_INVALID', expired.error?.code)
  const wbsA = JSON.stringify((await call(A, 'GET', '/projects/p_rcu', { token: sA })).data ?? '')
  ok('imported tasks visible on A', wbsA.includes('Import task one') && wbsA.includes('Import task two'))

  /* 8. logout invalidates the token on every instance */
  const sH = await tok(A, 'hritesh')
  ok('hritesh token works on B', (await call(B, 'GET', '/me', { token: sH })).status === 200)
  const lo = await call(A, 'POST', '/auth/logout', { token: sH })
  const after = await call(B, 'GET', '/me', { token: sH })
  ok('after logout on A the old token is 401 on B', lo.status === 200 && after.status === 401, [lo.status, after.status, after.error?.code])

  /* 9. session expiry: idle (12 h) and absolute (30 d) */
  const sIdle = await tok(A, 'baishali')
  await sql("UPDATE sessions SET last_seen_at = now() - interval '13 hours' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [sIdle])
  ok('idle session (13 h) → 401', (await call(B, 'GET', '/me', { token: sIdle })).status === 401)
  const sAbs = await tok(A, 'baishali')
  await sql("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [sAbs])
  ok('absolute expiry passed → 401', (await call(A, 'GET', '/me', { token: sAbs })).status === 401)
  const sFresh = await tok(A, 'baishali')
  ok('fresh session still fine', (await call(B, 'GET', '/me', { token: sFresh })).status === 200)

  /* 10. password change revokes the other sessions (A and B) */
  const p1 = await tok(A, 'subham'), p2 = await tok(B, 'subham')
  const chg = await call(A, 'POST', '/me/password', { token: p1, body: { current: PW, next: 'Seereon@456' } })
  const o2 = await call(B, 'GET', '/me', { token: p2 })
  const o1 = await call(B, 'GET', '/me', { token: p1 })
  ok('password change: other session revoked, current kept', chg.status === 200 && o2.status === 401 && o1.status === 200, [chg.status, chg.error, o2.status, o1.status])

  /* 11. deactivation: the person's tokens stop working */
  const sh = await tok(A, 'hritesh')
  await sql("UPDATE users SET status = 'deactivated' WHERE id = 'u_hritesh'")
  const shAfter = await call(A, 'GET', '/me', { token: sh })
  ok('deactivated user (out-of-band SQL): token → 401 on the next request', shAfter.status === 401, shAfter.status)
  await sql("UPDATE users SET status = 'active' WHERE id = 'u_hritesh'")

  /* 12. login lockout persists across restart of both instances */
  const wrong = []
  for (let i = 0; i < 5; i++) wrong.push((await login(i % 2 ? A : B, 'priya', 'nope-' + i)).status)
  const locked = await login(A, 'priya')
  ok('5 wrong passwords (split over A and B) → correct password locked (429 LOGIN_LOCKED)', locked.status === 429 && locked.error?.code === 'LOGIN_LOCKED', [wrong, locked.status, locked.error?.code])

  /* 13. data + lockout survive restart */
  const marker = 'Survives restart ' + Date.now()
  const wr = await call(A, 'PATCH', '/tasks/t_rcu_2', { token: sA, body: { title: marker } })
  ok('write before restart', wr.status === 200, wr.status)
  restart(new URL(A).port); restart(new URL(B).port)
  const after1 = await call(B, 'GET', '/tasks/t_rcu_2', { token: sA })
  const after2 = await call(A, 'GET', '/tasks/t_rcu_2', { token: sA })
  const tt = (x) => (x.data?.task ?? x.data)?.title
  ok('after restarting both APIs: session still valid and data persisted', after1.status === 200 && tt(after1) === marker && tt(after2) === marker, [after1.status, tt(after1)])
  const stillLocked = await login(B, 'priya')
  ok('lockout persists across restart', stillLocked.status === 429, stillLocked.status)

  /* 13b. whole-tenant export on a freshly started process (route walks ~80 tables; learnt one per restart) */
  const ex = await call(B, 'POST', '/exports', { token: sA })
  const dl = ex.status === 200 ? await call(A, 'GET', `/exports/${ex.data.id}/download`, { token: sA }) : { status: 0 }
  ok('data export + download on fresh processes (was 500 "Too many table restarts")', ex.status === 200 && dl.status === 200 && Object.keys(dl.data?.tables ?? {}).length > 70, [ex.status, dl.status, Object.keys(dl.data?.tables ?? {}).length])
  ok('export never contains pending_tokens / credentials / sessions', !['pending_tokens', 'passwords', 'sessions', 'login_attempts', 'reset_tokens'].some((t) => t in (dl.data?.tables ?? {})))

  /* 14. demo reset on A while B is under read load: atomic (no 5xx) and B's cache does not serve pre-reset rows */
  await fetch(A + '/api/v1/demo/reset', { method: 'POST' })
  const sB2 = await tok(B, 'santosh')
  const changed = await call(B, 'PATCH', '/tasks/t_rcu_1', { token: sB2, body: { title: 'Changed before reset' } })
  ok('B wrote (and cached) a change', changed.status === 200 && (await call(B, 'GET', '/tasks/t_rcu_1', { token: sB2 })).data?.task?.title === 'Changed before reset')
  let stop = false
  const statuses = []
  const load = (async () => {
    while (!stop) statuses.push((await call(B, 'GET', '/projects', { token: sB2 })).status)
  })()
  const r1 = await fetch(A + '/api/v1/demo/reset', { method: 'POST' })
  await new Promise((r) => setTimeout(r, 300))
  stop = true
  await load
  ok('reset during load: reset 200, no 5xx on B (only 200 before / 401 after: sessions are part of the demo data)', r1.ok && statuses.every((s) => s === 200 || s === 401) && statuses.includes(401), { n: statuses.length, codes: [...new Set(statuses)] })
  const sB3 = await tok(B, 'santosh')
  const fresh = await call(B, 'GET', '/tasks/t_rcu_1', { token: sB3 })
  ok('after reset on A, B serves the seed row (versions only increase → cache invalidated)', fresh.data?.task?.title === 'Petty cash finance dashboard (PCFIN)', fresh.data?.task?.title)

  /* 15. burst of first page loads right after a reset (GETs that run lazy sweeps and write): never 409 / 5xx */
  await fetch(A + '/api/v1/demo/reset', { method: 'POST' })
  const who = ['santosh', 'debasish', 'subhankar', 'priya', 'baishali', 'subham', 'hritesh']
  const toks = await Promise.all(who.map((w, i) => tok(i % 2 ? A : B, w)))
  const burst = await Promise.all(toks.flatMap((t, i) => ['/tasks', '/projects', '/notifications', '/inbox/summary', '/dashboards/ceo'].map((p, j) => call((i + j) % 2 ? A : B, 'GET', p, { token: t }))))
  const codes = {}
  for (const r of burst) codes[r.status] = (codes[r.status] ?? 0) + 1
  ok('35 concurrent first GETs over A and B after a reset: no 409 CONFLICT_RETRY, no 5xx', !burst.some((r) => r.status === 409 || r.status >= 500), codes)

  await fetch(A + '/api/v1/demo/reset', { method: 'POST' })
  console.log(`\n${fail ? 'FAILED' : 'ALL PASSED'} (${pass} passed, ${fail} failed)`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})
