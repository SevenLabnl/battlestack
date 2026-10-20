import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateLedger } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import { generatePulledMigration, hashSchemaFiles } from '../src/utils/migrations.js'
import { mockRunContext } from './test-utils.js'

// Earlier pulls staged a users.ts without avatarKey on storage projects; generating from it
// wrote a migration that deletes every avatar on deploy.
let projectDir: string
const migrations = (...p: string[]): string => path.join(projectDir, 'server', 'database', 'migrations', ...p)
const DROP = 'ALTER TABLE "users" DROP COLUMN "avatar_key";'
const INDEX = 'CREATE INDEX "users_email_idx" ON "users" USING btree ("email");'
// Stands in for `drizzle-kit generate --custom`: an empty migration, as drizzle-kit writes one.
// A script file, so pnpm's appended `--custom --name=...` reach it instead of node.
const CUSTOM_SCRIPT = "require('fs').writeFileSync('server/database/migrations/0002_restore_avatar_key.sql', '')\n"

function snapshot(columns: string[]): string {
    const cols = Object.fromEntries(columns.map((c) => [c, { name: c, type: 'text', primaryKey: false, notNull: false }]))
    return `${JSON.stringify({ tables: { 'public.users': { name: 'users', columns: cols } } }, null, 2)}\n`
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-avatar-'))
    await mkdir(migrations('meta'), { recursive: true })
    await mkdir(path.join(projectDir, 'server', 'database', 'schema'), { recursive: true })
    await writeFile(path.join(projectDir, 'generate.cjs'), CUSTOM_SCRIPT)
    await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { 'db:generate': 'node generate.cjs' } }))
    await writeFile(migrations('0000_init.sql'), 'CREATE TABLE "users" ("email" text, "avatar_key" text);')
    await writeFile(migrations('meta', '0000_snapshot.json'), snapshot(['email', 'avatar_key']))
    await writeFile(migrations('0001_oops.sql'), `${DROP}--> statement-breakpoint\n${INDEX}`)
    await writeFile(migrations('meta', '0001_snapshot.json'), snapshot(['email']))
    await schemaDeclaresAvatar(true)
})

afterEach(async () => {
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

async function schemaDeclaresAvatar(declares: boolean): Promise<void> {
    const column = declares ? "\n    avatarKey: text('avatar_key')," : ''
    await writeFile(path.join(projectDir, 'server', 'database', 'schema', 'users.ts'), `export const users = pgTable('users', {${column}\n})\n`)
}

async function pull(enabled = ['nuxt4:database', 'nuxt4:storage']): Promise<{ warnings: string[], actions: string[] }> {
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    const ctx = mockRunContext({ projectDir, enabledFeatures: new Set(enabled), state: { packageManager: 'pnpm' } })
    // An unchanged schema, so only the repair runs db:generate.
    await generatePulledMigration(ctx, await hashSchemaFiles(projectDir))
    return { warnings: warn.mock.calls.map(([m]) => String(m)), actions: updateLedger(ctx).actions }
}

describe('a migration that dropped users.avatar_key on a storage project', () => {
    it('takes the drop out, restores the snapshots and adds a migration that puts the column back', async () => {
        const { actions } = await pull()

        const oops = await readFile(migrations('0001_oops.sql'), 'utf8')
        expect(oops).not.toContain('avatar_key')
        expect(oops).toContain(INDEX)
        const snap = JSON.parse(await readFile(migrations('meta', '0001_snapshot.json'), 'utf8'))
        expect(snap.tables['public.users'].columns.avatar_key).toEqual({ name: 'avatar_key', type: 'text', primaryKey: false, notNull: false })
        expect(await readFile(migrations('0002_restore_avatar_key.sql'), 'utf8')).toBe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;\n')
        expect(actions.join('\n')).toContain('0001_oops.sql')
        expect(actions.join('\n')).toContain('0002_restore_avatar_key.sql')
    })

    it('leaves a harmless statement when the drop was all the migration did', async () => {
        await writeFile(migrations('0001_oops.sql'), DROP)
        await pull()

        expect(await readFile(migrations('0001_oops.sql'), 'utf8')).toBe('SELECT 1;\n')
    })

    it('only warns when the schema no longer declares the column, as the project may mean it', async () => {
        await schemaDeclaresAvatar(false)
        const { warnings, actions } = await pull()

        expect(warnings.some((w) => w.includes('0001_oops.sql'))).toBe(true)
        expect(await readFile(migrations('0001_oops.sql'), 'utf8')).toContain(DROP)
        expect(actions).toHaveLength(0)
    })

    it.each([
        ['a later migration adds it back', ['nuxt4:database', 'nuxt4:storage'], 'ALTER TABLE "users" ADD COLUMN "avatar_key" text;'],
        ['storage is off', ['nuxt4:database'], undefined],
    ])('changes nothing when %s', async (_, enabled, readd) => {
        if (readd) await writeFile(migrations('0002_back.sql'), readd)
        const { warnings, actions } = await pull(enabled)

        expect(await readFile(migrations('0001_oops.sql'), 'utf8')).toContain(DROP)
        expect(warnings.filter((w) => w.includes('avatar_key'))).toHaveLength(0)
        expect(actions).toHaveLength(0)
    })
})
