# Staging `txsalzljvglbrnldikco` — ledger repair + grant-gap runbook

**Scope: staging only. No production. No changes made.** Both artifacts below are proposals awaiting owner approval.

**Authoritative procedure — READ FIRST.** §O (with the §N ordering decisions) is the single operative execution manifest. §§B, F–I are the chronological decision record and are SUPERSEDED wherever they differ — concretely:
- (a) Per-file `apply_one` (§O.1) is the only apply mechanism; every `db push` apply path in §B step 5, §F step 4, and §I is superseded (`db push` survives only as the §O.2 dry-run gate).
- (b) The `stripe_events` service_role grant is committed (`fbe71e83`, version `20261023000000`) and applies as the LAST file inside Checkpoint 5 — there is no separate "Checkpoint 5b" window (§N.1).
- (c) Checkpoint 5 = 11 files ending `20261023000000` (§O.5); §I's 10-file list and its "20261022180100 newest" post-validation expectation are superseded.

## A. `stripe_events` privilege repair (PROPOSED migration — not pushed)

Root cause: `20260725000000_credit_ledger_beta_pricing.sql` creates `public.stripe_events` but grants only `EXECUTE` on three functions — never table privileges. Prod/staging work because `service_role` table grants were applied out-of-band (consistent with `supabase/migrate_fix_all.sql`). A fresh `supabase start` chain reproduces `permission denied for table stripe_events` on the webhook claim path.

```sql
-- PROPOSED: 2026MMDDHHMMSS_stripe_events_service_role_grant.sql
-- Idempotent: GRANT/REVOKE statements are safe to re-run.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_events TO service_role;
GRANT SELECT ON TABLE public.stripe_events TO anon, authenticated; -- read-only ledger visibility; tighten if policy prefers service-only
REVOKE INSERT, UPDATE, DELETE ON TABLE public.stripe_events FROM anon, authenticated;
COMMIT;
```

Privilege tests (add to `tests/billing/` or `supabase/tests/`): assert `information_schema.table_privileges` includes `service_role INSERT` for `stripe_events`; assert anon cannot INSERT (privilege absent + RLS deny); assert `claim_stripe_event` RPC succeeds via service role.

Local verification already done: identical GRANT applied to the local `supabase start` DB cleared `permission denied for table stripe_events` — claim proceeded to the next stage (proof the grant is the fix).

## B. Orphan-ledger repair sequence (NOT EXECUTED)

Evidence: `supabase_migrations.schema_migrations` dump — 5 remote-only versions are `<canonical>_staging` copies of repo files (names verified: `add_project_deployments_staging`, `action_runtime_base_staging`, `browser_action_runtime_hardening_staging`, `action_runtime_final_gate_staging`, `action_runtime_lockdown_staging`; object signatures match canonical files). Canonical files verified idempotent.

**Preflight**
1. Supabase dashboard → Backups → create physical backup of `txsalzljvglbrnldikco`; note snapshot id.
2. `supabase link --project-ref txsalzljvglbrnldikco` in a clean worktree.
3. `supabase migration list --linked` → confirm still 8 remote-only rows (5 orphans + 3 on-main).

**Repair (per orphan, statements are ledger-metadata only — no DDL)**
```bash
supabase migration repair --status reverted \
  20261010111740 20261011234155 20261011234157 20261011234232 20261011234233
```
Rationale: orphans are duplicate applications of canonical files under regenerated versions. Marking them `reverted` is metadata-only (it does NOT drop their objects); the canonical files then apply idempotently via `db push`. Alternative (if audit prefers keeping applied rows): author 5 alias files with orphan versions + mark `applied`; rejected — duplicates ~50KB of SQL and splits history.

**Apply**
4. `supabase db push --dry-run` — must now list pending versions cleanly (41 local-only; no `LegacyDbPushMissingLocalError`).
5. ~~`supabase db push`~~ — SUPERSEDED by §O.1: per-file `apply_one` (psql + `repair --status applied`) with checkpoint gating. `db push` is never used to apply during Checkpoints 1–5.

**Validation queries (post-apply, read-only)**
```sql
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN
 ('20260912230000','20260923000000','20260923010000','20260923020000','20260923030000',
  '20261019120000','20261022180000','20261022180100') ORDER BY 1;  -- expect 8 rows
SELECT proname, pronargs FROM pg_proc WHERE proname IN
 ('settle_bits','sweep_expired_reservations','consume_free_chat_limit') ORDER BY 1,2;
-- expect settle_bits with 6 args
SELECT * FROM public.consume_free_chat_limit('probe', 20, 500);  -- expect allowed=true
SELECT * FROM public.sweep_expired_reservations();               -- expect all-zero counts
```

**Rollback**
- Orphan repair: `supabase migration repair --status applied <5 orphan versions>` restores ledger rows (metadata-only, objects untouched throughout).
- New migrations: `DROP FUNCTION public.consume_free_chat_limit` (app fails closed); re-apply 5-arg `settle_bits` from `20260814200000`, drop `sweep_expired_reservations`, restore `expire_stale_reservations`; the `littbits-exchange-v2-100-unapproved` row is inert — delete-by-id or leave.
- Full restore: Supabase dashboard → Backups → restore preflight snapshot.

