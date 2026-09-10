import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PNPM_MIN, PNPM_PIN, PNPM_PIN_VERSION } from '../src/constants/package-manager.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A single sortable number for a `major.minor.patch` string. */
function rank(version: string): number {
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
    return major * 1e6 + minor * 1e3 + patch
}

describe('PNPM_PIN', () => {
    it('matches the root packageManager field', async () => {
        const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
        expect(PNPM_PIN).toBe(pkg.packageManager)
    })

    it('exposes a prefix-free version matching the pinned spec', () => {
        expect(PNPM_PIN).toBe(`pnpm@${PNPM_PIN_VERSION}`)
    })

    it('sits at or above PNPM_MIN, keeping the warn branch reachable', () => {
        expect(rank(PNPM_PIN_VERSION)).toBeGreaterThanOrEqual(rank(PNPM_MIN))
    })
})
