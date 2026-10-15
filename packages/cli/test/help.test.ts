import { afterEach, describe, expect, it, vi } from 'vitest'
import { BattlestackRegistries } from '@battlestack/core'
import { printCommandHelp, printHelp } from '../src/cli/help.js'

afterEach(() => {
    vi.restoreAllMocks()
})

async function capture(mode?: 'scaffold' | 'project'): Promise<string> {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.join(' '))
    })
    await printHelp(mode, new BattlestackRegistries())
    return lines.join('\n')
}

describe('printHelp', () => {
    it('scaffold mode documents create flags', async () => {
        const out = await capture('scaffold')
        expect(out).toContain('--template')
        expect(out).toContain('--features')
        expect(out).toContain('--disable')
        expect(out).toContain('--pm')
    })

    it('project mode documents project commands', async () => {
        const out = await capture('project')
        expect(out).toContain('battlestack add')
        expect(out).toContain('pull')
        expect(out).toContain('doctor')
    })

    it('project mode renders every reserved command from its descriptor', async () => {
        const out = await capture('project')
        const { RESERVED_COMMANDS } = await import('../src/commands/project.js')
        for (const cmd of RESERVED_COMMANDS) {
            expect(out).toContain(cmd.usage)
            expect(out).toContain(cmd.label)
        }
    })

    it('project mode renders helpExtra rows under their command', async () => {
        const out = await capture('project')
        // pull's extra invocations live in its descriptor, not in help.ts.
        expect(out).toContain('battlestack pull --force')
        expect(out).toContain('battlestack pull --overwrite')
    })

    it('defaults to scaffold mode', async () => {
        expect(await capture()).toContain('--template')
    })

    it('prints a reserved command\'s own usage for `<command> --help`', () => {
        const lines: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '))
        })
        expect(printCommandHelp('own')).toBe(true)
        expect(lines.join('\n')).toContain('battlestack own <path...>')
        expect(printCommandHelp('my-app')).toBe(false)
    })

    it('prints self-update\'s usage, which is dispatched before the reserved commands', () => {
        const lines: string[] = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '))
        })
        expect(printCommandHelp('self-update')).toBe(true)
        expect(lines.join('\n')).toContain('battlestack self-update [--force]')
    })
})