**Failure conditions — STOP if:**
- `db push --dry-run` still reports missing locals after repair (means more drift than mapped — re-dump ledger).
- Any `CREATE`/re-apply errors on canonical files (means staging objects diverge from canonical definitions — freeze and diff `pg_dump -s` output).
- `migration list` shows new remote-only rows appearing during the work (concurrent applier on staging — coordinate before continuing).

## C. Out-of-band permission drift (assessment)

Confirmed gap: `stripe_events` service-role table grant (above). Method for full sweep: `supabase db dump --linked -s public` (staging schema) vs locally-reset schema, diff `information_schema.table_privileges` + `pg_policies` — recommend running this comparison before the apply step; report any additional out-of-band grants as candidates for repair migrations like (A).

## D. v2 pricing inertness — VERIFIED

- `PRICING_POLICIES['littbits-exchange-v2-100-unapproved']` has `approval: "UNAPPROVED"`; `ACTIVE_LLM_POLICY_ID = littbits-exchange-v1` is pinned by a test that fails if flipped (`684-followup.test.ts`).
- DB row (in unapplied sweep migration): `effective_from '2099-01-01'`, `approved_by 'UNAPPROVED:pending-owner-economics-review'` — a date-ordered reader cannot treat it as live.
- No code path reads the v2 row as active; `llm-cost-engine` uses `LLM_LANE_BITS_PER_USD` = active policy constant.

## E. Main-target verification plan (no merge, no protection changes)

1. Keep #726 stacked; when the stack is merge-bound, retarget the draft to `main` — triggers full required CI honestly (no workflow edits).
2. Interim: `workflow_dispatch` runs (already proven for build/billing-db/migration-reproducibility on the branch SHA).
3. Optional zero-risk path: open a throwaway DRAFT PR `cursor/684-studio-littbits-debit → main` labeled "CI verification only — do not merge", close it after checks report. Adds no merge risk and leaves protections untouched.

---

## F. Recovery gate — executed 2026-10-23 (read-only)

**Target verified:** `txsalzljvglbrnldikco` = litlabs-preview, ACTIVE_HEALTHY, PG 17.6.1.155, us-east-1, db.txsalzljvglbrnldikco.supabase.co.

**Backup bundle captured:**
- `C:\LiTT\Worktrees\pr726-staging-backup\schema-20261023.sql` (476KB, 13,802 lines)
- `C:\LiTT\Worktrees\pr726-staging-backup\data-20261023.sql` (3.6MB, 13,741 lines)
- `.scratch-ledger.sql` (supabase_migrations rows incl. statements+names) — REQUIRED: standard `db dump` does NOT cover `supabase_migrations` schema
- `supabase migration list --linked` output (146-row ledger)

**Restore rehearsal (isolated postgres:17 `staging_restore_test`):**
- Schema: 2,352 objects loaded; 163 public tables + 65 functions incl. `stripe_events`, `credit_ledger`, `credit_reservations`, `reserve_bits`
- Data: loaded clean under `SET session_replication_role='replica'` (FK-ordering workaround); verified users=47, credit_ledger=25, subscriptions=2, stripe_events=31
- **What a logical dump CANNOT restore:** cluster roles (anon/authenticated/service_role/supabase_* — Supabase-managed, exist on any real target), `auth`/`extensions`/`storage`/`vault`/`realtime` platform schemas (102 auth errors + 3 extensions + vault — all expected on plain PG), `supabase_migrations` schema itself (captured separately above), pg_cron jobs, publication subscriptions, secrets/vault contents, storage object binaries. None of these are affected by the repair plan — the repair is ledger-metadata + additive grants only.
- 242 `role "postgres"` owner-assignment errors are plain-container noise; Supabase targets have these roles natively.

**Ledger state re-verified (worktree, link = txsalzljvglbrnldikco):** 8 remote-only unchanged [5 proven `*_staging` orphans + 3 on-main versions], 41 local-only pending. NOTE: a stray CLI run from a different directory context surfaced a `20261004015352` remote-only row from ANOTHER project's ledger — the linked target must be re-confirmed at execution time (`supabase link --project-ref txsalzljvglbrnldikco` + `migration list` as preflight step 0, fail fast if the remote-only set ≠ the documented 8).

**Grant sufficiency:** verified on live PostgREST — service_role-only `GRANT SELECT,INSERT,UPDATE ON stripe_events` satisfied the webhook claim path (13/13 scenarios); anon/authenticated need nothing (deny-all RLS policies already govern them).

**Ordered execution plan:**
0. `supabase link --project-ref txsalzljvglbrnldikco`; `migration list` → assert remote-only == documented 8. STOP if different.
1. CHECKPOINT: re-run schema+data+ledger dumps into a timestamped dir; record row counts (users/credit_ledger/stripe_events).
2. `supabase migration repair --status reverted 20261010111740 20261011234155 20261011234157 20261011234232 20261011234233` (metadata-only).
3. `supabase db push --dry-run` → must show pending canonical versions, no missing-local error. STOP if error.
4. Apply pending migrations in version order — SUPERSEDED to per-file `apply_one` per §O.1 (the `db push` full-set option is withdrawn).
5. Validation queries (§B): proname checks, `consume_free_chat_limit` probe, `sweep_expired_reservations` zero-count, ledger row spot-check — SUPERSEDED by §O.6 (writer probes run inside BEGIN…ROLLBACK).
6. `stripe_events` service_role grant — RESOLVED: committed `fbe71e83` as `20261023000000`; applies as the last file inside Checkpoint 5 per §N.1 (no separate 5b window).
7. Recovery: `migration repair --status applied <5 orphans>` re-marks ledger; snapshot restore path = restore rehearsal procedure (replica mode for data). No true irreversibles.

