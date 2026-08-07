// Post-build fixup: `tsc` preserves the `#!/usr/bin/env node` shebang text in
// packages/cli/dist/index.js, but it doesn't set the executable bit. npm/pnpm
// chmod +x bin entries themselves at *install* time, but a raw `node
// dist/index.js` (or a smoke test that runs the file before it's ever gone
// through a package-manager install step) needs the bit set here too.
import { chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.resolve(here, '..', 'packages', 'cli', 'dist', 'index.js')

await chmod(bin, 0o755)
console.log(`build-post: chmod +x ${path.relative(process.cwd(), bin)}`)
