import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Postgres does not index the referencing side of a foreign key. Without one, deleting or
 * updating a parent row (a user, say) scans every child table for rows to cascade or check.
 */

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

async function schemaFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...await schemaFiles(full))
        else if (full.includes(`${path.sep}schema${path.sep}`) && entry.name.endsWith('.ts')) out.push(full)
    }
    return out
}

/** Each column whose definition chain calls `.references(`, with whether that chain also makes it the primary key. */
function foreignKeyColumns(src: string): Array<{ prop: string, primaryKey: boolean }> {
    const columns: Array<{ prop: string, primaryKey: boolean }> = []
    const re = /^\s*(\w+):\s*\w+\('[^']+'[^\n]*\)((?:\s*\.\w+\([^\n]*\))*)/gm
    for (const m of src.matchAll(re)) {
        const chain = m[0]
        if (chain.includes('.references(')) columns.push({ prop: m[1]!, primaryKey: chain.includes('.primaryKey()') })
    }
    return columns
}

describe('every foreign key in the scaffold is served by an index', () => {
    it('finds the foreign keys it is meant to check', async () => {
        let count = 0
        for (const file of await schemaFiles(templates)) count += foreignKeyColumns(await readFile(file, 'utf8')).length
        expect(count).toBeGreaterThanOrEqual(10)
    })

    it('indexes each referencing column, or makes it the primary key', async () => {
        const missing: string[] = []
        for (const file of await schemaFiles(templates)) {
            const src = await readFile(file, 'utf8')
            for (const { prop, primaryKey } of foreignKeyColumns(src)) {
                if (primaryKey) continue
                if (!new RegExp(`index\\('[^']+'\\)\\.on\\(t\\.${prop}\\b`).test(src)) {
                    missing.push(`${path.relative(templates, file)}: ${prop}`)
                }
            }
        }
        expect(missing).toEqual([])
    })
})
