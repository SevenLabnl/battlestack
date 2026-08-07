import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeStale, detectStale } from '../src/utils/recreate.js'

let tmpDir: string

beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-recreate-test-'))
})

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
})

describe('detectStale', () => {
    it('fast-paths to all-false when the directory does not exist', async () => {
        const result = await detectStale('nope', path.join(tmpDir, 'missing'))
        expect(result).toEqual({ dir: false, docker: false, incomplete: false })
    })

    it('flags a non-empty directory', async () => {
        const dir = path.join(tmpDir, 'proj')
        await mkdir(dir)
        await writeFile(path.join(dir, 'leftover.txt'), 'x', 'utf8')
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.dir).toBe(true)
        expect(result.incomplete).toBe(false)
    })

    it('treats an empty existing directory as not stale', async () => {
        const dir = path.join(tmpDir, 'empty')
        await mkdir(dir)
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.dir).toBe(false)
    })

    it('detects an incomplete manifest from a crashed run', async () => {
        const dir = path.join(tmpDir, 'crashed')
        await mkdir(path.join(dir, '.battlestack'), { recursive: true })
        await writeFile(
            path.join(dir, '.battlestack', 'manifest.json'),
            JSON.stringify({ incomplete: true }),
            'utf8',
        )
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.incomplete).toBe(true)
    })

    it('tolerates a malformed manifest', async () => {
        const dir = path.join(tmpDir, 'broken')
        await mkdir(path.join(dir, '.battlestack'), { recursive: true })
        await writeFile(path.join(dir, '.battlestack', 'manifest.json'), '{not json', 'utf8')
        const result = await detectStale('battlestack-test-no-such-compose-project', dir)
        expect(result.incomplete).toBe(false)
    })
})

describe('describeStale', () => {
    it('joins all stale parts', () => {
        const out = describeStale('demo', '/tmp/demo', { dir: true, docker: true, incomplete: true })
        expect(out).toContain('INCOMPLETE manifest')
        expect(out).toContain('dir /tmp/demo/')
        expect(out).toContain('docker compose project "demo"')
        expect(out.split(' + ')).toHaveLength(3)
    })

    it('mentions only what is actually stale', () => {
        expect(describeStale('demo', '/tmp/demo', { dir: true, docker: false })).toBe('dir /tmp/demo/')
        expect(describeStale('demo', '/tmp/demo', { dir: false, docker: true }))
            .toBe('docker compose project "demo"')
        expect(describeStale('demo', '/tmp/demo', { dir: false, docker: false })).toBe('')
    })
})
