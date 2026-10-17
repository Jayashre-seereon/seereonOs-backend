// Minimal PostgreSQL access for the HTTP e2e tools without a Node driver: runs `psql` (owner role, DATABASE_URL).
//   const db = pgLite(url); const { rows } = await db.query('SELECT ... WHERE id = $1', [id]); await db.end()
// $n parameters are inlined as SQL literals (test tooling only: the values are the scripts' own). SELECT / WITH queries
// return their rows as JSON objects (json_agg: numbers, booleans, json/jsonb as values, dates/timestamps as strings);
// other statements return no rows.
import { execFileSync } from 'node:child_process'

const literal = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}

export function sqlSync(url, q, args = []) {
  const text = q.replace(/\$(\d+)/g, (_, i) => literal(args[Number(i) - 1]))
  const select = /^\s*(select|with)\b/i.test(text)
  const stmt = select ? `SELECT coalesce(json_agg(t), '[]'::json) FROM (${text}) t` : text
  const out = execFileSync('psql', [url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', stmt], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return select ? JSON.parse(out) : []
}

export function pgLite(url = process.env.DATABASE_URL ?? 'postgres://seereon_owner:seereon_owner@localhost:5432/seereonos') {
  return {
    query: async (q, args = []) => ({ rows: sqlSync(url, q, args) }),
    end: async () => {},
  }
}
