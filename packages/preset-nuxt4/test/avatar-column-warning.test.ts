import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exists, updateLedger, type PackageManager } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import { generatePulledMigration, hashSchemaFiles } from '../src/utils/migrations.js'
import { mockRunContext } from './test-utils.js'

// Earlier pulls staged a users.ts without avatarKey on storage projects; generating from it
// wrote a migration that deletes every avatar on deploy.
let projectDir: string
const migrations = (...p: string[]): string => path.join(projectDir, 'server', 'database', 'migrations', ...p)
const DROP = 'ALTER TABLE "users" DROP COLUMN "avatar_key";'
const INDEX = 'CREATE INDEX "users_email_idx" ON "users" USING btree ("email");'
// Stands in for `drizzle-kit generate --custom`: an empty migration and a copy of the latest snapshot,
// as drizzle-kit writes them. It records its arguments, and writes nothing without `--custom`.
const CUSTOM_SCRIPT = [
    "const fs = require('fs')",
    "const dir = 'server/database/migrations'",
    "fs.writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))",
    "if (process.argv.includes('--custom')) {",
    "    fs.writeFileSync(dir + '/0002_restore_avatar_key.sql', '')",
    "    fs.copyFileSync(dir + '/meta/0001_snapshot.json', dir + '/meta/0002_snapshot.json')",
    '}',
    '',
].join('\n')

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

async function pull(enabled = ['nuxt4:database', 'nuxt4:storage'], packageManager: PackageManager = 'pnpm'): Promise<{ warnings: string[], actions: string[] }> {
    vi.restoreAllMocks()
    const warn = vi.spyOn(ui, 'warn').mockImplementation(() => {})
    const ctx = mockRunContext({ projectDir, enabledFeatures: new Set(enabled), state: { packageManager } })
    // An unchanged schema, so only the repair runs db:generate.
    await generatePulledMigration(ctx, await hashSchemaFiles(projectDir))
    return { warnings: warn.mock.calls.map(([m]) => String(m)), actions: updateLedger(ctx).actions }
}

const avatarIn = async (snapshotFile: string): Promise<unknown> =>
    JSON.parse(await readFile(migrations('meta', snapshotFile), 'utf8')).tables['public.users'].columns.avatar_key

describe('a migration that dropped users.avatar_key on a storage project', () => {
    it('adds a migration that puts the column back, and restores it in the snapshots from there on', async () => {
        const { actions } = await pull()

        expect(await readFile(migrations('0002_restore_avatar_key.sql'), 'utf8')).toBe('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;\n')
        expect(await avatarIn('0002_snapshot.json')).toEqual({ name: 'avatar_key', type: 'text', primaryKey: false, notNull: false })
        expect(await avatarIn('0001_snapshot.json')).toBeUndefined()
        expect(actions.join('\n')).toContain('0001_oops.sql')
        expect(actions.join('\n')).toContain('0002_restore_avatar_key.sql')
    })

    it('leaves the dropping migration as it is, since it may have run already', async () => {
        await pull()

        expect(await readFile(migrations('0001_oops.sql'), 'utf8')).toBe(`${DROP}--> statement-breakpoint\n${INDEX}`)
    })

    it('does nothing on the next pull', async () => {
        await pull()
        const { warnings, actions } = await pull()

        expect(warnings).toHaveLength(0)
        expect(actions).toHaveLength(0)
    })

    it('never overwrites a real migration db:generate wrote instead', async () => {
        const real = 'CREATE TABLE "posts" ("id" text);'
        await writeFile(path.join(projectDir, 'generate.cjs'), `require('fs').writeFileSync('server/database/migrations/0002_wild_posts.sql', ${JSON.stringify(real)})\n`)
        const { actions } = await pull()

        expect(await readFile(migrations('0002_wild_posts.sql'), 'utf8')).toBe(real)
        expect(actions.join('\n')).toContain('could not add the migration')
    })

    it('passes the flags to drizzle-kit through npm', async () => {
        await pull(['nuxt4:database', 'nuxt4:storage'], 'npm')

        expect(JSON.parse(await readFile(path.join(projectDir, 'args.json'), 'utf8'))).toEqual(['--custom', '--name=restore_avatar_key'])
    })

    it('finds the snapshot by the journal when migrations have a timestamp prefix', async () => {
        await rm(migrations('0001_oops.sql'))
        await writeFile(migrations('20261020120000_oops.sql'), DROP)
        await writeFile(path.join(projectDir, 'generate.cjs'), [
            "const fs = require('fs')",
            "const dir = 'server/database/migrations'",
            "fs.writeFileSync(dir + '/20261021120000_restore_avatar_key.sql', '')",
            "fs.copyFileSync(dir + '/meta/0001_snapshot.json', dir + '/meta/0002_snapshot.json')",
            "fs.writeFileSync(dir + '/meta/_journal.json', JSON.stringify({ entries: [{ idx: 0, tag: '0000_init' }, { idx: 1, tag: '20261020120000_oops' }, { idx: 2, tag: '20261021120000_restore_avatar_key' }] }))",
            '',
        ].join('\n'))
        await pull()

        expect(await avatarIn('0002_snapshot.json')).toBeDefined()
        expect(await avatarIn('0001_snapshot.json')).toBeUndefined()
    })

    it('only warns when the schema no longer declares the column, as the project may mean it', async () => {
        await writeFile(path.join(projectDir, 'server', 'database', 'schema', 'users.ts'), "// avatar_key moved to profiles\nexport const users = pgTable('users', {\n})\n")
        const { warnings, actions } = await pull()

        expect(warnings.some((w) => w.includes('0001_oops.sql'))).toBe(true)
        expect(actions).toHaveLength(0)
    })

    it.each([
        ['a later migration adds it back', ['nuxt4:database', 'nuxt4:storage'], 'ALTER TABLE "users" ADD COLUMN "avatar_key" text;', undefined],
        ['storage is off', ['nuxt4:database'], undefined, undefined],
        ['the drop is from another table', ['nuxt4:database', 'nuxt4:storage'], undefined, 'ALTER TABLE "teams" DROP COLUMN "avatar_key";'],
    ])('changes nothing when %s', async (_, enabled, readd, oops) => {
        if (readd) await writeFile(migrations('0002_back.sql'), readd)
        if (oops) await writeFile(migrations('0001_oops.sql'), oops)
        const { warnings, actions } = await pull(enabled)

        expect(warnings.filter((w) => w.includes('avatar_key'))).toHaveLength(0)
        expect(actions).toHaveLength(0)
        expect(await exists(migrations('0002_restore_avatar_key.sql'))).toBe(false)
    })
})
