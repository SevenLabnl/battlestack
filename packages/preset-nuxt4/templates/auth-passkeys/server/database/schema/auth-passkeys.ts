import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const webauthnCredentials = pgTable('webauthn_credentials', {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, { onDelete: 'cascade' })
        .notNull(),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    deviceType: text('device_type'),
    backedUp: text('backed_up'),
    transports: text('transports'),
    label: text('label'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
    index('webauthn_credentials_user_id_idx').on(t.userId),
])

export const webauthnChallenges = pgTable('webauthn_challenges', {
    id: uuid('id').defaultRandom().primaryKey(),
    challenge: text('challenge').notNull(),
    purpose: text('purpose').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})