**Collision check:** zero n8n/replay migrations exist in the repo — no overlap with Muse's n8n work. Coordinate anyway: schedule the repair window when no one else is applying staging migrations.

## G. Staging-only GO request (pending authorization)

GO for exactly: §O Checkpoints 0–5 (preflight + orphan `reverted` repair + per-file `apply_one` of the 42 enumerated versions incl. the committed grant at CP5 tail + §O.6 validation) — on `txsalzljvglbrnldikco` ONLY, inside a scheduled window, with the §O.2 backup bundle re-captured at CP0. (Earlier framing — "§B step 0–5 + §A grant" — superseded; same scope, §O is the operative sequence.)

## H. Final safety review (2026-10-23) — ledger re-verified on txsalzljvglbrnldikco: 8 remote-only, 41 local-only, 96 matched.

Ordered pending set with risk class (all statements verified — "destructive" flags are commented rollback blocks; the only live DROP is a guarded `DROP CONSTRAINT IF EXISTS` on mission_runs_status_check):

LOW (additive columns/tables/indexes/seeds): 20260827000000, 20260910010000, 20260913070000, 20260915020000, 20260915150000, 20260917010000, 20260917180000, 20260918000000, 20260918120000, 20260919000000, 20260920000000, 20260920000001, 20260920000002, 20260922180000, 20260927000000, 20260929000000, 20261003200000, 20261010000000, 20261014000000, 20261015000000

ORPHAN-REDUNDANT (re-apply idempotently over already-present objects; guarded UPDATE/INSERT re-run harmlessly): 20260912230000, 20260923000000, 20260923010000, 20260923020000, 20260923030000

MEDIUM (guarded data ops / function replacement): 20260916010000 (social backfill UPDATEs), 20260922000000 (DROP CONSTRAINT IF EXISTS + lifecycle), 20260923040000, 20261015210000, 20261015220000 (pg_cron NOTICE path), 20261015230000, 20261019120000 (replaces apply_subscription_event — must run AFTER 20261015200000)

BILLING-CORE (highest attention — reservation/conflict machinery, still additive-by-guard): 20261015120000, 20261015140000, 20261015160000, 20261015170000, 20261015180000, 20261015200000, 20261015240000, 20261022180000, 20261022180100

Dependency hard-stops: 20261019120000 requires 20261015200000 applied first (it replaces that function body); sweep+rate-limit (2026102218*) require rate_limit_store + credit_reservations (verified present on staging); free-chat RPC must exist before free chat is reachable (fail-closed by design).

Orphan repair safety: `migration repair --status reverted` writes ONLY supabase_migrations rows; zero application-object changes. Canonical re-application then no-ops over existing objects.

Restore-rehearsal limitations (honest scope): proved logical-restore viability of public-schema structure + data into plain Postgres. Did NOT prove: full Supabase platform recovery (managed roles, auth/storage/vault/realtime schemas, cron jobs, publications, storage binaries, edge config) — those belong to Supabase platform recovery, outside this plan's scope and unaffected by it.

Independence note: no concurrent-agent activity detectable on the ledger across this session's repeated snapshots (remote-only set stable at the same 8). Execution still requires a human-confirmed quiet window.

STOP conditions (execution): remote-only set ≠ the 8 documented; dry-run reports missing-local; any CREATE error on canonical files (objects diverged); ledger rows appear during execution; backup artifacts missing/unreadable.

## I. Execution manifest (SUPERSEDED by §N–O — retained as decision record; do not execute from this section)

**Checkpoint 0 — preflight (read-only):**
- `supabase link --project-ref txsalzljvglbrnldikco` → assert ref + `migration list` remote-only == the 8 documented versions. STOP otherwise.
- Re-capture backup bundle (schema+data+ledger+list) to a fresh timestamped dir. STOP if any artifact fails.
- `SELECT extname FROM pg_extension WHERE extname='pg_cron'` on staging — DECISION POINT: if present, `20261015220000` will schedule the hourly media-cap sweep; if absent, NOTICE only. Owner decides before proceeding.
- Human-confirmed exclusive migration window (cannot be verified programmatically — required sign-off).

**Checkpoint 1 — ledger repair (metadata-only, reversible):**
`supabase migration repair --status reverted 20261010111740 20261011234155 20261011234157 20261011234232 20261011234233`
Validate: `migration list` shows the 5 as reverted; zero object changes (objects remain — proven present in dump §F).

**Checkpoint 2 — orphan-redundant reapply:** versions 20260912230000, 20260923000000/3010000/3020000/3030000 — idempotent over existing objects. Validate: tables+functions present, ledger rows applied.

**Checkpoint 3 — LOW additive set** (20 versions: 20260827000000…20261015000000 per §H). Validate per-file NOTICE-only + new objects exist.

**Checkpoint 4 — MEDIUM set** (20260916010000 social backfill, 20260922000000, 20260923040000, 20261015210000, 20261015220000, 20261015230000). Validate row counts stable; mission_runs constraint widened.

**Checkpoint 5 — BILLING-CORE ordered apply:** 20261015120000 → 20261015140000 → 20261015160000 → 20261015170000 → 20261015180000 → 20261015200000 → 20261015240000 → **20261019120000** (must follow 20261015200000) → 20261022180000 → 20261022180100.

