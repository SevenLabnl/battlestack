import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Advisory keys share one namespace per database, so two unrelated call sites on the same number
 * block each other. The two standalone tools cannot import the registry and repeat its values.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const templates = path.resolve(here, '..', 'templates')
const dbTemplate = path.join(templates, 'database')

const REGISTRY = path.join(dbTemplate, 'server/utils/advisory-locks.ts')
const BOOT_PLUGIN = path.join(dbTemplate, 'server/plugins/00-db-migrate-on-boot.ts')
const STANDALONE = path.join(dbTemplate, 'tools/migrate.mjs')
const SEEDER = path.join(dbTemplate, 'tools/seed.mjs')

/** Every `NAME: <number>` entry in the registry object, separators stripped. */
async function readRegistry(): Promise<Map<string, string>> {
    const src = await readFile(REGISTRY, 'utf8')
    const entries = new Map<string, string>()
    for (const m of src.matchAll(/^\s{4}([A-Z_]+):\s*([0-9_]+),?$/gm)) {
        entries.set(m[1]!, m[2]!.replaceAll('_', ''))
    }
    if (entries.size === 0) {
        throw new Error(
            `no lock keys parsed from ${path.relative(templates, REGISTRY)}. If the registry `
            + 'shape changed, update this test; do not delete it. It is the only thing keeping '
            + 'two unrelated features off the same advisory key.',
        )
    }
    return entries
}

/** A `const <constName> = <number>` literal, separators stripped. */
async function literalKey(file: string, constName: string): Promise<string> {
    const src = await readFile(file, 'utf8')
    const m = new RegExp(`const ${constName}\\s*=\\s*([0-9_]+)`).exec(src)
    if (!m) {
        throw new Error(
            `could not find a numeric ${constName} in ${path.relative(templates, file)}. If the `
            + 'constant was renamed, update this test; do not delete it. It is the only thing '
            + 'keeping this standalone tool on the same lock as the rest of the project.',
        )
    }
    return m[1]!.replaceAll('_', '')
}

async function walk(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...await walk(full))
        else if (/\.(ts|mjs)$/.test(entry.name)) out.push(full)
    }
    return out
}

describe('advisory-lock keys', () => {
    it('every key in the registry is distinct', async () => {
        const entries = await readRegistry()
        const byValue = new Map<string, string[]>()
        for (const [name, value] of entries) {
            byValue.set(value, [...(byValue.get(value) ?? []), name])
        }
        const collisions = [...byValue.entries()]
            .filter(([, names]) => names.length > 1)
            .map(([value, names]) => `${names.join(' and ')} both use ${value}`)
        expect(collisions).toEqual([])
    })

    it('every key is a valid Postgres bigint advisory-lock key', async () => {
        // `pg_advisory_lock(bigint)`: an overflowed key fails at runtime, on deploy, in
        // the one code path nobody exercises locally.
        for (const [name, value] of await readRegistry()) {
            const key = BigInt(value)
            expect(key, name).toBeGreaterThan(0n)
            expect(key, name).toBeLessThanOrEqual(2n ** 63n - 1n)
        }
    })

    it('the standalone migrator matches the registry, so it serialises with the boot plugin', async () => {
        const registry = await readRegistry()
        expect(await literalKey(STANDALONE, 'MIGRATE_ADVISORY_LOCK_KEY')).toBe(registry.get('MIGRATE'))
    })

    it('the seeder matches the registry', async () => {
        const registry = await readRegistry()
        expect(await literalKey(SEEDER, 'SEED_ADVISORY_LOCK_KEY')).toBe(registry.get('SEED'))
    })

    it('the boot plugin takes its key from the registry rather than a literal', async () => {
        const src = await readFile(BOOT_PLUGIN, 'utf8')
        expect(src).toMatch(/MIGRATE_ADVISORY_LOCK_KEY\s*=\s*ADVISORY_LOCK\.MIGRATE/)
    })

    it('no template outside the two standalone tools hardcodes a lock key', async () => {
        const allowed = new Set([STANDALONE, SEEDER, REGISTRY])
        const offenders: string[] = []
        for (const file of await walk(templates)) {
            if (allowed.has(file)) continue
            const src = await readFile(file, 'utf8')
            if (!/pg_advisory/.test(src)) continue
            const inlineLiteral = /pg_advisory\w*\(\s*[0-9]/.test(src)
            const numericConst = /const\s+\w*LOCK\w*\s*=\s*[0-9]/.test(src)
            if (inlineLiteral || numericConst) offenders.push(path.relative(templates, file))
        }
        expect(offenders).toEqual([])
    })
})

describe('cache-bus namespaces', () => {
    it('no two templates claim the same cache namespace', async () => {
        // `createTtlCache` overwrites a repeat namespace (dev HMR), so a collision is only caught here.
        const claims = new Map<string, string[]>()
        for (const file of await walk(templates)) {
            const src = await readFile(file, 'utf8')
            for (const m of src.matchAll(/createTtlCache(?:<[^>]*>)?\(\s*([A-Z_]+|'[^']+')/g)) {
                let token = m[1]!
                if (!token.startsWith("'")) {
                    const decl = new RegExp(`const ${token}\\s*=\\s*'([^']+)'`).exec(src)
                    if (!decl) continue
                    token = `'${decl[1]!}'`
                }
                const ns = token.slice(1, -1)
                claims.set(ns, [...(claims.get(ns) ?? []), path.relative(templates, file)])
            }
        }
        expect(claims.size, 'no createTtlCache call sites found; update this test').toBeGreaterThan(0)
        const collisions = [...claims.entries()]
            .filter(([, files]) => files.length > 1)
            .map(([ns, files]) => `${ns} claimed by ${files.join(' and ')}`)
        expect(collisions).toEqual([])
    })
})
