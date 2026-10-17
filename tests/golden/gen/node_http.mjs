// Records the HTTP-level contract of the running Node reference (headers, error envelopes of framework-level
// failures) for tests/integration/test_http.py:
//   API_URL=http://localhost:8190 node backend/tests/golden/gen/node_http.mjs   (reference started with DEMO_MODE)
import path from 'node:path'
import { ROOT, writeJson } from '../../../tools/_bundle.mjs'

const API = process.env.API_URL ?? 'http://localhost:8190'
const VOLATILE = new Set(['date', 'x-request-id', 'content-length', 'etag', 'last-modified', 'keep-alive', 'connection', 'ratelimit-remaining', 'ratelimit-reset', 'transfer-encoding'])
const cases = [
  ['GET', '/api/v1/me', {}, undefined],
  ['GET', '/', {}, undefined],
  ['GET', '/some/app/route', {}, undefined],
  ['GET', '/assets/missing-chunk.js', {}, undefined],
  ['GET', '/favicon.ico', {}, undefined],
  ['POST', '/some/app/route', {}, undefined],
  ['GET', '/healthz', {}, undefined],
  ['GET', '/readyz', {}, undefined],
  ['GET', '/api/v1', {}, undefined],
  ['GET', '/api/v1/', {}, undefined],
  ['GET', '/api/nope', {}, undefined],
  ['GET', '/api/v1/no/such/route', {}, undefined],
  ['OPTIONS', '/api/v1/me', {}, undefined],
  ['HEAD', '/api/v1/me', {}, undefined],
  ['GET', '/api/v1/invites/%E0%A4%A', {}, undefined],
  ['POST', '/api/v1/auth/login', { 'content-type': 'application/json' }, '{bad'],
  ['POST', '/api/v1/auth/login', { 'content-type': 'application/x-www-form-urlencoded' }, 'a=b'],
  ['POST', '/api/v1/auth/login', {}, '{"a":1}'],
  ['DELETE', '/api/v1/sessions/x', { 'content-type': 'application/json' }, '{bad'],
  ['GET', '/api/v1/me', { 'content-type': 'application/json' }, undefined],
  ['POST', '/api/v1/notifications/read-all', { 'content-type': 'application/json' }, JSON.stringify({ a: 'x y'.repeat(400000) })],
  ['POST', '/api/v1/tasks', { 'content-type': 'application/json' }, JSON.stringify({ a: 'x y'.repeat(400000) })],
]
const out = []
for (const [method, p, headers, body] of cases) {
  const r = await fetch(API + p, { method, headers, body, redirect: 'manual' })
  const h = {}
  for (const [k, v] of r.headers) if (!VOLATILE.has(k)) h[k] = v
  let text = method === 'HEAD' ? '' : await r.text()
  text = text.replace(/"request_id":"[^"]+"/, '"request_id":"<rid>"')
  out.push({ method, path: p, headers, body: body === undefined ? null : body.length > 1000 ? { repeat: body.length } : body, status: r.status, resHeaders: h, resBody: text.startsWith('<!doctype') ? '<html>' : text })
}
writeJson(path.join(ROOT, 'backend/tests/golden/vectors/node_http.json'), out)
console.log(`node http vectors: ${out.length} cases`)
