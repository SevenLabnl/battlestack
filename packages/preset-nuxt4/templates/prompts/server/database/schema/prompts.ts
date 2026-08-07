import { pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core'

export const prompts = pgTable('prompts', {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    content: text('content').notNull(),
    defaultContent: text('default_content').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Prompt = typeof prompts.$inferSelect
export type NewPrompt = typeof prompts.$inferInsert
