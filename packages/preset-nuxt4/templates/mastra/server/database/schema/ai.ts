import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core'

export const aiModelConfigs = pgTable('ai_model_configs', {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    model: text('model').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Populated on boot by `10-sync-ai-on-boot.ts` (insert-if-missing, never deletes) so every environment has a controllable row per agent.
 * Links are soft, by key rather than uuid FK, because keys are stable across environments and uuids are not; nothing cascades.
 */
export const agents = pgTable('agents', {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    modelConfigKey: text('model_config_key').notNull().default('chat'),
    promptKey: text('prompt_key'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type AiModelConfig = typeof aiModelConfigs.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type NewAgentRow = typeof agents.$inferInsert
