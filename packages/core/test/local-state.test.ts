import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLocalState, writeLocalState } from '../src/local-state.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-localstate-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('local state', () => {
    it('returns null when no local.json exists', async () => {
        expect(await readLocalState(projectDir)).toBeNull()
    })

    it('round-trips gateway state through .battlestack/local.json', async () => {
        await writeLocalState(projectDir, { gateway: { enabled: true, hostname: 'demo.battlestack.test' } })
        const state = await readLocalState(projectDir)
        expect(state?.gateway?.enabled).toBe(true)
        expect(state?.gateway?.hostname).toBe('demo.battlestack.test')
    })
})
