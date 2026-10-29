import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { updateLedger } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import { checkLockfileAgainstReleaseAge, LOCKFILE_BLOCKED_STATE_KEY } from '../src/utils/release-age.js'
import { mockRunContext } from './test-utils.js'

// A lockfile resolved before the policy can hold younger packages; pnpm then refuses every script.
let projectDir: string
let binDir: string
const PATH = process.env.PATH

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-release-age-'))
    binDir = path.join(projectDir, 'bin')
    await mkdir(binDir)
    await writeFile(path.join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await writeFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 4320\n')
    vi.spyOn(ui, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    process.env.PATH = PATH
    vi.restoreAllMocks()
    await rm(projectDir, { recursive: true, force: true })
})

/** Puts a stand-in `pnpm` first on PATH that prints `output` and exits with `code`. */
async function fakePnpm(output: string, code: number): Promise<void> {
    const script = path.join(binDir, 'pnpm')
    await writeFile(script, `#!/bin/sh\necho '${output}' >&2\nexit ${code}\n`)
    await chmod(script, 0o755)
    process.env.PATH = `${binDir}${path.delimiter}${PATH}`
}

it.skipIf(process.platform === 'win32')('records one step to rebuild a lockfile the policy rejects', async () => {
    await fakePnpm('[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 77 lockfile entries failed verification', 1)
    const ctx = mockRunContext({ projectDir, state: { packageManager: 'pnpm' } })

    expect(await checkLockfileAgainstReleaseAge(ctx)).toBe(true)
    expect(ctx.state[LOCKFILE_BLOCKED_STATE_KEY]).toBe(true)
    expect(updateLedger(ctx).actions.join('\n')).toContain('pnpm clean --lockfile && pnpm install')
})

it.skipIf(process.platform === 'win32').each([
    ['the lockfile passes', '', 0, 0],
    ['pnpm fails for another reason, saying so', '[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile"', 1, 1],
])('records nothing when %s', async (_, output, code, warnings) => {
    await fakePnpm(output, code)
    const ctx = mockRunContext({ projectDir, state: { packageManager: 'pnpm' } })

    expect(await checkLockfileAgainstReleaseAge(ctx)).toBe(false)
    expect(updateLedger(ctx).actions).toHaveLength(0)
    const about = vi.mocked(ui.warn).mock.calls.filter(([m]) => String(m).includes('Could not check pnpm-lock.yaml'))
    expect(about).toHaveLength(warnings)
    if (warnings) expect(String(about[0]![0])).toContain('ERR_PNPM_OUTDATED_LOCKFILE')
})
