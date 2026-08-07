import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disownCommand, ownCommand } from '../src/commands/own.js'
import {
    BattlestackRegistries,
    copyTemplateDirRecorded,
    hashFile,
    MANIFEST_PATH,
    STAGE,
    writeManifest,
    type Feature,
    type ParsedArgs,
    type Provenance,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'

const FW = 'own-test-fw'
const TPL = 'own-test-tpl'
const origin: Provenance = { plugin: '@test/own', namespace: 'owntest' }

// Registries are per-load instances, not a module singleton, so build one shared
// instance and register each test's fixtures against it.
const registries = new BattlestackRegistries()

function ensureRegistry(): void {
    if (!registries.frameworks.has(FW)) {
        registries.frameworks.register({ id: FW, label: FW, supportedFeatures: [] }, origin)
    }
    if (!registries.templates.has(TPL)) {
        registries.templates.register({
            id: TPL,
            label: TPL,
            framework: FW,
            requiredFeatures: [],
            optionalFeatures: [],
        }, origin)
    }
}

function args(positionals: string[]): ParsedArgs {
    return {
        force: false,
        overwrite: false,
        yes: false,
        skipInstall: false,
        debug: false,
        dryRun: false,
        help: false,
        version: false,
        scaffold: false,
        seed: false,
        deep: false,
        verbose: false,
        volumes: false,
        browser: true,
        skills: true,
        format: true,
        skillsOnly: false,
        positionals,
        passthrough: [],
    }
}

interface Handle {
    projectDir: string
    cleanup(): Promise<void>
    readManifest(): Promise<ProjectManifest>
}

async function setup(featureId: string, files: Record<string, string>): Promise<Handle> {
    ensureRegistry()
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-own-test-'))
    const templateDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-own-tpl-'))

    for (const [rel, content] of Object.entries(files)) {
        const dest = path.join(templateDir, rel)
        await mkdir(path.dirname(dest), { recursive: true })
        await writeFile(dest, content, 'utf8')
    }

    const feature: Feature = {
        id: featureId,
        label: featureId,
        version: '0.1.0',
        stage: STAGE.STYLING,
        async execute(ctx) {
            await copyTemplateDirRecorded(ctx, featureId, templateDir)
        },
    }
    if (!registries.features.has(featureId)) registries.features.register(feature, origin)

    const ctx: RunContext = {
        projectName: path.basename(projectDir),
        projectDir,
        framework: registries.frameworks.get(FW),
        template: registries.templates.get(TPL),
        enabledFeatures: new Set([featureId]),
        state: { packageManager: 'pnpm' },
        debug: false,
        dryRun: false,
        registries,
    }
    await feature.execute(ctx)
    await writeManifest(ctx)

    return {
        projectDir,
        async readManifest() {
            return JSON.parse(
                await readFile(path.join(projectDir, MANIFEST_PATH), 'utf8'),
            ) as ProjectManifest
        },
        async cleanup() {
            await rm(projectDir, { recursive: true, force: true })
            await rm(templateDir, { recursive: true, force: true })
        },
    }
}

const handles: Handle[] = []
afterEach(async () => {
    while (handles.length > 0) await handles.pop()!.cleanup()
})

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const orig = process.cwd()
    process.chdir(dir)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        return await fn()
    } finally {
        log.mockRestore()
        process.chdir(orig)
    }
}

describe('battlestack own / disown', () => {
    it('own marks tracked path as ownedByUser', async () => {
        const id = 'test:feat-own-1'
        const h = await setup(id, { 'a.ts': 'one\n', 'b.ts': 'two\n' })
        handles.push(h)

        await withCwd(h.projectDir, () => ownCommand(args(['own', 'a.ts']), undefined as never))

        const m = await h.readManifest()
        // The persisted record id is the fqid; the bare id was registered under
        // `origin`'s namespace.
        const rec = m.features.find((f) => f.id.endsWith(id))!
        expect(rec.ownedByUser).toEqual(['a.ts'])
    })

    it('own accepts multiple paths in one call', async () => {
        const id = 'test:feat-own-2'
        const h = await setup(id, { 'a.ts': '1\n', 'b.ts': '2\n', 'c.ts': '3\n' })
        handles.push(h)

        await withCwd(h.projectDir, () =>
            ownCommand(args(['own', 'a.ts', 'b.ts']), undefined as never),
        )

        const rec = (await h.readManifest()).features.find((f) => f.id.endsWith(id))!
        expect(rec.ownedByUser).toEqual(['a.ts', 'b.ts'])
    })

    it('own is idempotent: re-owning the same path is a no-op', async () => {
        const id = 'test:feat-own-3'
        const h = await setup(id, { 'a.ts': '1\n' })
        handles.push(h)

        await withCwd(h.projectDir, () => ownCommand(args(['own', 'a.ts']), undefined as never))
        await withCwd(h.projectDir, () => ownCommand(args(['own', 'a.ts']), undefined as never))

        const rec = (await h.readManifest()).features.find((f) => f.id.endsWith(id))!
        expect(rec.ownedByUser).toEqual(['a.ts'])
    })

    it('own rejects unknown paths', async () => {
        const id = 'test:feat-own-4'
        const h = await setup(id, { 'a.ts': '1\n' })
        handles.push(h)

        await expect(
            withCwd(h.projectDir, () =>
                ownCommand(args(['own', 'nope.ts']), undefined as never),
            ),
        ).rejects.toThrow(/not tracked/)
    })

    it('disown removes the path and rebases the recorded hash to current contents', async () => {
        const id = 'test:feat-own-5'
        const h = await setup(id, { 'a.ts': 'original\n' })
        handles.push(h)

        await withCwd(h.projectDir, () => ownCommand(args(['own', 'a.ts']), undefined as never))

        // User edits the file while it is owned.
        await writeFile(path.join(h.projectDir, 'a.ts'), 'mine\n', 'utf8')

        await withCwd(h.projectDir, () =>
            disownCommand(args(['disown', 'a.ts']), undefined as never),
        )

        const rec = (await h.readManifest()).features.find((f) => f.id.endsWith(id))!
        expect(rec.ownedByUser).toBeUndefined()
        // The recorded hash MUST match the current edited contents, or the next pull
        // patches against the long-gone original, which is what disown prevents.
        const liveHash = await hashFile(path.join(h.projectDir, 'a.ts'))
        expect(rec.files['a.ts']).toBe(liveHash)
    })

    it('disown errors when the file does not exist on disk', async () => {
        const id = 'test:feat-own-6'
        const h = await setup(id, { 'a.ts': '1\n' })
        handles.push(h)

        await withCwd(h.projectDir, () => ownCommand(args(['own', 'a.ts']), undefined as never))
        await rm(path.join(h.projectDir, 'a.ts'))

        await expect(
            withCwd(h.projectDir, () =>
                disownCommand(args(['disown', 'a.ts']), undefined as never),
            ),
        ).rejects.toThrow(/does not exist/)
    })
})
