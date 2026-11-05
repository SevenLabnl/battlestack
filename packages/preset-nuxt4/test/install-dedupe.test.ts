import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { run } from '@battlestack/core/utils/run.js'
import type { PackageManager } from '@battlestack/core'
import { installFeature } from '../src/features/install.js'
import { mockRunContext } from './test-utils.js'

vi.mock('@battlestack/core/utils/run.js', () => ({ run: vi.fn(async () => ({ stdout: '', stderr: '' })) }))
vi.mock('@battlestack/core/utils/skills.js', () => ({ collectSkillSources: () => [], installSkills: async () => {} }))

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-dedupe-'))
    await writeFile(path.join(projectDir, 'package.json'), '{}')
})

afterEach(async () => {
    vi.mocked(run).mockReset()
    vi.mocked(run).mockImplementation(async () => ({ stdout: '', stderr: '' }) as Awaited<ReturnType<typeof run>>)
    await rm(projectDir, { recursive: true, force: true })
})

const ctx = (packageManager: PackageManager) => mockRunContext({ projectDir, state: { packageManager } })
const commands = () => vi.mocked(run).mock.calls.map(([cmd, args]) => `${cmd} ${(args as string[]).join(' ')}`)

it.each(['pnpm', 'npm'] as const)('dedupes with %s after installing, so a floor reaches nested copies', async (pm) => {
    await installFeature.update!(ctx(pm), null)
    const ran = commands()
    const install = ran.findIndex((c) => c.startsWith(`${pm} install`))
    expect(install).toBeGreaterThanOrEqual(0)
    expect(ran.indexOf(`${pm} dedupe`)).toBeGreaterThan(install)
})

it('notes the manual step for bun, which has no dedupe', async () => {
    const report = await installFeature.update!(ctx('bun'), null)
    expect(commands()).not.toContain('bun dedupe')
    expect(report.notes.join('\n')).toContain('bun update @nuxt/cli')
})

it('keeps the pull going when dedupe fails, and says how to finish', async () => {
    vi.mocked(run).mockImplementation(async (_cmd, args) => {
        if ((args as string[])[0] === 'dedupe') throw new Error('ERR_PNPM_OFFLINE')
        return { stdout: '', stderr: '' } as Awaited<ReturnType<typeof run>>
    })
    const report = await installFeature.update!(ctx('pnpm'), null)
    expect(report.notes.join('\n')).toContain('run `pnpm dedupe` yourself')
})
