# LiTT final integration and rollback plan (2026-11-24)

Production remains on HOLD. This is preparation, not authorization to merge, deploy, mutate hosted databases, or run provider-backed tests.

## Integration snapshot at preparation

| Item | Verified SHA/status | Release role |
| --- | --- | --- |
| main | 8935b2a91964d8efc9a8c3d0839cd53077e7b6c9 | Contains PRs #1108, #1109, and #1110; supersedes 9f8501ee81d0a585570d662bd53da72541c40b5c |
| PR #1111 | Draft; prior head f2678a156ed616b446db038d87ae579337c1d6a5 passed 8/8; verify the latest head and CI at merge | Staging scope, deployment and acceptance gates |
| PR #1112 | 381bb868d5a891bd36a63e8db4193f8e1c41a580; draft; 10/10 checks passed | Recovered billing migrations and canonical settle_bits |
| PR #726 | 64bc42b3783a018f2f10b444dcc80fc777487246; draft, non-main base | Historical source of 16 migrations only; do not merge the application diff |
| PR #1067 | 6806a2ffcba29352090b75bf2545bca615dd4cce; open, non-main base | Devin webhook work requires claim-token RPC integration on current main |
| PR #1096 | a037e7d493aeec9826c70bd710f1f73cba1a22b9; draft, stale base | Gemini provider reliability; reconcile separately without duplicate work |

PRs #1111 and #1112 change disjoint files. Neither applies hosted migrations. The 16 recovered PR #726 migration files belong to #1112 for release review.

## Required order after owner approval

1. Finish owner review of #1111 and #1112. Confirm fresh CI, review threads, and the exact heads above immediately before any merge. Merge only the explicitly approved PRs. Record each resulting main SHA. No final release SHA exists yet.
2. Devin adapts the current-main Stripe webhook to call claim_stripe_event, finalize_stripe_event, and release_stripe_event with a UUID claim token. The raw stripe_events insert/update approach in #1067 does not fence a stale owner. Preserve delegation to self-claiming agent purchase/refund RPCs. Require concurrent delivery, stale-owner, retry, and replay tests before review.
3. Gemini reconciles #1096 with current main and provides focused provider-failure evidence. Keep this work separate from #1111.
4. With separate hosted-DB approval, capture staging backup/ledger evidence; apply #1112's pending migrations to staging; verify version ledger, function signatures/permissions, settle_bits behavior, and application compatibility. Do not apply production migrations in this step.
5. With separate staging-deploy approval, deploy the resulting final candidate to staging web and terminal using the pinned manual workflows. Record the final 40-character SHA, active Railway deployment IDs, service IDs, health JSON, and logs. Require sandbox state verified; never open host execution.
6. With separate provider-test approval, run the authenticated terminal smoke below, Clerk and Stripe TEST workflows, then staging-acceptance.yml. Run 10 complete consecutive journeys starting at Run 1 after any release-affecting change. The workflow checks exact web SHA, terminal full Railway commit metadata, terminal runtime prefix, isolation, and both active deployment IDs before and after every journey.
7. Review artifacts and all failed assertions. Only then request production migration and deployment approval. Production remains untouched until that request is approved.

## Authenticated staging terminal smoke

The manual-only script is scripts/final-acceptance/staging-terminal-smoke.mjs. It is pinned to the staging terminal URL and makes no calls until invoked. Running its isolated command can incur sandbox provider cost, so it requires separate approval.

Prepare a ready disposable workspace owned by the configured terminal owner. Supply a short-lived owner terminal JWT, or a short-lived owner Clerk JWT that the script exchanges for a terminal JWT. Set these environment variables without printing secret values:

- EXPECTED_STAGING_SHA: approved full 40-character release SHA.
- STAGING_TERMINAL_WORKSPACE_ID and STAGING_TERMINAL_OWNER_USER_ID: the ready staging workspace and its owner.
- STAGING_TERMINAL_EXISTING_FILE: a known UTF-8 file in that workspace.
- STAGING_TERMINAL_EXISTING_SHA256: exact SHA-256 of that file's UTF-8 contents.
- STAGING_TERMINAL_INTERNAL_SERVICE_KEY: staging service-to-service key.
- Exactly one of STAGING_TERMINAL_JWT or STAGING_TERMINAL_OWNER_CLERK_JWT.

Run: node scripts/final-acceptance/staging-terminal-smoke.mjs

The script asserts unauthenticated read = 401; authenticated existing-file read = 200 with exact content hash; random missing-file read = 404 with clean "File not found"; workspace command = 200, exit 0, sandbox_exec and sandbox run ID; /api/command /do = 503 HOST_EXECUTION_DISABLED; health before and after = expected prefix, ready, verified sandbox, and host mode none. Retain the script's JSON result, Railway deployment IDs, and service logs. A terminal runtime prefix plus Railway metadata is the strongest available full-SHA evidence; the runtime endpoint itself exposes only eight characters.

## Release evidence and rollback

Before every staging or production deployment, save: source SHA, PR heads and checks, target project/environment/service IDs, previous successful deployment IDs and SHAs, migration ledger, backup/PITR status, health JSON, and logs. After each deployment, record active deployment IDs and repeat the health/SHA/functional checks. Preserve screenshots, traces, and acceptance artifacts with the final report.

Last observed staging web and terminal SHA: 055ae85130134a2ae7bb0d4b1bcb23c63a8638cc. Last observed production web SHA: 055ae85130134a2ae7bb0d4b1bcb23c63a8638cc. Last observed separate production terminal SHA: 8a84d190cce96a560b2455df759a7499344767e5. Re-verify these and capture deployment IDs immediately before changes; do not assume they remain current.

If a staging deploy fails, stop acceptance, keep host execution disabled, and redeploy the captured previous successful service deployment through Railway's deployment history. Re-check both service SHAs, readiness, isolation, and logs. Any release-affecting rollback or fix resets the acceptance streak to zero. If a migration fails, stop before deploying dependent application code; restore from the captured backup/PITR or use a reviewed forward fix. Production migration rollback requires a separate, explicit owner decision.
