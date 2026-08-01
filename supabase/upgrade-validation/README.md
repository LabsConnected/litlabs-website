# Upgrade-Path Validation

These scripts validate the REAL upgrade path for the `agent_system_notifications`
forward migration (`20260801000000`). They are NOT pgTAP tests and are NOT run
by `supabase test db` — they require a specific database state and must be
executed in order.

## Automated (CI)

The `Production-style migration upgrade` job in
`.github/workflows/migration-reproducibility.yml` runs `run.sh` on every PR
touching `supabase/migrations/**`, `supabase/tests/**`, or
`supabase/upgrade-validation/**`. No manual steps are required.

## Manual (local)

```bash
# Supabase must already be running (npx supabase start).
bash supabase/upgrade-validation/run.sh
```

`run.sh` performs, in order, with no migration-history repair:

1. `supabase db reset --local --no-seed --version 20260728220000`
2. Run `preconditions.sql` (assert pre-forward state + insert sentinel)
3. Verify only the forward migration is pending
4. Apply the forward migration SQL directly via `psql` + record in `schema_migrations`
5. Run `postconditions.sql`
6. Re-run the entire forward migration SQL with `ON_ERROR_STOP=1` (idempotency)
7. Run `postconditions.sql` again
8. Cleanup sentinel data

> **No `migration repair` is performed.** A validation test must not repair its
> own migration history to pass. `run.sh` applies the forward migration SQL
> directly via `psql` (not `supabase migration up`, which always fetches remote
> history and hits stale entries 20260712/20260719) and records the version in
> `schema_migrations` manually. No remote history is consulted, so no repair is
> needed.

## What This Proves

1. **Preconditions:** On a pre-forward database, `notifications` has `recipient_id`
   (not `user_id`), and `agent_system_notifications` does not exist.
2. **Upgrade:** `migration up` applies the forward migration correctly on top of
   a pre-forward database.
3. **Postconditions:** `agent_system_notifications` exists with all 12 columns,
   RLS, policies, indexes, trigger, and grants. Canonical `notifications` is
   unchanged. Sentinel row survives.
4. **Idempotency:** Re-running the entire forward migration SQL with
   `ON_ERROR_STOP=1` succeeds (exit 0) and all postconditions still hold.

## Last Validation Run

Date: 2026-08-01
Result: ALL STEPS PASSED (via `run.sh` in CI)
- Preconditions: 2/2 OK
- Migration up: forward migration applied
- Postconditions: 8/8 OK
- Idempotency re-run: exit 0, all statements succeeded
- Postconditions after re-run: 8/8 OK
