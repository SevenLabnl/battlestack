import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const files = pgTable('files', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    bucket: text('bucket').notNull(),
    key: text('key').notNull().unique(),
    size: integer('size').notNull().default(0),
    mime: text('mime'),
    etag: text('etag'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})
