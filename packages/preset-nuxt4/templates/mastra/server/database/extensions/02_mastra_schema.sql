-- Mastra's PostgresStore writes to a dedicated schema (`schemaName: 'mastra'` in server/mastra/index.ts), and Postgres
-- won't auto-create it: without this, the first thread write fails and Studio shows "Thread not found" on every reload.
CREATE SCHEMA IF NOT EXISTS mastra;
