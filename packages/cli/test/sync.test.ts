import { describe, expect, it, vi } from 'vitest'

import { syncCommand } from '../src/commands/sync.js'
import type { BattlestackRegistries, ParsedArgs } from '@battlestack/core'
import type { Ora } from 'ora'

// `battlestack sync` is pull, bump, doctor, in that order. The three are stubbed so
// these assert orchestration without spawning anything.
const calls: string[] = []
vi.mock('../src/commands/pull.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    pullCommand: vi.fn(async () => {
        calls.push('pull')
    }),
}))
vi.mock('../src/commands/bump.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    bumpCommand: vi.fn(async () => {
        calls.push('bump')
    }),
}))
vi.mock('../src/commands/doctor.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    doctorCommand: vi.fn(async () => {
        calls.push('doctor')
    }),
}))

describe('syncCommand', () => {
    it('runs pull, bump, doctor in order', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        await syncCommand({} as ParsedArgs, {} as Ora, {} as BattlestackRegistries)
        expect(calls).toEqual(['pull', 'bump', 'doctor'])
        vi.restoreAllMocks()
    })
})
