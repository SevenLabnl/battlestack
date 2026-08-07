import 'dotenv/config'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../client'

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.error(
        '[seed] refusing to run with NODE_ENV=production. ' +
            'Set SEED_ALLOW_PRODUCTION=true to override (think twice).',
    )
    process.exit(1)
}

const dir = path.dirname(fileURLToPath(import.meta.url))
const files = (await readdir(dir))
    .filter((f) => /^\d+[\w-]*\.ts$/.test(f) && f !== 'runner.ts')
    .sort()

for (const file of files) {
    const id = file.replace(/\.ts$/, '')
    console.log(`▶  ${id}`)
    const mod = (await import('./' + file)) as {
        default: (db: typeof import('../client').db) => Promise<void>
    }
    await mod.default(db)
}

process.exit(0)
