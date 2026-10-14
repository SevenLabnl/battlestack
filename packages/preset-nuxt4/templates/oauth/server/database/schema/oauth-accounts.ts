import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const oauthAccounts = pgTable(
    'oauth_accounts',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        provider: text('provider').notNull(),
        providerUserId: text('provider_user_id').notNull(),
        linkedAt: timestamp('linked_at').notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('oauth_provider_user_unique').on(t.provider, t.providerUserId),
        index('oauth_accounts_user_id_idx').on(t.userId),
    ],
)

export type OAuthAccount = typeof oauthAccounts.$inferSelect
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert
