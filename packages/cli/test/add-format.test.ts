import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    hashFile,
    MANIFEST_PATH,
    STAGE,
    writeManifest,
    writeRecorded,
    type Feature,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'
import { buildRegistries, defaultArgs, withCwd } from './test-utils.js'

const formatProject = vi.fn()
vi.mock('@battlestack/preset-nuxt4', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    formatProject: (...a: unknown[]) => formatProject(...a),
}))

const { addCommand } = await import('../src/commands/add-remove.js')

const NS = 'fmt'

function feature(id: string): Feature {
    return {
        id,
        label: id,
        version: '1.0.0',
        stage: STAGE.STYLING,
        async execute(ctx) {
            await writeRecorded(ctx, id, `${id.replace(/:/g, '-')}.txt`, `  ${id}\n`)
        },
    }
}

function fixtures() {
    return buildRegistries({
        namespace: NS,
        frameworks: [{ id: 'fmt-fw', label: 'fw', supportedFeatures: ['fmt:base', 'fmt:opt'] }],
        features: [feature('fmt:base'), feature('fmt:opt')],
        templates: [{
            id: 'fmt-tpl',
            label: 'tpl',
            framework: 'fmt-fw',
            requiredFeatures: ['fmt:base'],
            optionalFeatures: ['fmt:opt'],
        }],
    })
}

let dir: string
const { registries } = fixtures()

beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-add-format-test-'))
    formatProject.mockReset()
    formatProject.mockImplementation(async (ctx: RunContext) => {
        for (const rel of ['fmt-base.txt', 'fmt-opt.txt']) {
            const abs = path.join(ctx.projectDir, rel)
            await writeFile(abs, (await readFile(abs, 'utf8')).trimStart())
        }
    })
    const base = registries.features.get('fmt:base')
    const ctx: RunContext = {
        projectName: 'p',
        projectDir: dir,
        framework: registries.frameworks.get('fmt-fw'),
        template: registries.templates.get('fmt-tpl'),
        enabledFeatures: new Set([base.fqid]),
        state: { packageManager: 'pnpm', skipInstall: true },
        debug: false,
        dryRun: false,
        registries,
    }
    await base.execute(ctx)
    await writeManifest(ctx)
})

afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

async function recordedHashes(): Promise<Record<string, string>> {
    const manifest = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8')) as ProjectManifest
    return Object.assign({}, ...manifest.features.map((f) => f.files))
}

describe('battlestack add formats the project like scaffold and pull do', () => {
    it('runs the formatter and records the formatted bytes, so nothing reads as drift', async () => {
        await withCwd(dir, () => addCommand(defaultArgs({ projectName: 'fmt:opt', skipInstall: true }), undefined as never, registries))

        expect(formatProject).toHaveBeenCalledTimes(1)
        const recorded = await recordedHashes()
        for (const rel of ['fmt-base.txt', 'fmt-opt.txt']) {
            expect(await readFile(path.join(dir, rel), 'utf8')).not.toMatch(/^ /)
            expect(recorded[rel]).toBe(await hashFile(path.join(dir, rel)))
        }
    })

    it('skips the formatter under --no-format', async () => {
        await withCwd(dir, () => addCommand(
            defaultArgs({ projectName: 'fmt:opt', skipInstall: true, format: false }),
            undefined as never,
            registries,
        ))
        expect(formatProject).not.toHaveBeenCalled()
    })
})
