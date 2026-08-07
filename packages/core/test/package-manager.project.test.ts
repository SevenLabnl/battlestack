import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureWorkspaceMarker, parseIgnoredBuilds, pmInstallGlobalCommands, resolveProjectPM, writeWorkspaceReleaseAge } from '../src/utils/package-manager.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-pm-proj-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('ensureWorkspaceMarker', () => {
    it('writes a seeded pnpm-workspace.yaml with allowBuilds', async () => {
        await ensureWorkspaceMarker(projectDir)
        const yaml = await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toContain('allowBuilds:')
        expect(yaml).toContain('esbuild: true')
        expect(yaml).toContain('\'@parcel/watcher\': true')
    })

    it('never overwrites an existing workspace yaml', async () => {
        await writeFile(
            path.join(projectDir, 'pnpm-workspace.yaml'),
            'packages:\n    - custom\n',
            'utf8',
        )
        await ensureWorkspaceMarker(projectDir)
        const yaml = await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toContain('custom')
        expect(yaml).not.toContain('allowBuilds')
    })
})

describe('writeWorkspaceReleaseAge', () => {
    it('creates the workspace yaml (seeded) and appends the policy line', async () => {
        await writeWorkspaceReleaseAge(projectDir, 0)
        const yaml = await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toContain('allowBuilds:')
        expect(yaml).toMatch(/^minimumReleaseAge: 0 /m)
    })

    it('replaces an existing policy line in place, preserving other content', async () => {
        await writeFile(
            path.join(projectDir, 'pnpm-workspace.yaml'),
            'minimumReleaseAge: 0 # old\nallowBuilds:\n    esbuild: true\n',
            'utf8',
        )
        await writeWorkspaceReleaseAge(projectDir, 7)
        const yaml = await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toMatch(/^minimumReleaseAge: 10080 /m)
        expect(yaml.match(/minimumReleaseAge:/g)).toHaveLength(1)
        expect(yaml).toContain('esbuild: true')
    })

    it('writes minutes (days × 1440)', async () => {
        await writeWorkspaceReleaseAge(projectDir, 1)
        const yaml = await readFile(path.join(projectDir, 'pnpm-workspace.yaml'), 'utf8')
        expect(yaml).toContain('minimumReleaseAge: 1440')
    })
})

describe('resolveProjectPM', () => {
    it('honours the package.json packageManager field', async () => {
        await writeFile(
            path.join(projectDir, 'package.json'),
            JSON.stringify({ packageManager: 'pnpm@11.5.1' }),
            'utf8',
        )
        expect(await resolveProjectPM({ projectDir })).toBe('pnpm')
    })

    it('falls back to the provided fallback when no field exists', async () => {
        expect(await resolveProjectPM({ projectDir, fallback: 'pnpm' })).toBe('pnpm')
    })

    it('coerces unsupported managers to pnpm', async () => {
        await writeFile(
            path.join(projectDir, 'package.json'),
            JSON.stringify({ packageManager: 'yarn@4.0.0' }),
            'utf8',
        )
        expect(await resolveProjectPM({ projectDir })).toBe('pnpm')
    })

    it('tolerates malformed package.json', async () => {
        await writeFile(path.join(projectDir, 'package.json'), '{not json', 'utf8')
        expect(await resolveProjectPM({ projectDir, fallback: 'pnpm' })).toBe('pnpm')
    })
})

describe('parseIgnoredBuilds', () => {
    it('extracts and de-dupes package names, stripping versions', () => {
        const out = parseIgnoredBuilds(
            '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @parcel/watcher@2.5.6, esbuild@0.27.7, esbuild@0.28.0',
        )
        expect(out).toEqual(['@parcel/watcher', 'esbuild'])
    })

    it('returns empty for unrelated output', () => {
        expect(parseIgnoredBuilds('all good')).toEqual([])
    })
})

describe('pmInstallGlobalCommands', () => {
    it('npm needs no bootstrap; pnpm/bun install globally via npm', () => {
        expect(pmInstallGlobalCommands('npm')).toEqual([])
        expect(pmInstallGlobalCommands('pnpm')).toEqual(['npm install -g pnpm'])
        expect(pmInstallGlobalCommands('bun')).toEqual(['npm install -g bun'])
    })
})
