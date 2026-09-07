import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PNPM_PIN } from '../src/constants/package-manager.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('PNPM_PIN', () => {
    it('matches the root packageManager field', async () => {
        const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
        expect(PNPM_PIN).toBe(pkg.packageManager)
    })
})
