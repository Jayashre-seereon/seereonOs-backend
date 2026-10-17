// Values sealed by the Node reference's secret box (frozen copy: backend/tools/ref/secretBox.ts) with known keys, for
// tests/golden/test_secret_box.py (the Python box must open them; and Node must open Python's — checked live by the test).
//   node backend/tests/golden/gen/secret_box.mjs
import path from 'node:path'
import { ROOT, importTs, writeJson } from '../../../tools/_bundle.mjs'

const { createSecretBox, deriveKey } = await importTs(null, { name: 'sb', contents: `export { createSecretBox, deriveKey } from './ref/secretBox'` })
const K1 = 'key-one-0123456789012345678901234567'
const K2 = 'key-two-0123456789012345678901234567'
const a = createSecretBox(K1)
const plains = ['JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '', 'é😀 secret']
writeJson(path.join(ROOT, 'backend/tests/golden/vectors/secret_box.json'), {
  keys: [K1, K2],
  kids: [deriveKey(K1).kid, deriveKey(K2).kid],
  sealed: plains.map((p) => ({ plain: p, sealed: a.seal(p) })),
})
console.log('secret box vectors written')
