import { describe, expect, it } from 'vitest'
import { BattlestackRegistries, silentLoader, type Provenance } from '@battlestack/core'
import { dispatchPluginCommand, isScaffoldOnly, lookupPluginCommand, pluginCommandGroups, pluginCommandUsage } from '../src/cli/plugin-commands.js'

const alpha: Provenance = { plugin: '@test/alpha', namespace: 'alpha' }
const beta: Provenance = { plugin: '@test/beta', namespace: 'beta' }
const loader = silentLoader()

/** Two plugins, each contributing `create` and `deploy`, so every bare id is ambiguous. */
function ambiguousRegistries(): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    for (const origin of [alpha, beta]) {
        registries.commands.register({ id: 'create', description: 'scaffold', run() {} }, origin)
        registries.commands.register({ id: 'deploy', description: 'ship it', run() {} }, origin)
    }
    return registries
}

describe('lookupPluginCommand', () => {
    it('reports an absent id without throwing', () => {
        expect(lookupPluginCommand(new BattlestackRegistries(), 'nope')).toEqual({ kind: 'none' })
    })

    it('resolves a bare id and its fqid to the same record', () => {
        const registries = new BattlestackRegistries()
        registries.commands.register({ id: 'deploy', description: 'ship it', run() {} }, alpha)
        const bare = lookupPluginCommand(registries, 'deploy')
        const qualified = lookupPluginCommand(registries, 'alpha:deploy')
        expect(bare.kind).toBe('one')
        expect(qualified).toEqual(bare)
    })

    it('reports every candidate for an ambiguous bare id instead of throwing', () => {
        expect(lookupPluginCommand(ambiguousRegistries(), 'deploy')).toEqual({
            kind: 'ambiguous',
            candidates: ['alpha:deploy', 'beta:deploy'],
        })
    })

    it('resolves an fqid even when the bare id is ambiguous', () => {
        const found = lookupPluginCommand(ambiguousRegistries(), 'beta:deploy')
        expect(found.kind === 'one' && found.command.origin.plugin).toBe('@test/beta')
    })
})

describe('isScaffoldOnly', () => {
    it('holds for both spellings of a scaffold-only command', () => {
        const registries = new BattlestackRegistries()
        registries.commands.register({ id: 'create', description: 'scaffold', run() {} }, alpha)
        expect(isScaffoldOnly(registries, 'create')).toBe(true)
        expect(isScaffoldOnly(registries, 'alpha:create')).toBe(true)
    })

    it('holds for an ambiguous scaffold-only id', () => {
        expect(isScaffoldOnly(ambiguousRegistries(), 'create')).toBe(true)
        expect(isScaffoldOnly(ambiguousRegistries(), 'alpha:create')).toBe(true)
    })

    it('does not hold for an ordinary command', () => {
        expect(isScaffoldOnly(ambiguousRegistries(), 'deploy')).toBe(false)
    })
})

describe('dispatchPluginCommand', () => {
    it('returns false for an unregistered id', async () => {
        expect(await dispatchPluginCommand('nope', [], loader, new BattlestackRegistries())).toBe(false)
    })

    it('names a qualified spelling the user can actually type on an ambiguous id', async () => {
        const registries = ambiguousRegistries()
        await expect(dispatchPluginCommand('deploy', [], loader, registries))
            .rejects.toThrow(/Ambiguous command "deploy", provided by alpha:deploy, beta:deploy/)
        await expect(dispatchPluginCommand('deploy', [], loader, registries))
            .rejects.toThrow(/battlestack alpha:deploy/)
    })

    it('refuses --dry-run unless the command declares support', async () => {
        const registries = new BattlestackRegistries()
        let ran = false
        registries.commands.register({ id: 'deploy', description: 'ship it', run() { ran = true } }, alpha)
        await expect(dispatchPluginCommand('deploy', ['--dry-run'], loader, registries))
            .rejects.toThrow(/`alpha:deploy` does not declare --dry-run support/)
        expect(ran).toBe(false)
        // Without the flag the same command dispatches.
        expect(await dispatchPluginCommand('deploy', [], loader, registries)).toBe(true)
        expect(ran).toBe(true)
    })

    it('passes --dry-run through to a command that declares support', async () => {
        const registries = new BattlestackRegistries()
        let dryRun: boolean | undefined
        registries.commands.register({
            id: 'deploy',
            description: 'ship it',
            honorsDryRun: true,
            run(ctx) { dryRun = ctx.parsed.dryRun },
        }, alpha)
        expect(await dispatchPluginCommand('deploy', ['--dry-run'], loader, registries)).toBe(true)
        expect(dryRun).toBe(true)
    })

    it('builds the context from the argv it is handed', async () => {
        const registries = new BattlestackRegistries()
        let args: string[] = []
        let projectRoot: string | undefined
        registries.commands.register({
            id: 'deploy',
            description: 'ship it',
            run(ctx) {
                args = ctx.args
                projectRoot = ctx.projectRoot
            },
        }, alpha)
        await dispatchPluginCommand('deploy', ['--debug', 'staging'], loader, registries, '/tmp/proj')
        expect(args).toEqual(['--debug', 'staging'])
        expect(projectRoot).toBe('/tmp/proj')
    })
})

