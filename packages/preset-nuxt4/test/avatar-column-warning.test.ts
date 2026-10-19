import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ui } from '@battlestack/tui'
import { generatePulledMigration } from '../src/utils/migrations.js'
import { mockRunContext } from './test-utils.js'

// Earlier pulls staged a users.ts without avatarKey on storage projects; generating from it
// wrote a migration that deletes every avatar on deploy.
let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-avatar-'))
    await mkdir(path.join(projectDir, 'server', 'database', 'migrations'), { recursive: true })
})

afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

async function migration(name: string, sql: string): Promise<void> {
    await writeFile(path.join(projectDir, 'server', 'database', 'migrations', name), sql)
}

async function warningsFor(enabled: string[]): Promise<string[]> {
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    await generatePulledMigration(mockRunContext({ projectDir, enabledFeatures: new Set(enabled) }), new Map())
    return warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('avatar_key'))
}

it('warns about a migration that drops avatar_key on a storage project', async () => {
    await migration('0000_init.sql', 'CREATE TABLE "users" ("avatar_key" text);')
    await migration('0001_oops.sql', 'ALTER TABLE "users" DROP COLUMN "avatar_key";')

    const warnings = await warningsFor(['nuxt4:database', 'nuxt4:storage'])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('0001_oops.sql')
})

it.each([
    ['a later migration adds it back', ['nuxt4:database', 'nuxt4:storage'], 'ALTER TABLE "users" ADD COLUMN "avatar_key" text;'],
    ['storage is off', ['nuxt4:database'], undefined],
])('stays quiet when %s', async (_, enabled, readd) => {
    await migration('0001_oops.sql', 'ALTER TABLE "users" DROP COLUMN "avatar_key";')
    if (readd) await migration('0002_back.sql', readd)

    expect(await warningsFor(enabled)).toHaveLength(0)
})
