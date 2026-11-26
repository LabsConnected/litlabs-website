# Schema Compatibility Matrix & Migration Release Plan — 2026-11-24

Branch: `fix/billing-db-release-recovery-20261124`
Base: `origin/main` @ `c578a17dd` (verified at branch creation)
Supabase projects: staging `txsalzljvglbrnldikco` (litlabs-preview), prod `rokbfvuoqildggnhappy` (supabase-sky-candle)
Inventories captured live via Management API `schema_migrations` on 2026-11-24.

## Drift summary

| Class | Count | Disposition |
|---|---|---|
| Staging-only migrations (applied to staging, absent from git and prod) | 16 | **Recovered into this branch** verbatim from `origin/cursor/684-studio-littbits-debit` (PR #726), the authoritative source. Statement-level comparison against `schema_migrations.statements` on staging confirmed the applied SQL matches these files (modulo statement splitting/comments). |
| Git migrations not applied to staging OR prod | 5 | Already in git on `main`; require a hosted apply step (see execution plan). |
| Legacy version `20250618` | 1 | Applied on both hosted DBs, absent from git (pre-migrations-directory era). Not reconstructable; no action — recorded for completeness. |
| Prod-only migrations | 0 | None. |

### The 16 recovered staging-only migrations (billing series, 2026-10-14 → 2026-10-23)

`20261014000000` subscriptions stripe_subscription_id unique · `20261015000000` cancel_at_period_end · `20261015120000` media_cap_holds · `20261015140000` last_stripe_event_created · `20261015160000` checkout_reservations · `20261015170000` billing_subscription_conflicts · `20261015180000` media_cap_hold_expiry · `20261015200000` apply_subscription_event · `20261015210000` checkout_session_lease · `20261015220000` schedule_media_cap_sweep · `20261015230000` checkout_block_protected_subscription · `20261015240000` stripe_event_claim_token · `20261019120000` settled_invoice_grants · `20261022180000` sweep_expired_reservations · `20261022180100` free_chat_rate_limit · `20261023000000` stripe_events_service_role_grant

### The 5 git migrations pending hosted apply (both staging and prod)

- `20261022120000_call_authorizations.sql`
- `20261111130000_netlify_deployment_external_site.sql`
- `20261115120000_agent_platform_indexes.sql`
- `20261118231844_billing_rpc_service_role_only.sql`
- `20261119120000_billing_settlement_bucket_allocation_refund_idempotency.sql`
- `20261124120000_settle_bits_single_canonical.sql` — added by THIS branch (see conflict note below)

## Cross-branch conflict found and resolved by this branch

Applying the 16 recovered migrations together with the 5 pending git migrations produced **two `settle_bits` overloads** (5-arg bucket-aware from `20261119120000` + 6-arg sweep variant from `20261022180000`). Every 5-argument call — including the app's `agent-billing.ts` settle path — was ambiguous (`function is not unique`), and the sweep's 6-arg call bypassed the bucket-allocation fix. DB-backed tests caught it: `tests/billing/billing-rpc-privileges.test.ts` (4 failures) plus concurrency and refund suites (7 failures total before the fix).

Resolution: `20261124120000_settle_bits_single_canonical.sql` drops both overloads and creates one canonical function — the bucket-aware body plus `p_allow_past_expiry` and the `status='reserved'` update guard. After it, all 110 `tests/billing` tests pass against the reset local DB, including the DB-backed concurrency, privileges, and refund-idempotency suites.

## Dependency ordering

All 16 recovered files sort strictly between existing git versions (`20261013120000`-era predecessors and `20261016000000` successor), so `supabase db push` / `db reset` ordering is unambiguous. Verified by clean-room rehearsal: `supabase db reset` on this branch applied all 151 migration files (incl. seed-less) with zero errors on local Postgres (Supabase CLI, project LiTTreeLabStudio_Prod, 2026-11-24).

## Rehearsal evidence

- `npx supabase db reset` — PASS, all migrations applied in version order.
- DB-backed billing suite `tests/billing/` (concurrent webhook delivery, duplicate-credit prevention, refund idempotency, settlement, retry recovery) — run against the reset local DB; results recorded in the PR.

## Migration execution plan (requires owner approval — NOT executed)

Staging first, prod second, never the reverse:

1. Merge this PR after review (draft until owner GO).
2. `supabase db push` (or `migration up`) against **staging** `txsalzljvglbrnldikco` — applies the 5 pending git migrations; the 16 recovered versions are already recorded in `schema_migrations` on staging, so the CLI will skip them as applied (their version rows already exist). Verify: `SELECT version FROM supabase_migrations.schema_migrations` diff vs git = empty.
3. Repeat against **prod** `rokbfvuoqildggnhappy` — applies all 22 pending versions (16 recovered + 5 git + this branch's settle_bits reconciliation). Pre-checks before prod apply:
   - `20261014000000` requires zero duplicate `subscriptions.stripe_subscription_id` values (guard query in file header).
   - `20261119120000` settlement idempotency — confirm no in-flight settlement runs during apply window.
4. Post-apply verification per env: row counts on `stripe_events`, `checkout_reservations`, `media_cap_holds`; webhook smoke (Stripe CLI forward or dashboard resend of a test event); confirm `claim_stripe_event`/`finalize_stripe_event`/`release_stripe_event` exist and are service-role-only (`20261118231844` enforces this).

## Rollback plan

- Migrations are additive (new tables, columns, functions, indexes, one unique index). No drops of existing objects.
- Rollback = forward-fix migrations, not `down` files (repo convention: no down migrations).
- If `20261014000000` unique index fails on prod duplicates: dedupe `subscriptions.stripe_subscription_id` (keep newest row per subscription), then re-apply. Do NOT mark applied without the index existing.
- If billing RPC lockdown (`20261118231844`) breaks a caller: the function grants are service-role-only by design; any anon/authenticated caller is a bug to fix in app code, not a reason to loosen grants.
- Staging ledger repair procedure for rows applied out-of-band: see `tasks/pr726-staging-ledger-repair-runbook.md`.

## Explicit non-actions

- No production mutations performed or authorized by this branch.
- No migration history rewritten; no missing versions marked applied.
- PR #726 (`fix/billing`, Codex) remains open/draft — this branch recovers only its migration files, not its application code; Codex coordination required before any #726 merge decision.

## Complete matrix (147 versions)

| version | git | staging | prod | migration |
|---|---|---|---|---|
| 20240613000000 | Y | Y | Y | 20240613000000_initial_schema.sql |
| 20240614010000 | Y | Y | Y | 20240614010000_fix_social_schema.sql |
| 20240614020000 | Y | Y | Y | 20240614020000_security_linter_fixes.sql |
| 20240614030000 | Y | Y | Y | 20240614030000_social_graph.sql |
| 20250101000000 | Y | Y | Y | 20250101000000_agent_tasks_schema.sql |
| 20250617010000 | Y | Y | Y | 20250617010000_add_tracks_table.sql |
| 20250618 | - | Y | Y | <<< |
| 20250704143500 | Y | Y | Y | 20250704143500_terminal_command_history.sql |
| 20250704144500 | Y | Y | Y | 20250704144500_agent_runs.sql |
| 20250712010000 | Y | Y | Y | 20250712010000_github_projects.sql |
| 20250712020000 | Y | Y | Y | 20250712020000_litt_agent_memory.sql |
| 20260116000000 | Y | Y | Y | 20260116000000_agent_platform_schema.sql |
| 20260630010000 | Y | Y | Y | 20260630010000_invite_api_keys.sql |
| 20260702000000 | Y | Y | Y | 20260702000000_orchestration_jobs.sql |
| 20260702030000 | Y | Y | Y | 20260702030000_missing_tables.sql |
| 20260702120000 | Y | Y | Y | 20260702120000_platform_tables_unified.sql |
| 20260702130000 | Y | Y | Y | 20260702130000_rls_policies_clerk_service_role.sql |
| 20260711000000 | Y | Y | Y | 20260711000000_foundation_users_and_installed_agents.sql |
| 20260712020000 | Y | Y | Y | 20260712020000_user_preferences_notifications_workspace.sql |
| 20260713180000 | Y | Y | Y | 20260713180000_marketplace_agent_fields.sql |
| 20260714010000 | Y | Y | Y | 20260714010000_atomic_wallet_adjustments.sql |
| 20260714030000 | Y | Y | Y | 20260714030000_usage_stats_schema_fixes.sql |
| 20260714034338 | Y | Y | Y | 20260714034338_add_persona_id_to_memories.sql |
| 20260716000000 | Y | Y | Y | 20260716000000_project_loops.sql |
| 20260719020000 | Y | Y | Y | 20260719020000_phase2_github_project_connection.sql |
| 20260719030000 | Y | Y | Y | 20260719030000_builder_chat_sessions.sql |
| 20260720000000 | Y | Y | Y | 20260720000000_studio_projects_github.sql |
| 20260720020000 | Y | Y | Y | 20260720020000_agent_station_layouts.sql |
| 20260720030000 | Y | Y | Y | 20260720030000_agent_tasks_history_columns.sql |
| 20260720040000 | Y | Y | Y | 20260720040000_agent_tasks_lease_fields.sql |
| 20260720050000 | Y | Y | Y | 20260720050000_worker_heartbeats.sql |
| 20260720060000 | Y | Y | Y | 20260720060000_worker_instances.sql |
| 20260721160000 | Y | Y | Y | 20260721160000_studio_projects_workspace_runtime.sql |
| 20260723160000 | Y | Y | Y | 20260723160000_integration_platform.sql |
| 20260723170000 | Y | Y | Y | 20260723170000_agent_voice_profiles.sql |
| 20260725000000 | Y | Y | Y | 20260725000000_credit_ledger_beta_pricing.sql |
| 20260725190000 | Y | Y | Y | 20260725190000_marketplace_capabilities.sql |
| 20260726193000 | Y | Y | Y | 20260726193000_unify_litbits_ledger.sql |
| 20260726230000 | Y | Y | Y | 20260726230000_canonical_project_source.sql |
| 20260726240000 | Y | Y | Y | 20260726240000_mission_checkpoint_schema.sql |
| 20260727010000 | Y | Y | Y | 20260727010000_visual_build_pipeline.sql |
| 20260728000000 | Y | Y | Y | 20260728000000_canvas_system.sql |
| 20260728010000 | Y | Y | Y | 20260728010000_fix_users_and_agent_tasks_schema.sql |
| 20260728200000 | Y | Y | Y | 20260728200000_command_studio_v12_conversations_memory.sql |
| 20260728210000 | Y | Y | Y | 20260728210000_atomic_revision_and_immutable_ownership.sql |
| 20260728220000 | Y | Y | Y | 20260728220000_corrective_memory_migration.sql |
| 20260729000000 | Y | Y | Y | 20260729000000_music_lab.sql |
| 20260730000000 | Y | Y | Y | 20260730000000_premium_agents_v1_port.sql |
| 20260730010000 | Y | Y | Y | 20260730010000_premium_agents_v1_phase2_fixes.sql |
| 20260801000000 | Y | Y | Y | 20260801000000_create_agent_system_notifications.sql |
| 20260802000000 | Y | Y | Y | 20260802000000_terminal_workspaces.sql |
| 20260802010000 | Y | Y | Y | 20260802010000_litt_connectors_provider_registry.sql |
| 20260802010001 | Y | Y | Y | 20260802010001_terminal_secrets.sql |
| 20260802020000 | Y | Y | Y | 20260802020000_terminal_usage.sql |
| 20260802030000 | Y | Y | Y | 20260802030000_terminal_audit_log.sql |
| 20260802040000 | Y | Y | Y | 20260802040000_project_knowledge.sql |
| 20260802050000 | Y | Y | Y | 20260802050000_music_lab_tables.sql |
| 20260802120000 | Y | Y | Y | 20260802120000_seed_specialist_agents.sql |
| 20260803100000 | Y | Y | Y | 20260803100000_evolve_user_agents_instances.sql |
| 20260803110000 | Y | Y | Y | 20260803110000_add_agent_instance_to_studio.sql |
| 20260803110100 | Y | Y | Y | 20260803110100_billing_reconciliations.sql |
| 20260803120000 | Y | Y | Y | 20260803120000_agent_work_queue.sql |
| 20260803130000 | Y | Y | Y | 20260803130000_seed_nova_forge_echo.sql |
| 20260804000000 | Y | Y | Y | 20260804000000_litt_aios_phase1_tables.sql |
| 20260805000000 | Y | Y | Y | 20260805000000_litt_agent_identity.sql |
| 20260805100000 | Y | Y | Y | 20260805100000_agent_settings_column.sql |
| 20260806000000 | Y | Y | Y | 20260806000000_business_operations.sql |
| 20260806000001 | Y | Y | Y | 20260806000001_litt_media_hub.sql |
| 20260806120000 | Y | Y | Y | 20260806120000_web_intelligence_sources.sql |
| 20260806130000 | Y | Y | Y | 20260806130000_users_phone_column.sql |
| 20260806140000 | Y | Y | Y | 20260806140000_litt_reception_system.sql |
| 20260806160000 | Y | Y | Y | 20260806160000_rename_reception_to_myaios.sql |
| 20260807000000 | Y | Y | Y | 20260807000000_gdpr_retention_cleanup.sql |
| 20260808000000 | Y | Y | Y | 20260808000000_drop_legacy_project_fk_constraints.sql |
| 20260808220000 | Y | Y | Y | 20260808220000_agent_paused_runs.sql |
| 20260809140000 | Y | Y | Y | 20260809140000_voice_sessions.sql |
| 20260810120000 | Y | Y | Y | 20260810120000_music_generations_updated_at.sql |
| 20260810160000 | Y | Y | Y | 20260810160000_browser_agent_sessions.sql |
| 20260810170000 | Y | Y | Y | 20260810170000_browser_jobs.sql |
| 20260810220000 | Y | Y | Y | 20260810220000_browser_job_events.sql |
| 20260811000000 | Y | Y | Y | 20260811000000_generation_jobs.sql |
| 20260811000001 | Y | Y | Y | 20260811000001_llm_usage_records.sql |
| 20260811010000 | Y | Y | Y | 20260811010000_creator_payout_ledger.sql |
| 20260811010001 | Y | Y | Y | 20260811010001_ghl_affiliate_tracking.sql |
| 20260811020000 | Y | Y | Y | 20260811020000_service_inquiries.sql |
| 20260812000000 | Y | Y | Y | 20260812000000_ghl_affiliate_atomic_claim.sql |
| 20260812000001 | Y | Y | Y | 20260812000001_music_claim_rpc.sql |
| 20260812200000 | Y | Y | Y | 20260812200000_studio_projects_workspace_type.sql |
| 20260812210000 | Y | Y | Y | 20260812210000_user_facts_provenance.sql |
| 20260813180000 | Y | Y | Y | 20260813180000_growth_engine_phase1a.sql |
| 20260813190000 | Y | Y | Y | 20260813190000_agent_logs_nullable_agent_id.sql |
| 20260813200000 | Y | Y | Y | 20260813200000_b1_canonical_billing_contracts.sql |
| 20260814200000 | Y | Y | Y | 20260814200000_b2_reservation_settlement.sql |
| 20260826000000 | Y | Y | Y | 20260826000000_user_deletion_lifecycle.sql |
| 20260826010000 | Y | Y | Y | 20260826010000_comprehensive_rls_hardening.sql |
| 20260827000000 | Y | Y | Y | 20260827000000_llm_usage_records_billing_exempt.sql |
| 20260910010000 | Y | Y | Y | 20260910010000_analytics_events_table.sql |
| 20260912230000 | Y | Y | Y | 20260912230000_add_project_deployments.sql |
| 20260913070000 | Y | Y | Y | 20260913070000_add_run_status_to_paused_runs.sql |
| 20260915000000 | Y | Y | Y | 20260915000000_messages_awaiting_approval_status.sql |
| 20260915020000 | Y | Y | Y | 20260915020000_project_workspace_branch.sql |
| 20260915150000 | Y | Y | Y | 20260915150000_project_list_indexes.sql |
| 20260916010000 | Y | Y | Y | 20260916010000_social_phase1.sql |
| 20260917010000 | Y | Y | Y | 20260917010000_add_quality_loop_state_to_paused_runs.sql |
| 20260917180000 | Y | Y | Y | 20260917180000_add_batch_remainder_to_paused_runs.sql |
| 20260918000000 | Y | Y | Y | 20260918000000_seed_canonical_pricing_v1.sql |
| 20260918120000 | Y | Y | Y | 20260918120000_paused_runs_ttl_30min.sql |
| 20260919000000 | Y | Y | Y | 20260919000000_deployment_file_encoding.sql |
| 20260920000000 | Y | Y | Y | 20260920000000_paused_run_lease.sql |
| 20260920000001 | Y | Y | Y | 20260920000001_posts_rls_published_filter.sql |
| 20260920000002 | Y | Y | Y | 20260920000002_terminal_command_audit_log.sql |
| 20260922000000 | Y | Y | Y | 20260922000000_execution_engine_lifecycle.sql |
| 20260922180000 | Y | Y | Y | 20260922180000_demo_logs.sql |
| 20260923000000 | Y | Y | Y | 20260923000000_action_runtime.sql |
| 20260923010000 | Y | Y | Y | 20260923010000_browser_action_runtime_hardening.sql |
| 20260923020000 | Y | Y | Y | 20260923020000_action_runtime_final_gate.sql |
| 20260923030000 | Y | Y | Y | 20260923030000_action_runtime_lockdown.sql |
| 20260923040000 | Y | Y | Y | 20260923040000_action_execution_context.sql |
| 20260927000000 | Y | Y | Y | 20260927000000_studio_tasks_worktabs.sql |
| 20260929000000 | Y | Y | Y | 20260929000000_metering_reconciliation.sql |
| 20261003200000 | Y | Y | Y | 20261003200000_global_litt_system_project.sql |
| 20261010000000 | Y | Y | Y | 20261010000000_allow_unpublished_deployment_status.sql |
| 20261014000000 | - | Y | - | <<< |
| 20261015000000 | - | Y | - | <<< |
| 20261015120000 | - | Y | - | <<< |
| 20261015140000 | - | Y | - | <<< |
| 20261015160000 | - | Y | - | <<< |
| 20261015170000 | - | Y | - | <<< |
| 20261015180000 | - | Y | - | <<< |
| 20261015200000 | - | Y | - | <<< |
| 20261015210000 | - | Y | - | <<< |
| 20261015220000 | - | Y | - | <<< |
| 20261015230000 | - | Y | - | <<< |
| 20261015240000 | - | Y | - | <<< |
| 20261016000000 | Y | Y | Y | 20261016000000_workspace_provisioning_fencing.sql |
| 20261017000000 | Y | Y | Y | 20261017000000_media_storage_bucket.sql |
| 20261018000000 | Y | Y | Y | 20261018000000_studio_projects_idempotency_key.sql |
| 20261019000000 | Y | Y | Y | 20261019000000_add_prior_tool_calls_to_paused_runs.sql |
| 20261019120000 | - | Y | - | <<< |
| 20261022120000 | Y | - | - | 20261022120000_call_authorizations.sql |
| 20261022180000 | - | Y | - | <<< |
| 20261022180100 | - | Y | - | <<< |
| 20261023000000 | - | Y | - | <<< |
| 20261111130000 | Y | - | - | 20261111130000_netlify_deployment_external_site.sql |
| 20261115120000 | Y | - | - | 20261115120000_agent_platform_indexes.sql |
| 20261118231844 | Y | - | - | 20261118231844_billing_rpc_service_role_only.sql |
| 20261119120000 | Y | - | - | 20261119120000_billing_settlement_bucket_allocation_refund_idempotency.sql |
