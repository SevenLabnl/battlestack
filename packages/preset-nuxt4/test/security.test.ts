import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gateRateLimiter, securityFeature } from '../src/features/security.js'
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

    it('gateRateLimiter leaves a disabled or already-gated limiter alone', () => {
        const disabled = 'security: { rateLimiter: false }'
        expect(gateRateLimiter(disabled)).toBe(disabled)
        const gated = 'rateLimiter: process.env.NUXT_RATE_LIMIT_DISABLED === \'true\' ? false : { tokensPerInterval: 1 }'
        expect(gateRateLimiter(gated)).toBe(gated)
    })
})
