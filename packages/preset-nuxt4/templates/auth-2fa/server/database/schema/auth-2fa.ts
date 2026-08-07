import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const totpSecrets = pgTable('totp_secrets', {
    userId: uuid('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    encryptedSecret: text('encrypted_secret').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    enabledAt: timestamp('enabled_at'),
    setupExpiresAt: timestamp('setup_expires_at'),
})

export const backupCodes = pgTable('backup_codes', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
})
