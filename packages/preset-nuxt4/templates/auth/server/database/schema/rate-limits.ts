import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Cross-replica fixed-window counters, one row per `<policy-name>:<key>` bucket; `postgresRateLimitCheck` is the only reader/writer.
 * Ships unconditionally: Postgres is the durable floor even when Redis is added in front as an accelerator.
 */
export const rateLimits = pgTable('rate_limits', {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
})

export type RateLimitRow = typeof rateLimits.$inferSelect
