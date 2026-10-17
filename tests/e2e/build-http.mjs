// Bundles an in-process regression script (written against '@/mock/server') with '@/mock/server' replaced by the HTTP
// shim (httpShim.ts: calls go to the API over HTTP, getDb() reads PostgreSQL through backend/tests/e2e/dbdump.py).
//   node backend/tests/e2e/build-http.mjs <in.ts> <out.cjs>
//   API_URL=http://localhost:8000 DATABASE_URL=postgres://seereon_owner:…/seereonos node <out.cjs>
import { createRequire } from 'node:module'
import path from 'node:path'
const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const { build } = createRequire(path.join(root, 'frontend/package.json'))('esbuild')
await build({
  entryPoints: [process.argv[2]], outfile: process.argv[3], bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
  alias: { '@': path.join(root, 'frontend/src') }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, nodePaths: [path.join(root, 'frontend/node_modules')],
  define: { 'import.meta.env': JSON.stringify({ VITE_API_MODE: 'mock', MODE: 'test', DEV: false, PROD: true }), __BACKEND_DIR__: JSON.stringify(path.join(root, 'backend')) },
  plugins: [{ name: 'shim', setup(b) { b.onResolve({ filter: /^@\/mock\/server$|\/mock\/server$/ }, (a) => (a.importer.startsWith(here) ? undefined : { path: path.join(here, 'httpShim.ts') })) } }],
})
