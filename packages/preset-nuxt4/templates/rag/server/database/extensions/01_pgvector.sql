-- Required before any `vector(N)` column can be created, and Drizzle's generated SQL won't
-- include it. Ships alongside the rag feature so `db:migrate` picks it up first.
CREATE EXTENSION IF NOT EXISTS vector;
