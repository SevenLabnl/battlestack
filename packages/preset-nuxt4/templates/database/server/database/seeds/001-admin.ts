import { hash, verify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { users, Role } from '../schema/users'
import type { db as Db } from '../client'

/** Seed the initial admin user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. */
export default async function seed(db: typeof Db): Promise<void> {
    const email = process.env.SEED_ADMIN_EMAIL
    const password = process.env.SEED_ADMIN_PASSWORD
    if (!email || !password) {
        console.log('  SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set, skipped')
        return
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

    if (!existing) {
        await db.insert(users).values({
            email,
            passwordHash: await hash(password),
            role: Role.Admin,
        })
        console.log(`  admin created: ${email}`)
        return
    }

    if (existing.role !== Role.Admin) {
        await db.update(users).set({ role: Role.Admin }).where(eq(users.email, email))
        console.log(`  admin role promoted: ${email}`)
    }

    if (process.env.SEED_ADMIN_RESET_PASSWORD === 'true') {
        await db
            .update(users)
            .set({ passwordHash: await hash(password) })
            .where(eq(users.email, email))
        console.warn(`  admin password reset: ${email}`)
        return
    }

    const stillValid = await verify(existing.passwordHash, password)
    if (!stillValid) {
        console.warn(
            `  ! admin ${email} exists but stored hash != .env password.\n` +
                `    Login with the password you originally seeded with, or\n` +
                `    SEED_ADMIN_RESET_PASSWORD=true battlestack db:reseed to rotate.`,
        )
    } else {
        console.log(`  admin already up to date: ${email}`)
    }
}
