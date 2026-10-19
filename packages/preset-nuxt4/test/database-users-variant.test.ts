import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { patchUsersSchema } from '../src/features/storage.js'

// A project with storage has storage's patch on users.ts. When nuxt4:database ships a different
// file, pull stages it for a manual merge, and taking that file drops the avatar column.
const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'database-users')
const USERS = path.join('server', 'database', 'schema', 'users.ts')

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-users-variant-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('nuxt4:database users.ts variants', () => {
    it('ships with-storage byte-identical to the base file after storage\'s patch', async () => {
        await mkdir(path.join(projectDir, path.dirname(USERS)), { recursive: true })
        await writeFile(path.join(projectDir, USERS), await readFile(path.join(TEMPLATES, 'base', USERS)))

        await patchUsersSchema(projectDir)

        expect(await readFile(path.join(projectDir, USERS), 'utf8'))
            .toBe(await readFile(path.join(TEMPLATES, 'with-storage', USERS), 'utf8'))
    })

    it('leaves the with-storage file as it is', async () => {
        const withStorage = await readFile(path.join(TEMPLATES, 'with-storage', USERS), 'utf8')
        await mkdir(path.join(projectDir, path.dirname(USERS)), { recursive: true })
        await writeFile(path.join(projectDir, USERS), withStorage)

        await patchUsersSchema(projectDir)

        expect(await readFile(path.join(projectDir, USERS), 'utf8')).toBe(withStorage)
    })
})
