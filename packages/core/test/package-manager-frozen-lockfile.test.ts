import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { installArgs } from '../src/utils/package-manager.js'
import { run } from '../src/utils/run.js'

/**
 * Drives a real pnpm against the state scaffold and `add` leave behind: a
 * lockfile written before the newly declared dependencies existed.
 */

const CI_ENV = { CI: 'true' }
const created: string[] = []

async function writePkg(dir: string, dependencies: Record<string, string>): Promise<void> {
    const pkg = { name: 'frozen-lockfile-fixture', private: true, dependencies }
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
}

/** A project with `a` installed and `b` declared but absent from the lockfile. */
async function seedOutdatedLockfile(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-frozen-'))
    created.push(dir)

    // Local `file:` dependencies resolve without a registry, so this stays offline.
    for (const name of ['a', 'b']) {
        await fs.mkdir(path.join(dir, name), { recursive: true })
        await fs.writeFile(
            path.join(dir, name, 'package.json'),
            JSON.stringify({ name, version: '1.0.0' }),
            'utf8',
        )
    }
    // Without a local workspace file pnpm walks up and installs somewhere else.
    await fs.writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'packages: []\n')

    await writePkg(dir, { a: 'file:./a' })
    await run('pnpm', ['install', '--offline', '--config.confirmModulesPurge=false'], { cwd: dir })

    await writePkg(dir, { a: 'file:./a', b: 'file:./b' })
    return dir
}

afterAll(async () => {
    // Windows holds pnpm's handles open past process exit, so removal can raise
    // EBUSY. A temp directory the OS will reclaim is not a test failure.
    await Promise.all(created.map(async (dir) => {
        try {
            await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        } catch {
            // Left for the OS.
        }
    }))
})

describe('pnpm install under CI with an outdated lockfile', () => {
    it('succeeds with the args the CLI actually uses', async () => {
        const dir = await seedOutdatedLockfile()
        await run('pnpm', [...installArgs('pnpm'), '--offline'], { cwd: dir, env: CI_ENV })

        const lock = await fs.readFile(path.join(dir, 'pnpm-lock.yaml'), 'utf8')
        expect(lock).toContain('file:./b')
    })

    // Negative control: without the flag this is the exact failure that made
    // every scaffold inside a CI environment unusable.
    it('fails without --no-frozen-lockfile', async () => {
        const dir = await seedOutdatedLockfile()
        const withoutFlag = installArgs('pnpm').filter((arg) => arg !== '--no-frozen-lockfile')

        await expect(
            run('pnpm', [...withoutFlag, '--offline'], { cwd: dir, env: CI_ENV }),
        ).rejects.toThrow(/frozen-lockfile|OUTDATED_LOCKFILE|dependencies were added/i)
    })
})
