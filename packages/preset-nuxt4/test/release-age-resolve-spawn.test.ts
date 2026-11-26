import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkLockfileAgainstReleaseAge } from '../src/utils/release-age.js'
import { mockRunContext } from './test-utils.js'

// Windows has no `pnpm` executable, only `pnpm.cmd`, so execFile must get what resolveSpawn found.
const RESOLVED = {
    file: 'C:\\pnpm\\pnpm.cmd',
    args: ['/d', '/s', '/c', 'pnpm.cmd install --frozen-lockfile --lockfile-only'],
    shell: false,
    windowsVerbatimArguments: true,
}

const { execFile, resolveSpawn } = vi.hoisted(() => ({
    execFile: vi.fn((...args: unknown[]) => {
        (args.at(-1) as (err: null, out: { stdout: string, stderr: string }) => void)(null, { stdout: '', stderr: '' })
    }),
    resolveSpawn: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal<object>(), execFile }))
vi.mock('@battlestack/core', async (importOriginal) => ({ ...await importOriginal<object>(), resolveSpawn }))

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-release-age-spawn-'))
    await writeFile(path.join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await writeFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 4320\n')
    resolveSpawn.mockReturnValue(RESOLVED)
})

afterEach(async () => {
    vi.clearAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

it('runs pnpm as resolveSpawn resolved it', async () => {
    const ctx = mockRunContext({ projectDir, state: { packageManager: 'pnpm' } })

    expect(await checkLockfileAgainstReleaseAge(ctx)).toBe(false)
    expect(resolveSpawn).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], { cwd: projectDir })
    expect(execFile).toHaveBeenCalledOnce()
    const [file, args, opts] = execFile.mock.calls[0]! as [string, string[], { shell?: boolean, windowsVerbatimArguments?: boolean }]
    expect(file).toBe(RESOLVED.file)
    expect(args).toEqual(RESOLVED.args)
    expect(opts.shell).toBe(RESOLVED.shell)
    expect(opts.windowsVerbatimArguments).toBe(true)
})
