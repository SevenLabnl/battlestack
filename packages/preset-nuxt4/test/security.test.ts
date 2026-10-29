import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { securityFeature } from '../src/features/security.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-sec-test-'))
    await writeFile(
        path.join(projectDir, 'nuxt.config.ts'),
        `export default defineNuxtConfig({\n})\n`,
        'utf8',
    )
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('securityFeature', () => {
    function ctx() {
        return mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:security']),
            state: { packageManager: 'pnpm' },
        })
    }

    it('declares the nuxt-security module', () => {
        expect(securityFeature.collectModules!(ctx())).toContain('nuxt-security')
    })

    it('declares nuxt-security as a prod dep', () => {
        const deps = securityFeature.collectDeps!(ctx())
        expect(deps?.prod).toContain('nuxt-security')
    })

    it('execute() patches nuxt.config with the default security block', async () => {
        await securityFeature.execute(ctx())
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        expect(cfg).toContain('security:')
        expect(cfg).toContain('contentSecurityPolicy')
        expect(cfg).toContain('strictTransportSecurity')
        expect(cfg).toMatch(/xFrameOptions:\s*['"]DENY['"]/)
        expect(cfg).toMatch(/referrerPolicy:\s*['"]strict-origin-when-cross-origin['"]/)
        expect(cfg).toContain('permissionsPolicy')
        expect(cfg).toContain('rateLimiter')
        // Rate limiter is env-gated so `pnpm test` / e2e runs can opt out.
        expect(cfg).toContain('NUXT_RATE_LIMIT_DISABLED')
    })

    it('CSP allows unsafe-inline for styles only', async () => {
        await securityFeature.execute(ctx())
        const cfg = await readFile(path.join(projectDir, 'nuxt.config.ts'), 'utf8')
        // style-src includes unsafe-inline. Printed in the project's single-quote style, so the
        // CSP keyword's own quotes come out escaped: '\'unsafe-inline\''.
        expect(cfg).toMatch(/['"]style-src['"][^\]]*\\?'unsafe-inline\\?'/s)
        // script-src does NOT: only 'self'
        const scriptSrcMatch = cfg.match(/['"]script-src['"]\s*:\s*\[([^\]]+)\]/)
        expect(scriptSrcMatch).toBeTruthy()
        expect(scriptSrcMatch![1]).not.toContain('unsafe-inline')
    })

    it('update() gates a hardcoded rateLimiter from an older scaffold, keeping its values', async () => {
        const cfgPath = path.join(projectDir, 'nuxt.config.ts')
        await writeFile(
            cfgPath,
            `export default defineNuxtConfig({\n    security: {\n        rateLimiter: {\n            tokensPerInterval: 50,\n            interval: 30000,\n        },\n    },\n})\n`,
            'utf8',
        )
        const report = await securityFeature.update!(ctx(), null)
        const cfg = await readFile(cfgPath, 'utf8')
        expect(cfg).toMatch(
            /rateLimiter: process\.env\.NUXT_RATE_LIMIT_DISABLED === 'true' \? false : \{\s*tokensPerInterval: 50,\s*interval: 30000,\s*\}/,
        )
        expect(report.notes).toHaveLength(1)

        const again = await securityFeature.update!(ctx(), null)
        expect(await readFile(cfgPath, 'utf8')).toBe(cfg)
        expect(again.notes).toHaveLength(0)
    })

    it.each([
        ['disabled', 'rateLimiter: false,', 0],
        ['already gated', 'rateLimiter: process.env.NUXT_RATE_LIMIT_DISABLED === \'true\' ? false : { tokensPerInterval: 1 },', 0],
        ['a variable', 'rateLimiter: limits,', 1],
    ])('update() leaves a %s rateLimiter alone, with %i note', async (_, line, notes) => {
        const cfgPath = path.join(projectDir, 'nuxt.config.ts')
        const before = `const limits = { tokensPerInterval: 1 }\nexport default defineNuxtConfig({\n    security: {\n        ${line}\n    },\n})\n`
        await writeFile(cfgPath, before, 'utf8')
        const report = await securityFeature.update!(ctx(), null)
        expect(await readFile(cfgPath, 'utf8')).toBe(before)
        expect(report.notes).toHaveLength(notes)
    })

    it.each(['as any', 'satisfies RateLimiter'])('update() gates a rateLimiter written `{ … } %s`', async (suffix) => {
        const cfgPath = path.join(projectDir, 'nuxt.config.ts')
        await writeFile(cfgPath, `export default defineNuxtConfig({\n    security: {\n        rateLimiter: { tokensPerInterval: 50 } ${suffix},\n    },\n})\n`, 'utf8')
        const report = await securityFeature.update!(ctx(), null)
        const cfg = await readFile(cfgPath, 'utf8')
        expect(cfg).toContain(`rateLimiter: process.env.NUXT_RATE_LIMIT_DISABLED === 'true' ? false : { tokensPerInterval: 50 } ${suffix}`)
        expect(report.notes).toHaveLength(1)
    })

    it('update() gates a rateLimiter with nested options, and ignores one in a comment', async () => {
        const cfgPath = path.join(projectDir, 'nuxt.config.ts')
        await writeFile(
            cfgPath,
            `export default defineNuxtConfig({\n    // rateLimiter: { tokensPerInterval: 1 },\n    security: {\n        rateLimiter: {\n            tokensPerInterval: 50,\n            driver: { name: 'lruCache' },\n        },\n    },\n})\n`,
            'utf8',
        )
        await securityFeature.update!(ctx(), null)
        const cfg = await readFile(cfgPath, 'utf8')
        expect(cfg).toContain('// rateLimiter: { tokensPerInterval: 1 },')
        expect(cfg).toMatch(/rateLimiter: process\.env\.NUXT_RATE_LIMIT_DISABLED === 'true' \? false : \{[\s\S]*driver: \{ name: 'lruCache' \}/)
    })
})
