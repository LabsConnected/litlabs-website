# Upgrade-Path Validation

These scripts validate the REAL upgrade path for the `agent_system_notifications`
forward migration (`20260801000000`). They are NOT pgTAP tests and are NOT run
by `supabase test db` — they require a specific database state and must be
executed manually in order.

## Procedure

```powershell
# 1. Reset to the migration immediately before 20260801000000
npx supabase db reset --local --no-seed --version 20260728220000

# 2. Assert preconditions + insert sentinel notification row
Get-Content "supabase\upgrade-validation\preconditions.sql" -Raw |
  docker exec -i supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1

# 3. Repair stale remote migration entries (if needed)
npx supabase migration repair --local --status reverted 20260712 20260719

# 4. Apply pending migrations (including the forward migration)
npx supabase migration up --local --include-all

# 5. Assert postconditions (table exists, sentinel survived, schema intact)
Get-Content "supabase\upgrade-validation\postconditions.sql" -Raw |
  docker exec -i supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1

# 6. Re-run the ENTIRE forward migration SQL with ON_ERROR_STOP=1 (idempotency)
Get-Content "supabase\migrations\20260801000000_create_agent_system_notifications.sql" -Raw |
  docker exec -i supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1

# 7. Re-insert sentinel (postconditions.sql cleans up after itself)
docker exec supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.users (clerk_id, email) VALUES ('sentinel_upgrade_test', 'sentinel-upgrade@test.local')
  ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email RETURNING id;"

# 8. Get the user ID from step 7 and insert sentinel notification
docker exec supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.notifications (recipient_id, type, entity_type, entity_id, content)
  SELECT id, 'follow', 'user', id, 'SENTINEL_UPGRADE_TEST_ROW'
  FROM public.users WHERE clerk_id = 'sentinel_upgrade_test';"

# 9. Assert postconditions again (proves idempotency didn't break anything)
Get-Content "supabase\upgrade-validation\postconditions.sql" -Raw |
  docker exec -i supabase_db_LiTTreeLabStudio_Prod psql -U postgres -d postgres -v ON_ERROR_STOP=1

# 10. Full reset to restore normal state
npx supabase db reset --local --no-seed
```

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
Result: ALL STEPS PASSED
- Preconditions: 2/2 OK
- Migration up: 3 migrations applied (20260712, 20260719, 20260801000000)
- Postconditions: 8/8 OK
- Idempotency re-run: exit 0, all 12 statements succeeded
- Postconditions after re-run: 8/8 OK
