-- Make the memories dedupe constraint inferable by PostgREST upserts.
--
-- The original idx_memories_dedupe was PARTIAL (WHERE dedupe_key IS NOT
-- NULL). Postgres requires an index_predicate in ON CONFLICT to infer a
-- partial unique index, and PostgREST's on_conflict parameter cannot
-- express predicates — so /api/n8n/memory's upsert always failed with
-- 42P10. A non-partial unique index preserves the same semantics: rows
-- with NULL dedupe_key still never conflict (NULLs are never equal in a
-- unique index), while non-NULL dedupe keys dedupe correctly.

DROP INDEX IF EXISTS idx_memories_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedupe
  ON memories(owner_id, project_id, agent_slug, memory_type, dedupe_key);
