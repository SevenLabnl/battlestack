import type { SpawnSyncReturns } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { describePortAttribution, diagnosePort } from '../src/utils/port-diagnosis.js'
import type { spawnSyncResolved } from '../src/utils/win-exec.js'

type SpawnResult = SpawnSyncReturns<string>

/** Build a fake `spawnSyncResolved` keyed by command name: one call per scenario. */
function fakeSpawn(byCommand: Record<string, Partial<SpawnResult>>): typeof spawnSyncResolved {
    return ((command: string): SpawnResult => {
        const preset = byCommand[command]
        return {
            status: preset?.status ?? 1,
            signal: null,
            pid: 0,
            output: [null, preset?.stdout ?? '', preset?.stderr ?? ''],
            stdout: preset?.stdout ?? '',
            stderr: preset?.stderr ?? '',
        }
    }) as unknown as typeof spawnSyncResolved
}

describe('diagnosePort: docker attribution', () => {
    it('attributes to a compose project when the container has one', async () => {
        const row = JSON.stringify({
            Names: 'demo-db-1',
            Labels: 'com.docker.compose.project=demo,com.docker.compose.service=db',
        })
        const spawn = fakeSpawn({ docker: { status: 0, stdout: row + '\n' } })

        const diagnosis = await diagnosePort(15432, { spawn })
        expect(diagnosis.attribution).toEqual({
            kind: 'docker',
            container: 'demo-db-1',
            composeProject: 'demo',
            relation: undefined,
        })
    })

    it('classifies relation "own" when the compose project matches the caller', async () => {
        const row = JSON.stringify({ Names: 'demo-db-1', Labels: 'com.docker.compose.project=demo' })
        const spawn = fakeSpawn({ docker: { status: 0, stdout: row + '\n' } })

        const diagnosis = await diagnosePort(15432, { spawn, expectedComposeProject: 'demo' })
        expect(diagnosis.attribution).toMatchObject({ kind: 'docker', relation: 'own' })
    })

    it('classifies relation "other" when the compose project differs', async () => {
        const row = JSON.stringify({ Names: 'other-db-1', Labels: 'com.docker.compose.project=other-project' })
        const spawn = fakeSpawn({ docker: { status: 0, stdout: row + '\n' } })

        const diagnosis = await diagnosePort(15432, { spawn, expectedComposeProject: 'demo' })
        expect(diagnosis.attribution).toMatchObject({
            kind: 'docker',
            composeProject: 'other-project',
            relation: 'other',
        })
    })

    it('a container with no compose label reports no relation even when asked', async () => {
        const row = JSON.stringify({ Names: 'plain-nginx', Labels: 'maintainer=someone' })
        const spawn = fakeSpawn({ docker: { status: 0, stdout: row + '\n' } })

        const diagnosis = await diagnosePort(80, { spawn, expectedComposeProject: 'demo' })
        expect(diagnosis.attribution).toEqual({ kind: 'docker', container: 'plain-nginx', composeProject: undefined, relation: undefined })
    })

    it('falls through to process/unknown when docker finds nothing', async () => {
        const spawn = fakeSpawn({ docker: { status: 0, stdout: '' } })
        const diagnosis = await diagnosePort(15432, { spawn })
        expect(diagnosis.attribution.kind).toBe('unknown')
    })

    it('falls through when docker itself is not installed (non-zero status)', async () => {
        const spawn = fakeSpawn({ docker: { status: 1 } })
        const diagnosis = await diagnosePort(15432, { spawn })
        expect(diagnosis.attribution.kind).toBe('unknown')
    })

    it('does not blow up on malformed JSON from docker', async () => {
        const spawn = fakeSpawn({ docker: { status: 0, stdout: 'not json\n' } })
        const diagnosis = await diagnosePort(15432, { spawn })
        expect(diagnosis.attribution.kind).toBe('unknown')
    })
})

describe('diagnosePort: process fallback (platform-specific)', () => {
    it('parses an lsof LISTEN row on darwin', async () => {
        const originalPlatform = process.platform
        Object.defineProperty(process, 'platform', { value: 'darwin' })
        try {
            const lsofOutput
                = 'COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n'
                + 'node    21830 joris   12u  IPv4      0      0t0  TCP 127.0.0.1:15432 (LISTEN)\n'
            const spawn = fakeSpawn({
                docker: { status: 0, stdout: '' },
                lsof: { status: 0, stdout: lsofOutput },
            })
            const diagnosis = await diagnosePort(15432, { spawn })
            expect(diagnosis.attribution).toEqual({ kind: 'process', pid: 21830, name: 'node' })
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        }
    })

    it('parses an ss LISTEN row on linux', async () => {
        const originalPlatform = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux' })
        try {
            const ssOutput = 'LISTEN 0  128  0.0.0.0:15432  0.0.0.0:*  users:(("postgres",pid=4242,fd=6))\n'
            const spawn = fakeSpawn({
                docker: { status: 0, stdout: '' },
                ss: { status: 0, stdout: ssOutput },
            })
            const diagnosis = await diagnosePort(15432, { spawn })
            expect(diagnosis.attribution).toEqual({ kind: 'process', pid: 4242, name: 'postgres' })
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        }
    })

    it('parses PowerShell output on win32', async () => {
        const originalPlatform = process.platform
        Object.defineProperty(process, 'platform', { value: 'win32' })
        try {
            const spawn = fakeSpawn({
                docker: { status: 0, stdout: '' },
                'powershell.exe': { status: 0, stdout: '9999,postgres\n' },
            })
            const diagnosis = await diagnosePort(15432, { spawn })
            expect(diagnosis.attribution).toEqual({ kind: 'process', pid: 9999, name: 'postgres' })
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        }
    })

    it('reports unknown when nothing is found anywhere', async () => {
        const spawn = fakeSpawn({ docker: { status: 0, stdout: '' } })
        const diagnosis = await diagnosePort(65000, { spawn })
        expect(diagnosis.attribution).toEqual({ kind: 'unknown' })
    })
})

describe('describePortAttribution', () => {
    it('describes an own-project docker container', () => {
        expect(
            describePortAttribution({ kind: 'docker', container: 'demo-db-1', composeProject: 'demo', relation: 'own' }),
        ).toMatch(/this project's own Docker container/)
    })

    it('describes another project\'s docker container', () => {
        expect(
            describePortAttribution({ kind: 'docker', container: 'x-db-1', composeProject: 'x', relation: 'other' }),
        ).toMatch(/"x" compose project/)
    })

    it('describes an unlabeled docker container', () => {
        expect(describePortAttribution({ kind: 'docker', container: 'plain' })).toMatch(/^a Docker container/)
    })

    it('describes a plain process with a name', () => {
        expect(describePortAttribution({ kind: 'process', pid: 123, name: 'node' })).toBe('node (pid 123)')
    })

    it('describes a plain process without a name', () => {
        expect(describePortAttribution({ kind: 'process', pid: 123 })).toBe('pid 123')
    })

    it('describes unknown', () => {
        expect(describePortAttribution({ kind: 'unknown' })).toBe('an unknown process')
    })
})
