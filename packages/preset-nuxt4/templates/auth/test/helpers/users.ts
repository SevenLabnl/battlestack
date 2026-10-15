import { randomUUID } from 'node:crypto'
import { loginAs } from '~~/test/helpers/setup'

export interface TestUser {
    id: string
    name: string
    email: string
    role: string
    cookie: string
}

/**
 * Insert a user straight into the database and log in as them. Not via `POST /api/users`: that route ships with
 * `nuxt4:user-admin`, which the auth-only features calling this do not require.
 */
export async function createTestUser(
    overrides: Partial<{ name: string, email: string, password: string, role: string }> = {},
): Promise<TestUser> {
    const name = overrides.name ?? 'Test User'
    // randomUUID, not Date.now(): parallel e2e files can share a millisecond, colliding on the users_email_unique constraint.
    const email = overrides.email ?? `test-${randomUUID()}@example.com`
    const password = overrides.password ?? 'Mountain-Pine42!'
    const role = overrides.role ?? 'user'

    // Lazy: `#server/database/client` throws from its module body without NUXT_DATABASE_URL, killing the importing file.
    const { db } = await import('#server/database/client')
    const { users } = await import('#server/database/schema/users')
    const { hashUserPassword } = await import('#server/utils/password')
    const [row] = await db
        .insert(users)
        .values({ name, email, role, passwordHash: await hashUserPassword(password) })
        .returning({ id: users.id })
    if (!row) throw new Error('createTestUser: insert returned no row')

    return { id: row.id, name, email, role, cookie: await loginAs(email, password) }
}
