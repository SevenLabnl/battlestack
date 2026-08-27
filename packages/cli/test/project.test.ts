import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectFeatureCommandHelp, projectCommand } from '../src/commands/project.js'
import { parseArgs } from '../src/cli/args.js'
import {
    BattlestackRegistries,
    silentLoader,
    STAGE,
    type CommandContext,
    type Feature,
    type ParsedArgs,
    type Provenance,
} from '@battlestack/core'

let projectDir: string
let executed: string[]
let pluginContexts: CommandContext[]

const FEATURE_ID = 'test:project-cmd'
const origin: Provenance = { plugin: '@test/project', namespace: 'projecttest' }

// Per-instance registries, not a module singleton: one shared object, seeded once.
const registries = new BattlestackRegistries()

function ensureRegistered(): void {
    if (!registries.frameworks.has('project-test')) {
        registries.frameworks.register({ id: 'project-test', label: 'project-test', supportedFeatures: [] }, origin)
    }
    if (!registries.templates.has('project-test')) {
        registries.templates.register({
            id: 'project-test',
            label: 'project-test',
            framework: 'project-test',
            requiredFeatures: [],
            optionalFeatures: [],
        }, origin)
    }
    if (!registries.features.has(FEATURE_ID)) {
        const feature: Feature = {
            id: FEATURE_ID,
            version: '1.0.0',
            label: 'project-cmd-test-feature',
            stage: STAGE.STYLING,
            async execute() {},
            projectCommands() {
                return {
                    hello: {
                        label: 'say hello',
                        run: async () => {
                            executed.push('hello')
                        },
                    },
                }
            },
        }
        registries.features.register(feature, origin)
    }
    if (!registries.commands.has('greet')) {
        registries.commands.register({
            id: 'greet',
            description: 'plugin-contributed top-level command',
            run: (ctx) => {
                pluginContexts.push(ctx)
            },
        }, origin)
        // Same name as the feature command: must lose to it in project mode.
        registries.commands.register({
            id: 'hello',
            description: 'plugin command shadowing a feature command',
            run: () => {
                executed.push('plugin-hello')
            },
        }, origin)
        registries.commands.register({
            id: 'create',
            description: 'scaffold-only command',
            run: () => {
                executed.push('plugin-create')
            },
        }, origin)
    }
}

async function writeProjectManifest(): Promise<void> {
    await mkdir(path.join(projectDir, '.battlestack'), { recursive: true })
    await writeFile(
        path.join(projectDir, '.battlestack', 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            cliVersion: '0.0.0',
            framework: 'project-test',
            template: 'project-test',
            packageManager: 'pnpm',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            features: [{ id: FEATURE_ID, version: '1.0.0', files: {} }],
        }),
        'utf8',
    )
}

function args(projectName?: string, extra: Partial<ParsedArgs> = {}): ParsedArgs {
    return { projectName, debug: false, dryRun: false, positionals: [], ...extra } as ParsedArgs
}

const loader = silentLoader()

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-project-cmd-test-'))
    executed = []
    pluginContexts = []
    ensureRegistered()
    await writeProjectManifest()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

describe('collectFeatureCommandHelp', () => {
    it('aggregates per-feature command help from the manifest', async () => {
        const help = await collectFeatureCommandHelp(projectDir, registries)
        expect(help).toEqual([
            { feature: FEATURE_ID, commands: [['battlestack hello', 'say hello']] },
        ])
    })

    it('returns [] when no manifest exists', async () => {
        expect(await collectFeatureCommandHelp(path.join(projectDir, 'nowhere'), registries)).toEqual([])
    })
})

describe('projectCommand', () => {
    it('dispatches a feature command', async () => {
        await projectCommand(args('hello'), loader, projectDir, registries, ['hello'])
        expect(executed).toEqual(['hello'])
    })

    it('lists available commands when none requested', async () => {
        const lines: string[] = []
        vi.mocked(console.log).mockImplementation((...a: unknown[]) => {
            lines.push(a.join(' '))
        })
        await projectCommand(args(undefined), loader, projectDir, registries, [])
        expect(executed).toEqual([])
        expect(lines.join('\n')).toContain('hello')
        expect(lines.join('\n')).toContain(FEATURE_ID)
    })

    it('dry-run reports the command without executing it', async () => {
        const lines: string[] = []
        vi.mocked(console.log).mockImplementation((...a: unknown[]) => {
            lines.push(a.join(' '))
        })
        await projectCommand(args('hello', { dryRun: true }), loader, projectDir, registries, ['hello', '--dry-run'])
        expect(executed).toEqual([])
        expect(lines.join('\n')).toContain('would execute hello')
    })

    it('throws on unknown commands and suggests the closest match', async () => {
        const lines: string[] = []
        vi.mocked(console.log).mockImplementation((...a: unknown[]) => {
            lines.push(a.join(' '))
        })
        await expect(projectCommand(args('helo'), loader, projectDir, registries, ['helo']))
            .rejects.toThrow(/Unknown project command/)
        expect(lines.join('\n')).toContain('did you mean: battlestack hello?')
    })

    it('falls back to a plugin command with the scaffold-mode CommandContext shape', async () => {
        const argv = ['greet', 'production', '--wait', '--replicas=3']
        await projectCommand(parseArgs(argv), loader, projectDir, registries, argv)
        expect(pluginContexts).toHaveLength(1)
        const ctx = pluginContexts[0]!
        // Flags survive in `args`, and `parsed` is re-parsed past the command name.
        expect(ctx.args).toEqual(['production', '--wait', '--replicas=3'])
        expect(ctx.parsed.projectName).toBe('production')
        expect(ctx.parsed.secondPositional).toBeUndefined()
        expect(ctx.projectRoot).toBe(projectDir)
    })

    it('feature commands win over a plugin command with the same name', async () => {
        await projectCommand(args('hello'), loader, projectDir, registries, ['hello'])
        expect(executed).toEqual(['hello'])
    })

    it('keeps create scaffold-only inside a project', async () => {
        await expect(projectCommand(parseArgs(['create', 'my-app']), loader, projectDir, registries, ['create', 'my-app']))
            .rejects.toThrow(/Unknown project command: create/)
        expect(executed).toEqual([])
    })

    it('suggests plugin commands on a near miss', async () => {
        const lines: string[] = []
        vi.mocked(console.log).mockImplementation((...a: unknown[]) => {
            lines.push(a.join(' '))
        })
        await expect(projectCommand(args('greeet'), loader, projectDir, registries, ['greeet']))
            .rejects.toThrow(/Unknown project command/)
        expect(lines.join('\n')).toContain('did you mean: battlestack greet?')
    })

    it('stamps projectName into the manifest on first run (rename reconciliation)', async () => {
        await projectCommand(args('hello'), loader, projectDir, registries, ['hello'])
        const manifest = JSON.parse(
            await import('node:fs/promises').then((fs) =>
                fs.readFile(path.join(projectDir, '.battlestack', 'manifest.json'), 'utf8'),
            ),
        )
        expect(manifest.projectName).toBe(path.basename(projectDir))
    })
})