describe('pluginCommandGroups', () => {
    it('excludes scaffold-only ids by default', () => {
        const registries = new BattlestackRegistries()
        registries.commands.register({ id: 'create', description: 'scaffold', run() {} }, alpha)
        registries.commands.register({ id: 'deploy', description: 'ship it', run() {} }, alpha)
        expect(pluginCommandGroups(registries)).toEqual([
            { plugin: '@test/alpha', commands: [expect.objectContaining({ id: 'deploy' })] },
        ])
    })

    it('excludes a claimed fqid but keeps a command whose bare name is claimed', () => {
        const registries = new BattlestackRegistries()
        registries.commands.register({ id: 'deploy', description: 'ship it', run() {} }, alpha)
        registries.commands.register({ id: 'doctor', description: 'shadowed', run() {} }, beta)
        const groups = pluginCommandGroups(registries, new Set(['alpha:deploy', 'doctor']))
        expect(groups).toEqual([
            { plugin: '@test/beta', commands: [expect.objectContaining({ fqid: 'beta:doctor' })] },
        ])
    })

    it('still excludes scaffold-only ids when a claimed set is passed', () => {
        const registries = new BattlestackRegistries()
        registries.commands.register({ id: 'create', description: 'scaffold', run() {} }, alpha)
        expect(pluginCommandGroups(registries, new Set(['doctor']))).toEqual([])
    })

    it('groups by owning plugin', () => {
        const groups = pluginCommandGroups(ambiguousRegistries())
        expect(groups.map((g) => g.plugin)).toEqual(['@test/alpha', '@test/beta'])
        expect(groups.every((g) => g.commands.every((c) => c.id === 'deploy'))).toBe(true)
    })
})

describe('pluginCommandUsage', () => {
    function one(command: { id: string, usage?: string }) {
        const registries = new BattlestackRegistries()
        registries.commands.register({ description: 'x', run() {}, ...command }, alpha)
        return { registries, cmd: registries.commands.all()[0]! }
    }

    it('keeps the bare usage when the bare name reaches the command', () => {
        const { registries, cmd } = one({ id: 'status', usage: 'status [service]' })
        expect(pluginCommandUsage(registries, cmd)).toBe('status [service]')
    })

    it('leads with the fqid when the bare name is claimed', () => {
        const { registries, cmd } = one({ id: 'login', usage: 'login [--no-browser]' })
        expect(pluginCommandUsage(registries, cmd, new Set(['login']))).toBe('alpha:login [--no-browser]')
    })

    it('leads with the fqid when several plugins provide the bare name', () => {
        const registries = ambiguousRegistries()
        expect(registries.commands.all().filter((cmd) => cmd.id === 'deploy').map((cmd) => pluginCommandUsage(registries, cmd)))
            .toEqual(['alpha:deploy', 'beta:deploy'])
    })

    it('leaves a usage that already leads with the fqid alone', () => {
        const { registries, cmd } = one({ id: 'login', usage: 'alpha:login' })
        expect(pluginCommandUsage(registries, cmd, new Set(['login']))).toBe('alpha:login')
    })
})
