import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `enabledFeatures` holds fqids, so a raw `.has()` with an authored id silently reads as
 * "disabled". This shipped: `.mcp.json` never registered Playwright, and docs claimed it.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * No allowlist: `enabledHas` names its parameter `enabled`, so a hit on the
 * `enabledFeatures` property is always wrong. Exclude by path, never loosen this.
 */
const RAW_CALL = /\benabledFeatures\s*\.\s*has\s*\(/

/**
 * Comment-only lines are skipped: a guard that forbids *naming* the hazard it guards is
 * broken. Trailing comments on a code line still scan, so a real call cannot hide.
 */
function isCommentOnly(line: string): boolean {
    const t = line.trim()
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue
        const abs = path.join(dir, entry)
        if (statSync(abs).isDirectory()) sourceFiles(abs, acc)
        else if (entry.endsWith('.ts')) acc.push(abs)
    }
    return acc
}

describe('enabledFeatures call-site guard', () => {
    it('has a src tree to scan (guards against a silently-empty glob)', () => {
        expect(packageSrcFiles().length).toBeGreaterThan(50)
    })

    it('no source file calls enabledFeatures.has() directly: every check goes through isFeatureEnabled()', () => {
        const offenders: string[] = []

        for (const abs of packageSrcFiles()) {
            const rel = path.relative(ROOT, abs).split(path.sep).join('/')
            const lines = readFileSync(abs, 'utf8').split('\n')
            lines.forEach((line, i) => {
                if (isCommentOnly(line)) return
                if (RAW_CALL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
            })
        }

        expect(
            offenders,
            'Raw `enabledFeatures.has(<id>)` never matches an authored id: the set holds '
            + 'fqids, so this silently evaluates to false forever. Use '
            + '`isFeatureEnabled(ctx, \'<authored:id>\')` from @battlestack/core instead.',
        ).toEqual([])
    })

    it('the pattern actually matches the shape it is meant to catch', () => {
        // Without this, a typo in RAW_CALL yields a permanently-green guard that scans
        // real files and finds nothing: the vacuous pass this file exists to prevent.
        expect(RAW_CALL.test("if (ctx.enabledFeatures.has('shared:playwright')) {")).toBe(true)
        expect(RAW_CALL.test('return ctx.enabledFeatures.has(id)')).toBe(true)
        expect(RAW_CALL.test('enabledFeatures . has ( x )')).toBe(true)
        // Iteration and the blessed helper must NOT match.
        expect(RAW_CALL.test('for (const id of ctx.enabledFeatures) {')).toBe(false)
        expect(RAW_CALL.test("isFeatureEnabled(ctx, 'shared:playwright')")).toBe(false)
        expect(RAW_CALL.test('if (enabled.has(id)) return true')).toBe(false)

        // Comment-only lines are exempt so the hazard can be described by
        // name; a trailing comment on a code line is not.
        expect(isCommentOnly('    // the gate was a raw enabledFeatures.has()')).toBe(true)
        expect(isCommentOnly('     * see enabledFeatures.has() below')).toBe(true)
        expect(isCommentOnly("    if (ctx.enabledFeatures.has('x')) { // why")).toBe(false)
    })
})

function packageSrcFiles(): string[] {
    const packages = path.join(ROOT, 'packages')
    return readdirSync(packages)
        .map(pkg => path.join(packages, pkg, 'src'))
        .filter((dir) => {
            try {
                return statSync(dir).isDirectory()
            } catch {
                return false
            }
        })
        .flatMap(dir => sourceFiles(dir))
}
