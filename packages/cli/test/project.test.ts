import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claimedProjectCommands, collectFeatureCommandHelp, projectCommand } from '../src/commands/project.js'
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
        registries.commands.register({
            id: 'greet-dry',
            description: 'plugin command that honors --dry-run',
            honorsDryRun: true,
            run: (ctx) => {
                pluginContexts.push(ctx)
            },
        }, origin)
        // Shadows a reserved subcommand: must never reach dispatch, nor be listed.
        registries.commands.register({
            id: 'doctor',
            description: 'plugin command shadowing a reserved command',
            run: () => {
                executed.push('plugin-doctor')
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

describe('claimedProjectCommands', () => {
    it('covers reserved subcommands, feature commands and the scaffold-only ids', async () => {
        const claimed = await claimedProjectCommands(registries, projectDir)
        expect(claimed.has('doctor')).toBe(true)
        expect(claimed.has('gateway:up')).toBe(true)
        expect(claimed.has('hello')).toBe(true)
        expect(claimed.has('create')).toBe(true)
        expect(claimed.has('greet')).toBe(false)
    })

    it('still covers reserved subcommands with no project root', async () => {
        const claimed = await claimedProjectCommands(registries)
        expect(claimed.has('doctor')).toBe(true)
        expect(claimed.has('hello')).toBe(false)
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

    it('forwards the argv past the command token when a global flag comes first', async () => {
        const argv = ['--debug', 'greet', 'staging', '--wait']
        await projectCommand(parseArgs(argv), loader, projectDir, registries, argv)
        expect(pluginContexts).toHaveLength(1)
        const ctx = pluginContexts[0]!
        // `--debug` stays, `greet` goes: `staging` is the plugin's own first positional.
        expect(ctx.args).toEqual(['--debug', 'staging', '--wait'])
        expect(ctx.parsed.projectName).toBe('staging')
        expect(ctx.parsed.secondPositional).toBeUndefined()
        expect(ctx.parsed.debug).toBe(true)
    })

    it('forwards the argv past the command token when a value flag precedes it', async () => {
        const argv = ['--pm', 'bun', 'greet', 'staging']
        await projectCommand(parseArgs(argv), loader, projectDir, registries, argv)
        const ctx = pluginContexts[0]!
        expect(ctx.args).toEqual(['--pm', 'bun', 'staging'])
        expect(ctx.parsed.projectName).toBe('staging')
        expect(ctx.parsed.packageManager).toBe('bun')
    })

    it('keeps create scaffold-only under its fully-qualified id too', async () => {
        const argv = ['projecttest:create', 'my-app']
        await expect(projectCommand(parseArgs(argv), loader, projectDir, registries, argv))
            .rejects.toThrow(/Unknown project command: projecttest:create/)
        expect(executed).toEqual([])
    })

    it('refuses --dry-run for a plugin command that does not declare support', async () => {
        const argv = ['greet', '--dry-run']
        await expect(projectCommand(parseArgs(argv), loader, projectDir, registries, argv))
            .rejects.toThrow(/does not declare --dry-run support/)
        expect(pluginContexts).toEqual([])
    })

    it('dispatches --dry-run to a plugin command that declares support', async () => {
        const argv = ['greet-dry', '--dry-run']
        await projectCommand(parseArgs(argv), loader, projectDir, registries, argv)
        expect(pluginContexts).toHaveLength(1)
        expect(pluginContexts[0]!.parsed.dryRun).toBe(true)
    })

    it('omits plugin commands that lose dispatch from the listing', async () => {
        const lines: string[] = []
        vi.mocked(console.log).mockImplementation((...a: unknown[]) => {
            lines.push(a.join(' '))
        })
        await projectCommand(args(undefined), loader, projectDir, registries, [])
        const out = lines.join('\n')
        // Reachable, so listed under its plugin.
        expect(out).toContain('plugin-contributed top-level command')
        // Shadowed by a feature command, a reserved command, and the scaffold router.
        expect(out).not.toContain('plugin command shadowing a feature command')
        expect(out).not.toContain('plugin command shadowing a reserved command')
        expect(out).not.toContain('scaffold-only command')
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
