import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const PUT = path.resolve(here, '../templates/user-admin/server/api/users/[id].put.ts')

describe('user-admin PUT invalidates outstanding reset links', () => {
    it('deletes the user\'s password_reset_tokens in the update transaction on an email or password change', async () => {
        const src = await readFile(PUT, 'utf8')
        expect(src).toMatch(/credentialsChanged = !!body\.password \|\| \(body\.email !== undefined && body\.email !== existing\.email\)/)
        const tx = src.slice(src.indexOf('db.transaction('))
        expect(tx).toMatch(/credentialsChanged && useRuntimeConfig\(\)\.public\.authRecovery === true\)[\s\S]*?tx\.execute\(sql`DELETE FROM password_reset_tokens WHERE user_id = \$\{id\}`\)/)
    })
})
