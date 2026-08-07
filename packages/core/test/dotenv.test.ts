import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDotEnv } from '../src/utils/dotenv.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-dotenv-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

async function env(content: string): Promise<Map<string, string>> {
    await writeFile(path.join(projectDir, '.env'), content, 'utf8')
    return readDotEnv(projectDir)
}

describe('readDotEnv', () => {
    it('returns an empty map when .env is missing', async () => {
        expect((await readDotEnv(projectDir)).size).toBe(0)
    })

    it('parses plain KEY=VALUE pairs and tolerates spaces around =', async () => {
        const m = await env('FOO=bar\nBAZ = qux\n')
        expect(m.get('FOO')).toBe('bar')
        expect(m.get('BAZ')).toBe('qux')
    })

    it('skips blanks, comments and malformed lines', async () => {
        const m = await env('\n# comment\nNOEQUALS\n=novalue\n1BAD=x\nGOOD=1\n')
        expect([...m.keys()]).toEqual(['GOOD'])
    })

    it('strips the export prefix', async () => {
        const m = await env('export TOKEN=abc\n')
        expect(m.get('TOKEN')).toBe('abc')
    })

    it('unquotes double-quoted values with escapes', async () => {
        const m = await env('MSG="line1\\nline2\\t\\"quoted\\" \\\\end"\n')
        expect(m.get('MSG')).toBe('line1\nline2\t"quoted" \\end')
    })

    it('unquotes single-quoted values without escape processing', async () => {
        const m = await env('RAW=\'a\\nb\'\n')
        expect(m.get('RAW')).toBe('a\\nb')
    })

    it('strips inline comments from unquoted values only', async () => {
        const m = await env('A=value # trailing\nB="kept # inside"\n')
        expect(m.get('A')).toBe('value')
        expect(m.get('B')).toBe('kept # inside')
    })

    it('keeps = signs inside the value', async () => {
        const m = await env('URL=postgres://u:p@h:5432/db?a=1&b=2\n')
        expect(m.get('URL')).toBe('postgres://u:p@h:5432/db?a=1&b=2')
    })
})
