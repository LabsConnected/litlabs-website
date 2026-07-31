# Supabase Migration Workflow

## Overview

All database schema changes are managed through Supabase migrations in
`supabase/migrations/`. The entire migration history must be reproducible
from a clean database — i.e., `supabase db reset` must succeed without
errors when run against a fresh local Postgres instance.

## Local Development

### Prerequisites

- Docker Desktop (or Docker Engine on Linux)
- Node.js 22+
- pnpm 9.15+
- Supabase CLI: `npx supabase` (no global install needed)

### Starting Local Supabase

```powershell
npx supabase start      # Start all services (Postgres, Auth, Storage, etc.)
npx supabase stop       # Stop services (preserves data volumes)
npx supabase stop --no-backup  # Stop and delete data volumes
```

### Resetting the Database

```powershell
npx supabase db reset   # Drop and recreate all tables by replaying migrations
```

This is the canonical reproducibility test. If `db reset` fails, the
migration history is broken and must be fixed before merging.

### Creating a New Migration

```powershell
npx supabase migration new <descriptive_name>
```

This creates `supabase/migrations/<timestamp>_<descriptive_name>.sql`.
Write your schema changes in this file using idempotent SQL patterns
(see below).

## Idempotent SQL Patterns

All migrations must be idempotent — they must succeed whether run on a
fresh database or on a database that already has some of the changes.

### Use IF NOT EXISTS / IF EXISTS

```sql
CREATE TABLE IF NOT EXISTS public.my_table (...);
CREATE INDEX IF NOT EXISTS idx_my_table_col ON public.my_table(col);
DROP POLICY IF EXISTS my_policy ON public.my_table;
ALTER TABLE public.my_table ADD COLUMN IF NOT EXISTS new_col TEXT;
```

### Guard ALTER TABLE on tables that may not exist yet

If a migration modifies a table that is created by a *later* migration,
wrap the ALTER in a table existence check:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'my_table'
  ) THEN
    ALTER TABLE public.my_table ADD COLUMN IF NOT EXISTS new_col TEXT;
  END IF;
END $$;
```

### Guard ALTER FUNCTION on functions that may not exist yet

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'my_function' AND pronamespace = 'public'::regnamespace
  ) THEN
    ALTER FUNCTION public.my_function() SET search_path = '';
  END IF;
END $$;
```

### Guard CREATE TRIGGER (IF NOT EXISTS not supported in all PG versions)

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public' AND event_object_table = 'my_table'
      AND trigger_name = 'my_trigger'
  ) THEN
    CREATE TRIGGER my_trigger
      BEFORE UPDATE ON public.my_table
      FOR EACH ROW EXECUTE FUNCTION public.my_function();
  END IF;
END $$;
```

### Use named dollar-quote tags to avoid conflicts

When nesting `$$` inside a DO block, use a named tag:

```sql
DO $outer$
BEGIN
  PERFORM cron.schedule('job', '* * * * *',
    $$DELETE FROM my_table WHERE created_at < now() - interval '1 day'$$
  );
END $outer$;
```

## CI Protection

The `migration-reproducibility.yml` GitHub Actions workflow runs
`supabase db reset` on every PR that touches `supabase/migrations/`.
The workflow fails if any migration cannot be replayed from a clean
database.

## Diagnostic Scripts

Non-migration SQL scripts (EXPLAIN verification, manual data fixes,
etc.) belong in `supabase/diagnostics/`, NOT `supabase/migrations/`.
Files in `diagnostics/` are not replayed by `supabase db reset`.

## Common Pitfalls

1. **Don't edit `supabase/schema.sql`** — it is the historical base
   schema. The initial migration (`20240613000000_initial_schema.sql`)
   captures it. New changes go in new migration files only.

2. **Don't use bare `ALTER TABLE` on tables created by later migrations** —
   wrap in existence checks.

3. **Don't use `CREATE TRIGGER IF NOT EXISTS`** — it's not supported in
   all PostgreSQL versions. Use the DO block pattern above.

4. **Don't reference columns that may not exist** — if a migration adds
   a column and a later migration creates an index on it, the index
   creation must be guarded with a column existence check.

5. **Don't put diagnostic EXPLAIN/ANALYZE scripts in migrations** —
   they fail on a fresh database. Put them in `supabase/diagnostics/`.

6. **Always use `public.` schema prefix** — bare table names may
   resolve to the wrong schema in some contexts.