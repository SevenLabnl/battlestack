import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formattingFeature } from '../src/features/formatting.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-fmt-test-'))
    await writeFile(path.join(projectDir, 'package.json'), '{}\n', 'utf8')
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx() {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['shared:formatting']),
        state: { packageManager: 'pnpm' },
    })
}

describe('formattingFeature', () => {
    // Prettier must not merely be absent from the config, it must not be installed; the two
    // genuinely conflicted. Asserting `collectDeps === undefined` passes for the wrong reason.
    it('declares no prettier dev dep', () => {
        const dev = formattingFeature.collectDeps?.(ctx())?.dev ?? []
        expect(dev).not.toContain('prettier')
    })

    it('copies the formatting template files', async () => {
        await formattingFeature.execute(ctx())
        for (const rel of ['.editorconfig', '.dockerignore']) {
            await expect(access(path.join(projectDir, rel))).resolves.toBeUndefined()
        }
    })

    // The inverse, asserted separately: emitting a Prettier config means two formatters
    // again, regardless of what the dev deps say.
    it('ships no prettier config', async () => {
        await formattingFeature.execute(ctx())
        for (const rel of ['.prettierrc.json', '.prettierignore']) {
            await expect(access(path.join(projectDir, rel))).rejects.toThrow()
        }
    })

    it('wires format scripts into package.json, preserving existing scripts', async () => {
        await writeFile(
            path.join(projectDir, 'package.json'),
            JSON.stringify({ scripts: { dev: 'nuxt dev' } }),
            'utf8',
        )
        await formattingFeature.execute(ctx())
        const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
        // Deliberately the same tool as `lint`: CI, the lefthook hook and the docs all
        // refer to `format:check`, so the names stay even though ESLint now backs them.
        expect(pkg.scripts.format).toBe('eslint . --fix')
        expect(pkg.scripts['format:check']).toBe('eslint .')
        expect(pkg.scripts.dev).toBe('nuxt dev')
    })
})
