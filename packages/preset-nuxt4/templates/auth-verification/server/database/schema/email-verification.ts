import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const emailVerificationTokens = pgTable('email_verification_tokens', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
})

/** Row exists -> verified. Absent -> pending. Enforcement (blocking unverified users at login) is global via
 * `runtimeConfig.public.requireEmailVerification`, not per-row. */
export const userEmailVerified = pgTable('user_email_verified', {
    userId: uuid('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    verifiedAt: timestamp('verified_at').notNull().defaultNow(),
})
