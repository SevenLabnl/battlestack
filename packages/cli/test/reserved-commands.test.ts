import { describe, expect, it } from 'vitest'
import { RESERVED_COMMANDS } from '../src/commands/project.js'

// The dispatch table is assembled from per-module descriptors, so these tests guard the
// aggregate invariants no single module can see.
describe('RESERVED_COMMANDS', () => {
    it('has unique dispatch names', () => {
        const names = RESERVED_COMMANDS.map((c) => c.name)
        expect(new Set(names).size).toBe(names.length)
    })

    it('every descriptor is fully described', () => {
        for (const cmd of RESERVED_COMMANDS) {
            expect(cmd.name, cmd.name).toBeTruthy()
            expect(cmd.usage, cmd.name).toMatch(/^battlestack /)
            expect(cmd.usage, cmd.name).toContain(cmd.name)
            expect(cmd.label.length, cmd.name).toBeGreaterThan(0)
            expect(cmd.group.length, cmd.name).toBeGreaterThan(0)
        }
    })

    it('covers the documented command set', () => {
        const names = new Set(RESERVED_COMMANDS.map((c) => c.name))
        for (const expected of [
            'describe', 'doctor', 'cleanup',
            'pull', 'upgrade', 'bump', 'sync',
            'install', 'add', 'remove', 'own', 'disown',
            'gateway:up', 'gateway:down', 'gateway:status', 'mitm', 'mitm:stop',
        ]) {
            expect(names.has(expected), expected).toBe(true)
        }
    })

    it('groups every command into a known section', () => {
        const known = new Set(['Discovery', 'Sync with upstream', 'Lifecycle', 'Gateway / mitm'])
        for (const cmd of RESERVED_COMMANDS) {
            expect(known.has(cmd.group), `${cmd.name} → ${cmd.group}`).toBe(true)
        }
    })
})
