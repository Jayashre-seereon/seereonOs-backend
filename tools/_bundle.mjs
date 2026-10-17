// Shared helper of the Node dev tools in backend/tools: bundles a TypeScript entry of the repo (alias @ -> frontend/src) with
// the repo's esbuild into a temporary ESM file and imports it. The TS sources stay the single source of truth for the
// demo seed, the shared catalogues and the golden vectors; Python never parses TypeScript.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ROOT = path.resolve(import.meta.dirname, '../..')
const { build } = createRequire(path.join(ROOT, 'frontend/package.json'))('esbuild')

// browser globals touched at import time by shared code (storage helpers)
globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }

/** bundle `entry` (absolute path or a TS source string with `contents`) and import it */
export async function importTs(entry, { contents, name = 'entry' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seereon-tools-'))
  const outfile = path.join(dir, name + '.mjs')
  await build({
    ...(contents ? { stdin: { contents, resolveDir: path.join(ROOT, 'backend/tools'), loader: 'ts', sourcefile: name + '.ts' } } : { entryPoints: [entry] }),
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'warning',
    alias: { '@': path.join(ROOT, 'frontend/src') },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
    nodePaths: [path.join(ROOT, 'frontend/node_modules')],
    define: { 'import.meta.env': JSON.stringify({ VITE_API_MODE: 'mock', MODE: 'test', DEV: false, PROD: true }) },
    external: ['pg', 'pg-native'],
  })
  try {
    return await import(pathToFileURL(outfile).href)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** JSON with stable formatting (2-space indent, trailing newline) */
export function writeJson(file, value, { pretty = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, (pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value)) + '\n')
}
