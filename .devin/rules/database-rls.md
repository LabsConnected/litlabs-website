---
description: "Database, migration, tenant-isolation, and RLS rules — apply when touching schema, migrations, Supabase, or queries"
trigger: model_decision
---

# Database, RLS & Migrations

- Preserve tenant isolation; confirm authorization/RLS implications for new tables and endpoints.
- Use migrations for schema changes; never modify production schema manually when a migration should exist.
- Keep migrations reproducible; avoid destructive schema changes unless explicitly required.
- Do not silently swallow database failures.
