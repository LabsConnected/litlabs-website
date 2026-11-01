# LITT Final Integration Report — 2026-10-22

Prepared by Devin (CLI). All findings below are evidence-based; nothing was
reopened, deployed, merged, rotated, or rebooted without approval.

## 1. Executive summary

The platform is **mostly implemented but not release-verified end-to-end**.
Source control is healthy: `main` is at `edeb5431` (PR #718 merge), ~20 open
PRs exist with predominantly green checks, and the shared-brain PR (#722) is
implemented with tests. **Production is stale by 56–57 commits**, which is the
entire cause of the red Release Gate — a deploy-order problem, not a code
defect. Windows-side work (Codex sandbox repair, UDP monitor, Dex link) is
complete and verified.

Remaining work is a short, ordered chain: commit/merge the FAST2 work in the
release worktree → merge the ready PR queue (CI-gated) → deploy web + terminal
to the chosen release SHA → verify staging Stripe webhook → run shared-brain
and E2E acceptance on the deployed candidate.

## 2. Component status

| Component | Status | Evidence | Remaining work |
|---|---|---|---|
| LiTT (web/CLI) | IMPLEMENTED BUT UNVERIFIED | main `edeb5431` builds green per PR checks; prod at `2271bacd` (57 behind) | Deploy + E2E acceptance |
| Dex (Android) | IMPLEMENTED BUT UNVERIFIED | `adb` device `LBMRAIFEVSNRMFRO` online after `adb reconnect`; FAST2 accepted per owner; PR #720 (adb control) green | Real-device LiTT-API round trip on current build |
| Shared brain | IMPLEMENTED BUT UNVERIFIED | `feat/shared-brain-memory` PR #722, checks SUCCESS; `src/app/api/n8n/memory/route.ts`, migration `20261021000000_memories_dedupe_inferable.sql`, CLI `memory-client.ts` + tests, Playwright spec present; "verified live" commit `1118e431` | Run acceptance spec on deployed env; live n8n→Supabase→LiTT→Dex round trip |
| n8n | IMPLEMENTED BUT UNVERIFIED | 9 workflow JSONs inventoried (lead, user, mission, gh-deploy, voice-orch, stripe-entitlement, failure-alerts, daily-summary, outbound-call); no local n8n process — hosted on Railway | Per-workflow execution test on staging |
| Supabase | IMPLEMENTED | `supabase/config.toml` present; RLS/ledger rules documented in billing checklist | Staging verification only |
| Voice | INCOMPLETE (historically) | `src/app/api/stripe/webhook/route.ts` separate; voice worker deploy FAILED in Aug matrix; secret/fingerprint mismatch unresolved | Staging voice-worker repair + token tests |
| Stripe | IMPLEMENTED BUT UNVERIFIED | Webhook route 614 lines: signature verify, `stripe_events` idempotency, `grant_credits` RPC; docs require separate staging secret | Signed test events against staging deployment |
| Railway | IMPLEMENTED BUT STALE | Release Gate run `39832256461` FAIL: web `2271bacd`, terminal `b9a80638` vs source `edeb5431` | Deploy to release SHA (approval) |
| GitHub/CI | WORKING | ~20 open PRs; Release Gate correctly detecting drift; PR #719 has a failing check (draft); gitleaks baseline PR #721 green | Merge plan execution |
| Windows | VERIFIED STABLE (session) | Codex `26.1016.8120.0` service Running; zero failures post-repair; UDP monitor live + scheduled task installed; crash-dump config verified | Extended monitoring (4266 culprit capture pending) |

## 3. Completed implementation (this session)

- **Codex update repair**: `26.1016.6573.0` → `26.1016.8120.0` via
  `Add-AppxPackage -Register` on the staged manifest after clean service stop.
  Verified: service Running (new path), heartbeats clean, `~/.codex` intact.
- **Persistent UDP monitor**: `C:\Users\litbi\litreeceo-diag\udp-monitor-v2.ps1`
  registered as scheduled task `LiTT-UDP-Monitor` (SYSTEM, at-startup,
  auto-restart, bounded rotating logs). Health CSV confirmed written.
- **Dex link**: `adb reconnect` restored `LBMRAIFEVSNRMFRO` from `offline` → `device`.
- **GPU/bugcheck diagnosis**: 0x113 subtype `0x19` = UNEXPECTED_DEFERRED_DESTRUCTION;
  documented hybrid-graphics power-transition failure mode; Intel driver is 7
  years stale (26.20.100.6911 vs 31.0.101.2145 available). No drivers installed.
- **Diagnostics preserved**: `C:\Users\litbi\litreeceo-diag\` (baseline,
  transcripts, monitor logs).

## 4. End-to-end acceptance

Not executed this session. Required live-infra tests (shared memory round
trip, staging Stripe events, voice sessions, full user journey) cannot be
honestly reported PASS from code inspection alone. Test scaffolding exists
(shared-brain Playwright spec, n8n-memory-route.test.ts, billing-state-machine
28-match suite) and must be run against the deployed release candidate.

## 5. Security verification

- Webhook handler enforces `STRIPE_WEBHOOK_SECRET` signature verification;
  idempotent via `stripe_events`; credits via service-role RPC only.
- RLS requirements documented (`credit_ledger`, `stripe_events` deny anon writes).
- gitleaks baseline PR #721 green; secret-scanning check green on recent PRs.
- Financial-action rule unchanged: Dex requires explicit per-transaction approval.
- No secrets printed or logged during this session.
- **Unresolved**: voice-auth secret/fingerprint mismatch (needs coordinated
  rotation — separate approval).

## 6. Deployment readiness

| Service | Deployed SHA | Target | Order | Rollback |
|---|---|---|---|---|
| litlabs-website (Railway) | `2271bacd` | release SHA (pending selection) | 1 | Git revert + `railway up` (proven 2026-08-20) |
| terminal-server | `b9a80638` | same | 2 | Same |
| n8n | unverified this session | n/a | after web | Workflow-level disable |
| voice-worker | stale/failed | staging first | last | Revert staging deploy |

## 7. Remaining blockers (actual)

| # | Blocker | Owner | Evidence | Resolution | Approval needed | PASS condition |
|---|---|---|---|---|---|---|
| 1 | Production 56–57 commits behind | Release | Gate run 39832256461 | Deploy to chosen release SHA | **YES — production deploy** | Gate green |
| 2 | FAST2 uncommitted work | Release | `release-readiness-2026-10-22` worktree: agent-loop-v2, llm-tool-calling, fast2-reporting modified | Commit → PR → merge | Merge only | PR merged, CI green |
| 3 | Staging Stripe webhook | Billing | Handler verified in code only | Signed test events to staging | Staging access | stripe_events row + entitlement correct |
| 4 | Shared-brain live round trip | Integration | PR #722 green; spec exists | Run spec on deployed env | None for staging run | Memory CRUD + isolation PASS live |
| 5 | Voice worker staging | Voice | Historical deploy failure + secret mismatch | Repair staging worker; rotation plan | **YES — secret rotation** | Token issue/verify/expiry tests PASS |
| 6 | UDP 4266 culprit | Windows | Monitor live; no event since 13:44 | Keep monitoring | None | Named process in EXHAUSTION dump |
| 7 | PR #719 failing check | Release | draft PR, FAILURE+SUCCESS rollups | Fix or drop PR | Merge only | Checks green |

## 8. Rollback strategy

- Web/terminal: git revert → `railway up` (proven end-to-end 2026-08-20).
- n8n: disable imported workflows individually; JSON exports in repo.
- Shared brain: feature-flagged in companion app (`feature-flags.ts` change);
  migration is additive (dedupe index) — safe to keep or drop constraint.
- Windows: monitor task removal = `Unregister-ScheduledTask LiTT-UDP-Monitor`.
- Codex: package downgrade via `Add-AppxPackage -Register` on prior staged
  manifest if ever needed.

## 9. Final decision

**HOLD — SPECIFIC BLOCKERS REMAIN**

Blocking approvals: production deploy (blocker 1), staging webhook + infra
access (3), voice secret rotation (5). Everything authorized-locally is either
complete or has a defined, CI-gated path. No unresolved code-critical defects
are currently evidenced on `main`.
