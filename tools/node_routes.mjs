// Prints the reference route registry (src/mock routes as registered by registerAll, in match order) as JSON:
// [{method, pattern, module, public, superAdmin, allowViewAsWrite}] — used by tools/port_status.py.
//   node backend/tools/node_routes.mjs > routes.json
import { importTs } from './_bundle.mjs'

const m = await importTs(null, {
  name: 'routes',
  contents: `import { router, routeRegistry } from '@/mock/server'
import { registerAll } from '@/mock/routes'
registerAll(router)
export const routes = routeRegistry().map((r) => ({ method: r.method, pattern: r.pattern, module: r.module, public: !!r.opts.public, superAdmin: !!r.opts.superAdmin, allowViewAsWrite: !!r.opts.allowViewAsWrite }))`,
})
process.stdout.write(JSON.stringify(m.routes))
