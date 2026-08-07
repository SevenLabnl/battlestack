import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core'

export enum Role {
    Admin = 'admin',
    User = 'user',
}

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: text('name').notNull().default(''),
    role: text('role').notNull().default(Role.User),
    theme: text('theme').notNull().default('system'),
    locale: text('locale').notNull().default('nl'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