**Post-validation queries (expected results):**
```sql
SELECT proname, pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('reserve_bits','settle_bits','release_bits','sweep_expired_reservations','consume_free_chat_limit','apply_subscription_event','claim_stripe_event') ORDER BY 1,2;
-- expect settle_bits 6-arg present; sweep_expired_reservations 2-arg; consume_free_chat_limit 3-arg
SELECT * FROM public.consume_free_chat_limit('preflight-probe', 20, 500);      -- allowed=true
SELECT * FROM public.sweep_expired_reservations();                            -- all-zero counts
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY 1 DESC LIMIT 12;
-- expect 20261022180100 newest applied
SELECT count(*) FROM public.credit_ledger;   -- unchanged from checkpoint-0 count (billing data untouched)
```
App-level post-checks (read-only): reserve→release roundtrip via existing test user, `get_available_balance` unchanged, stripe webhook claim function callable, reservation expiry still counted by expires_at<now(), free chat 429s absent → limiter live.

**Recovery procedures:** repair reversal (`--status applied` on orphans); additive objects drop by name; data mutations (social/execution backfills) restored from data-2026MMDD.sql rows under replica mode; full logical restore = schema→data w/ replica mode (rehearsed §F — public-schema only; platform objects are Supabase-managed, unaffected).

**Irreversible exposures:** none in the plan. Largest blast radius = data mutations in Checkpoint 4 (guarded UPDATEs on posts/studio_projects/mission_runs — recoverable from data dump) and `UPDATE action_runs` re-run in Checkpoint 2 (idempotent re-assertion, already applied state).

## J. stripe_events grant placement — RESOLVED, see §N.1 / §O

`stripe_events` service_role grant — **committed** `fbe71e83` on `cursor/684-studio-littbits-debit` as `supabase/migrations/20261023000000_stripe_events_service_role_grant.sql` (`GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_events TO service_role`). Execution position: final file of Checkpoint 5's apply sequence, before post-validation (§N.1). Earlier proposals ("Checkpoint 5 tail via db push", standalone "5b") are superseded.

## K. Checkpoint 0 results (executed read-only, authorized 2026-10-23)

