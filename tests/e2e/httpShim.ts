// Drop-in replacement of '@/mock/server' for the existing regression scripts (smokeB/smokeC/t2/w3/w7b … written
// against the in-process mock): handle() goes over HTTP to the real API, and getDb() returns a read-only snapshot of
// the whole database in the mock's row shape, re-read after every call. The snapshot comes from the Python mapping
// (backend/tests/e2e/dbdump.py, the same row mapping the API uses), via one long-lived `python -m tests.e2e.dbdump
// --serve` child process. Bundled by build-http.mjs.
import { execFileSync, spawn } from 'node:child_process'
import { ApiError } from '@/api/http'

const API = process.env.API_URL ?? 'http://localhost:8000'
declare const __BACKEND_DIR__: string
const BACKEND = process.env.BACKEND_DIR ?? __BACKEND_DIR__
const PY = process.env.PYTHON ?? 'python3'
let snap: Record<string, unknown[]> = {}

// the long-lived dumper: one stdin line -> one JSON line
const child = spawn(PY, ['-m', 'tests.e2e.dbdump', '--serve'], { cwd: BACKEND, stdio: ['pipe', 'pipe', 'inherit'], env: process.env })
// the child must not keep the script alive once it is done: its handles are referenced only while a dump is pending
type Ref = { ref?: () => void; unref?: () => void }
const handles = [child, child.stdout, child.stdin] as unknown as Ref[]
handles.forEach((h) => h.unref?.())
let buf = ''
const waiting: ((s: string) => void)[] = []
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk: string) => {
  buf += chunk
  let i: number
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    waiting.shift()?.(line)
  }
})
child.on('exit', () => {
  while (waiting.length) waiting.shift()?.('') // a dead dumper fails the pending refresh (JSON.parse) instead of hanging
})
async function refresh() {
  handles.forEach((h) => h.ref?.())
  try {
    const line = await new Promise<string>((resolve) => {
      waiting.push(resolve)
      child.stdin.write('\n')
    })
    snap = JSON.parse(line)
  } finally {
    handles.forEach((h) => h.unref?.())
  }
}
// reset the API's data and take the first snapshot synchronously (scripts read getDb() before their first call)
{
  execFileSync(process.execPath, ['-e', `fetch(${JSON.stringify(API)} + '/api/v1/demo/reset', { method: 'POST' }).then((r) => { if (!r.ok) { console.error('demo reset failed', r.status); process.exit(3) } })`], { stdio: 'inherit' })
  snap = JSON.parse(execFileSync(PY, ['-m', 'tests.e2e.dbdump'], { cwd: BACKEND, env: process.env, maxBuffer: 512 * 1024 * 1024 }).toString())
}
const view = new Proxy({} as Record<string, unknown[]>, { get: (_t, k: string) => snap[k] ?? [], ownKeys: () => Reflect.ownKeys(snap), getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true, value: snap[k as string] }) })

export async function handle(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown }, headers: Record<string, string>) {
  const q = opts.query ? Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '') : []
  const qs = q.length ? '?' + new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString() : ''
  const res = await fetch(API + '/api/v1' + path + qs, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const j = (await res.json()) as { data?: unknown; warnings?: { code: string; message: string }[]; error?: { code: string; message: string; field?: string } }
  await refresh()
  if (!res.ok) throw new ApiError(res.status, j.error?.code ?? 'HTTP_' + res.status, j.error?.message ?? '', j.error?.field)
  return { data: j.data, warnings: j.warnings ?? [] }
}
export function getDb(): Record<string, unknown[]> {
  return view
}
/** loads a fresh snapshot (scripts that read getDb() before any call) */
export async function initShim() {
  await refresh()
}
export const db = getDb
export function registerSeed() {}
export async function ensureRoutes() {}
