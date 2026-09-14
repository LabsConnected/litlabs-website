---
description: "Database, migration, tenant-isolation, and RLS rules — apply when touching schema, migrations, Supabase, or queries"
trigger: model_decision
---

# Database & RLS

- Preserve tenant isolation.
- Use migrations for schema changes.
- Never modify production schema manually when a migration should exist.
- Keep migrations reproducible.
- Avoid destructive schema changes unless explicitly required.
- Confirm authorization/RLS implications for new tables and endpoints.
- Do not silently swallow database failures.