- Ledger stable: remote-only = the documented 8; matched = 96; local-only = 41 at Checkpoint-0 time (42 post-fbe71e83 grant commit — §N.3).
- Backup bundle present + integrity-checked (schema 476,106 B; data 3,617,767 B; ledger artifact in worktree).
- **pg_cron is NOT installed on staging** (schema dump extension list: pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp only; no cron schema, no cron.job). `20261015220000` therefore takes the NOTICE-only path on staging — it CANNOT schedule the media-cap sweep there. The same decision point must be re-checked on production, where pg_cron status is unknown — add to the production checklist.
- Existing `purge_expired_data` function is pg_cron-designed but unscheduled — consistent with no pg_cron.
- No concurrent-applier signal: ledger identical across all session snapshots. Exclusive window still requires human coordination (Devin = executor, Muse = independent reviewer — PR #727 n8n replay work shares the staging ledger).

**Validation-query reclassification (correcting an earlier error):** the "read-only" post-checks contained writers. Final split —
  READ-ONLY (catalog/state): proname/pronargs signature check; information_schema.table_privileges for stripe_events; pg_policies deny-all presence; counts on credit_ledger/credit_reservations/stripe_events; migration list row check.
  CONTROLLED TRANSACTIONS (BEGIN … ROLLBACK, single psql session, or dedicated probe identity + documented cleanup): `consume_free_chat_limit('preflight-probe',…)` — inserts/updates public.rate_limit_store; `sweep_expired_reservations()` — may settle/release expired reservations + write credit_ledger/billing_reconciliations; reserve→release roundtrip — writes credit_reservations+credit_ledger. These run ONLY inside `BEGIN; … ROLLBACK;` so they verify behavior without persisting state.
  NOTE: `sweep_expired_reservations()` also sweeps any REAL expired reservations that exist — inside a rolled-back transaction it proves correctness but staging's actual expired rows remain untouched; their real sweep waits for the reservation-sweep approval (env flag stays unset).

**stripe_events grant proposal:** see proposed_stripe_events_service_role_grant.sql in the backup dir — service_role SELECT/INSERT/UPDATE only, no anon/authenticated, explicit rollback.

**Confirmations:** all artifacts target txsalzljvglbrnldikco only; no production object was read or written beyond read-only schema/state queries on staging; no credentials, pricing, merges, deploys, or activations.

## L. Final reconciliation answers (pre-execution closeout, 2026-10-23)

**Count reconciliation:** live `migration list` JSON is authoritative — 8 remote-only, 41 local-only, 96 matched. Any earlier "6" figure was a truncated/older view; the ledger has been byte-identical across every snapshot this session.
- **Repair targets = 5:** 20261010111740, 20261011234155, 20261011234157, 20261011234232, 20261011234233 — the `*_staging` orphans. Safe to mark `reverted` (metadata-only; objects proven present in dump).
- **NOT repair targets = 3:** 20261016000000, 20261017000000, 20261018000000 — applied on staging from main's real files (canonical dir has them; staging objects exist). Resolution = copy the three files into the worktree's `supabase/migrations/` → versions become matched pairs → never re-applied. Verified safe: `20261017000000` contains an unguarded `insert into storage.buckets` — it must NOT re-execute; file-presence prevents exactly that.
- `migration repair --status reverted` on the 3 main versions is FORBIDDEN — it would misrecord genuinely-applied migrations.

**Dry-run:** `supabase db push --dry-run` currently returns `LegacyDbPushMissingLocalError` naming exactly those 8 — the gate. After Checkpoint 1 (5 reverts) + file-presence for the 3, the apply set is the pending versions in ascending order (was 41 at this writing; **now 42** post-`fbe71e83` — full list §N.3/§O.5; billing-core tail ordering hard-required: …15200000 → …19120000 → …22180000 → …22180100 → 20261023000000).

**Privilege sufficiency (final):** proposed grant corrected to `GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_events TO service_role` — the three claim functions are SECURITY INVOKER and perform SELECT/UPDATE/DELETE; the route also does direct `.insert()`. EXECUTE already granted to service_role on the three functions. Nothing for anon/authenticated.

**Side-effect scan (all 41, comment-stripped):** zero NOTIFY/PUBLICATION/HTTP/ALTER SYSTEM/CREATE EXTENSION; one guarded `cron.schedule` (20261015220000 — inert on staging, no pg_cron); normal POLICY/SECDEF/one updated_at TRIGGER only. No hidden operational activations.

**Rollback coverage:** every mutating migration's target tables are in the data dump; prior function/constraint definitions are in the schema dump (re-apply to restore); additive objects drop by name; ledger repair reversible via `--status applied`. Coverage = all 41.

**Exclusive window:** not obtainable programmatically — requires owner's written confirmation that Muse/PR #727 and all other agents hold off the staging ledger during execution. Devin executes; Muse independently reviews each checkpoint result.

## M. Muse reviewer findings — incorporated (2026-10-23)

**pg_cron resolution:** staging has NO pg_cron (schema dump extension list is complete and lacks it; no cron schema or cron.job). `20261015220000` therefore applies under `db push` normally, executes only its NOTICE branch, records applied → zero scheduling, zero ledger drift. No exclusion or file edit needed for staging. Production checklist: verify `pg_extension` there; if pg_cron exists, gate the schedule call behind an explicit owner-seeded marker before applying — do NOT let it auto-activate.

**stripe_events effective grants on staging (authoritative from pg_dump ACLs):** `GRANT ALL ... TO anon | authenticated | service_role` already present (lines 13498–13500) — Supabase default privileges applied these at table creation. RLS deny-all policies gate anon/authenticated; service_role path functions (verified live: webhook claim works). The proposed grant migration is therefore a NO-OP on staging but required for repo parity so fresh local/CI stacks reproduce hosted behavior. Keep it (service_role SELECT/INSERT/UPDATE/DELETE) — on staging it changes nothing.

**CI permission-denial root cause (billing_subscription_conflicts / stripe-webhook-local-db):** proven fixture gap, NOT a grants problem — invoice lines carried `price:""` so settledInvoiceCredit granted nothing under the new invoice-priced-plan rule (fixed in 50f54fec + 605afa23; billing-db run 39876147541 green). The local-stack `permission denied` signature was the missing table grant — a disposable-env gap only; hosted staging already grants ALL. apply_subscription_event is SECURITY DEFINER (function-internal work; caller needs EXECUTE only, already granted). No additional grants required anywhere.

**Validation classification:** confirmed — consume_free_chat_limit, reserve/settle/release, sweep_expired_reservations, claim_stripe_event all write; probes must run in BEGIN…ROLLBACK or against dedicated probe identities with documented cleanup.

**Coordination:** Devin = sole staging migration executor; Muse = independent reviewer; PR #727 n8n work frozen on the staging ledger during the window.

## N. Final staging execution reconciliation (pre-execution hold maintained)

### N.1 `stripe_events` grant — COMMITTED `fbe71e83`; ordering resolved: final file inside Checkpoint 5's apply sequence, before post-validation

Status change (supersedes the earlier "absent file / Checkpoint 5b" plan): owner approved the file — committed as `20261023000000_stripe_events_service_role_grant.sql` in commit `fbe71e83` on `cursor/684-studio-littbits-debit` (PR #726 head). It is now a real pending version — the 42nd and version-max entry in the pending set.

**Ordering resolution (Muse recommendation adopted):** the grant applies as the LAST file of Checkpoint 5's apply sequence — after `20261022180100`, before Checkpoint 5's post-validation queries — because post-validation includes the `claim_stripe_event` probe and app-level webhook-claim check, which write `stripe_events`. Placing the grant inside the CP5 apply window (a) preserves version order, (b) guarantees no validation touches `stripe_events` before the grant lands, (c) keeps it an explicit, enumerated, owner-approved step — never an implicit `db push` passenger. There is no longer a separate "5b" window.

**Checkpoint 5 apply sequence (11 files, strict version order):**
`20261015120000 → 20261015140000 → 20261015160000 → 20261015170000 → 20261015180000 → 20261015200000 → 20261015240000 → 20261019120000 → 20261022180000 → 20261022180100 → 20261023000000`

**Grant apply procedure (inside Checkpoint 5, after the 10 billing-core files):**
1. Pre-state ACL capture (mandatory, immediately before applying the grant file):
   ```sql
   SELECT grantee, privilege_type FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name='stripe_events'
    ORDER BY grantee, privilege_type;
   SELECT relacl FROM pg_class
    WHERE relname='stripe_events' AND relnamespace='public'::regnamespace;
   ```
   Expected staging pre-state (§M, pg_dump ACLs): `GRANT ALL` to anon | authenticated | service_role.
2. Apply `20261023000000_stripe_events_service_role_grant.sql`; record ledger row via `migration repair --status applied 20261023000000` (per-file apply path, §O).
3. Post-state ACL check: must equal pre-state (NO-OP expectation on staging) — minimum service_role ⊇ {S,I,U,D}. Then proceed to CP5 post-validation.
4. **Rollback (privilege-preserving — restores captured pre-state, never a blanket REVOKE):**
   - R1: re-run the step-1 queries → post-state ACL.
   - R2: delta = post-state privileges − pre-state privileges, per grantee.
   - R3: expected delta on staging = ∅ → apply NO privilege changes; rollback is ledger-only: `supabase migration repair --status reverted 20261023000000`.
   - R4: if delta non-empty (drift / env lacking Supabase default privileges), revoke ONLY the delta per grantee — never the full granted set. If pre-state privileges are absent post-state (impossible via GRANT; checked defensively), re-`GRANT` them from the snapshot.
   - R5: verify post-rollback ACL == step-1 pre-state exactly; then `migration repair --status reverted 20261023000000`.
   - The unconditional `REVOKE SELECT, INSERT, UPDATE, DELETE … FROM service_role` is **RETRACTED** — it would strip privileges that pre-existed the migration, leaving the DB worse than the pre-state.

### N.2 Two distinct findings — do not conflate

**Finding A — Stripe invoice-price test-fixture failure (RESOLVED, test-side only).**
- Surface: billing-db CI runs 39873683970, then 39874506581.
- Cause: `invoice.paid` line fixtures carried `price:""`; `settledInvoiceCredit` (migration `20261019120000_settled_invoice_grants.sql`) correctly granted nothing under the invoice-priced-plan rule — the storedPlan fallback it removed was the unpaid-upgrade hole. App/migration code correct; fixtures wrong.
- Tests/commits establishing it: `tests/billing/concurrent-subscription-conflict.integration.test.ts` (idempotent-redelivery case — fixed `50f54fec`, populated `price_details.price` with the plan's price id); `tests/stripe-webhook-local-db.test.ts` (7 `invoice.paid` call sites — fixed `605afa23`, populated `price.id` + `pricing.price_details.price`).
- Resolution proof: billing-db run 39876147541 green. No schema or permission change involved.

**Finding B — `permission denied for table stripe_events` (chain gap, distinct cause).**
- Surface: fresh `supabase start` local stack, webhook claim path (§A) — never a CI failure signature.
- Cause: `20260725000000_credit_ledger_beta_pricing.sql` creates `stripe_events` and grants EXECUTE on the three claim functions but never table privileges; the functions are SECURITY INVOKER so the caller needs S/I/U/D directly.
- Evidence establishing it: local-stack reproduction (§A) cleared by the identical GRANT (claim proceeded — proof the grant is the fix); live-PostgREST sufficiency 13/13 scenarios (§F/§K). The billing-db CI suites (`stripe-event-claim-race`, `stripe-webhook-local-db`) **cannot** detect this gap — `scripts/billing-disposable-db.sh:212` applies `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role` after migrations, masking the missing in-chain grant.
- **Does any permission issue remain?** Hosted staging: NO — pg_dump ACLs show `GRANT ALL … TO anon | authenticated | service_role` already present (Supabase default privileges, §M); the grant is a NO-OP there. Canonical chain: YES, exactly one — the missing table GRANT, closed only by the committed grant file (Checkpoint 5 tail); fresh environments lacking Supabase's default-privilege posture reproduce the denial until then. CI disposable DBs: no issue (explicit shim). anon/authenticated need nothing anywhere — deny-all RLS governs them and no direct privilege is required.

### N.3 Pending-set accounting — all 42 versions explicit (41 + committed grant), no implicit apply surface

Checkpoint mapping (§H risk classes → §I checkpoints; all filenames verified present on the PR branch — zero missing):
- **Checkpoint 2 (5):** 20260912230000, 20260923000000, 20260923010000, 20260923020000, 20260923030000
- **Checkpoint 3 (20):** 20260827000000, 20260910010000, 20260913070000, 20260915020000, 20260915150000, 20260917010000, 20260917180000, 20260918000000, 20260918120000, 20260919000000, 20260920000000, 20260920000001, 20260920000002, 20260922180000, 20260927000000, 20260929000000, 20261003200000, 20261010000000, 20261014000000, 20261015000000
- **Checkpoint 4 (6):** 20260916010000, 20260922000000, 20260923040000, 20261015210000, 20261015220000, 20261015230000
- **Checkpoint 5 (11):** 20261015120000, 20261015140000, 20261015160000, 20261015170000, 20261015180000, 20261015200000, 20261015240000, 20261019120000, 20261022180000, 20261022180100, **20261023000000** (committed `fbe71e83` — version-max tail, applied before post-validation per §N.1)
- Sum: 5 + 20 + 6 + 11 = **42** = the full pending set after the grant commit.
- Ledger-side invariants: preflight asserts remote-only == the documented 8; CP1 handles the 5 `*_staging` orphans via `repair --status reverted`; the 3 on-main versions (20261016000000/17000000/18000000) resolve by file-presence (§L), never by `repair` and never by re-apply (`20261017000000` contains an unguarded `storage.buckets` insert — must not re-execute).

### N.4 Hold status

Devin holds Checkpoints 1–5 pending explicit staging-only authorization. Coordination on record: Devin sole executor; Muse independent reviewer (PASS/BLOCKED on this corrected manifest); PR #727 performs no staging ledger writes during the window; no other agent or process modifies the staging migration ledger. No production changes, deployments, merges, credential modifications, workflow activation, or pricing activation. Production HOLD remains active.

---

## O. Complete execution manifest (Muse review copy — HOLD maintained, nothing executed)

Scope: staging `txsalzljvglbrnldikco` (litlabs-preview, PG 17.6, us-east-1) only. Executor: Devin. Reviewer: Muse. PR #727 writes nothing to the staging ledger during the window.

### O.1 Apply mechanism

Per-file apply + ledger record — this is what makes checkpoint gating possible (a single `db push` cannot pause between risk classes):

```bash
apply_one() {  # $1 = migration filename stem (version_name)
  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "supabase/migrations/$1.sql" \
    && supabase migration repair --status applied "${1%%_*}"
}
```
`ON_ERROR_STOP=1` aborts on the first failing statement; the ledger row is only written after the file applies clean. `db push` is NOT used during Checkpoints 1–5 (except the dry-run gate, below).

### O.2 Checkpoint 0 — preflight (read-only)

```bash
supabase link --project-ref txsalzljvglbrnldikco
supabase migration list --linked
# ASSERT: remote-only == exactly these 8; local-only == the 42 enumerated in §N.3.
#   STOP on any other version (drift or wrong project — cf. §F foreign-ledger note).
psql "$STAGING_DB_URL" -Atc "SELECT extname FROM pg_extension WHERE extname='pg_cron'"
# ASSERT: empty result on staging (verified §K — extension list is
#   pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp only).
#   => 20261015220000 takes its NOTICE-only branch; cannot schedule the sweep.
# Re-capture backup bundle into fresh timestamped dir:
#   pg_dump -s (schema) + pg_dump -a (data) + supabase_migrations ledger dump + migration list output.
#   STOP if any artifact fails or is unreadable.
# File-presence: copy 20261016000000, 20261017000000, 20261018000000 from main
#   into the linked worktree's supabase/migrations/ so they read as matched pairs.
supabase db push --dry-run   # ASSERT: no LegacyDbPushMissingLocalError
# Human-confirmed exclusive migration window (owner sign-off; Muse holds PR #727).
```

### O.3 Checkpoint 1 — orphan ledger repair (metadata-only, zero object changes)

Five `*_staging` orphan versions (duplicate applications of canonical files under regenerated versions; object signatures verified matching §B):

```bash
supabase migration repair --status reverted \
  20261010111740 20261011234155 20261011234157 20261011234232 20261011234233
supabase migration list --linked   # verify: 5 show reverted; remote-only residuum = 3 on-main
```

### O.4 Three canonical versions — must remain applied, NEVER re-execute

`20261016000000`, `20261017000000`, `20261018000000` — genuinely applied on staging from main's real files. Resolution = file-presence only (§O.2): once present locally they read as matched pairs and are skipped forever.
- `migration repair` on these three is FORBIDDEN (would misrecord applied work).
- Re-execution is FORBIDDEN — `20261017000000` carries an unguarded `insert into storage.buckets`.

### O.5 Checkpoints 2–5 — literal apply sequences (strict version order)

```bash
# Checkpoint 2 — ORPHAN-REDUNDANT (5): idempotent over existing objects
for f in 20260912230000_add_project_deployments \
         20260923000000_action_runtime \
         20260923010000_browser_action_runtime_hardening \
         20260923020000_action_runtime_final_gate \
         20260923030000_action_runtime_lockdown; do apply_one "$f"; done

# Checkpoint 3 — LOW additive (20):
for f in 20260827000000_llm_usage_records_billing_exempt \
         20260910010000_analytics_events_table \
         20260913070000_add_run_status_to_paused_runs \
         20260915020000_project_workspace_branch \
         20260915150000_project_list_indexes \
         20260917010000_add_quality_loop_state_to_paused_runs \
         20260917180000_add_batch_remainder_to_paused_runs \
         20260918000000_seed_canonical_pricing_v1 \
         20260918120000_paused_runs_ttl_30min \
         20260919000000_deployment_file_encoding \
         20260920000000_paused_run_lease \
         20260920000001_posts_rls_published_filter \
         20260920000002_terminal_command_audit_log \
         20260922180000_demo_logs \
         20260927000000_studio_tasks_worktabs \
         20260929000000_metering_reconciliation \
         20261003200000_global_litt_system_project \
         20261010000000_allow_unpublished_deployment_status \
         20261014000000_subscriptions_stripe_subscription_id_unique \
         20261015000000_subscriptions_cancel_at_period_end; do apply_one "$f"; done

# Checkpoint 4 — MEDIUM guarded data ops (6):
for f in 20260916010000_social_phase1 \
         20260922000000_execution_engine_lifecycle \
         20260923040000_action_execution_context \
         20261015210000_checkout_session_lease \
         20261015220000_schedule_media_cap_sweep \
         20261015230000_checkout_block_protected_subscription; do apply_one "$f"; done

# Checkpoint 5 — BILLING-CORE + grant tail (11):
for f in 20261015120000_media_cap_holds \
         20261015140000_subscriptions_last_stripe_event_created \
         20261015160000_checkout_reservations \
         20261015170000_billing_subscription_conflicts \
         20261015180000_media_cap_hold_expiry \
         20261015200000_apply_subscription_event \
         20261015240000_stripe_event_claim_token \
         20261019120000_settled_invoice_grants \
         20261022180000_sweep_expired_reservations \
         20261022180100_free_chat_rate_limit; do apply_one "$f"; done
# then: §N.1 step-1 pre-state ACL capture; apply grant last:
apply_one 20261023000000_stripe_events_service_role_grant
# then: §N.1 step-3 post-state ACL check (expect == pre-state on staging)
```

Between checkpoints: run §I per-checkpoint validations; Muse reviews before the next checkpoint starts. Hard ordering constraint: `20261019120000` must follow `20261015200000` (replaces that function body) — sequence above enforces it.

### O.6 Post-validation (all under `BEGIN; … ROLLBACK;` unless read-only)

```sql
-- READ-ONLY: signatures, privileges, policies, counts, ledger tail
SELECT proname, pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('reserve_bits','settle_bits','release_bits',
   'sweep_expired_reservations','consume_free_chat_limit','apply_subscription_event',
   'claim_stripe_event') ORDER BY 1,2;
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY 1 DESC LIMIT 3;
-- expect 20261023000000 newest
-- CONTROLLED TRANSACTIONS (BEGIN…ROLLBACK — verify behavior, persist nothing):
SELECT * FROM public.consume_free_chat_limit('preflight-probe', 20, 500);  -- allowed=true
SELECT * FROM public.sweep_expired_reservations();                        -- all-zero counts
-- claim_stripe_event probe + reserve→release roundtrip inside rollback txns
```

### O.7 Evidence already on file

- **Backup bundle** (`C:\LiTT\Worktrees\pr726-staging-backup\`): `schema-20261023.sql` 476,106 B / 13,802 lines; `data-20261023.sql` 3,617,767 B / 13,741 lines; `.scratch-ledger.sql` ledger dump (all 8 remote-only versions verified present; foreign `20261004015352` absent — confirming §F's stray-CLI contamination note); `migration list` output. Bundle re-captured at CP0 per §O.2.
- **Isolated restore rehearsal** (postgres:17 `staging_restore_test`, §F): schema loaded 2,352 objects — 163 public tables + 65 functions; data loaded under `session_replication_role='replica'`; row-count checks users=47, credit_ledger=25, subscriptions=2, stripe_events=31. Limitations: platform roles/schemas (auth/storage/vault/realtime), pg_cron jobs, publications, storage binaries NOT covered — Supabase-managed, unaffected by this plan.
- **pg_cron:** absent on staging (§K). `20261015220000` ⇒ NOTICE-only. Re-check on production later — unknown there.

### O.8 Ledger reconciliation — 96 matched vs the "14-row" observation

Authoritative: remote ledger = **104 rows** = 96 matched (remote row has same-version local file) + 8 remote-only (5 `*_staging` orphans + 3 on-main). Plus 41 (now 42) local-only files = the pending set. The `migration list` union view ≈ 145–146 lines. Verified against `.scratch-ledger.sql`: all 104 remote versions enumerable; all 8 remote-only present; no foreign rows.
A "14-row hosted ledger" is a different lens — a filtered/paginated/dashboard view (e.g., name-filtered query, dashboard page, or a different linked project — cf. §F's stray `20261004015352` from a foreign ledger). It is the same class of truncation error §L documented for the earlier "6" figure. If the 14-row observation came from a specific query, share it and it reconciles row-for-row against the 104-row artifact — it cannot supersede the authoritative dump.

### O.9 STOP conditions (any → freeze, keep ledger untouched, report)

- `migration list` remote-only ≠ the 8 documented; local-only ≠ the enumerated set.
- `db push --dry-run` reports missing-local after file-presence step.
- Any statement error during `apply_one` (ON_ERROR_STOP halts; ledger row unwritten).
- New ledger rows appear during the window (concurrent applier).
- Backup artifacts missing/unreadable at CP0; pg_cron unexpectedly present (re-decide 20261015220000 path).
- CP5 ACL post-state ≠ pre-state for stripe_events.

### O.10 Rollback matrix

| Scope | Procedure |
|---|---|
| Orphan repair (CP1) | `supabase migration repair --status applied <5 orphan versions>` — restores ledger rows; objects untouched |
| Additive migrations (CP2–5) | Drop new objects by name; guarded re-runs need nothing; restore mutated rows from `data-20261023.sql` under `SET session_replication_role='replica'`; restore prior function/constraint bodies from `schema-20261023.sql` |
| Grant file | §N.1 privilege-preserving delta-rollback — revoke only post−pre delta (expected ∅ on staging → ledger-only `repair --status reverted 20261023000000`); blanket REVOKE retracted |
| Full restore | Supabase dashboard → Backups → restore preflight snapshot; logical restore path rehearsed §F (public schema only) |

### O.11 Status

Committed: `fbe71e83` on `cursor/684-studio-littbits-debit`. Pending-set now 42. Checkpoints 1–5 HELD pending (a) Muse PASS on this manifest and (b) explicit staging-only authorization — in that order. No staging writes performed. Production HOLD active.
