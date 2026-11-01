# LiTT — Master Finish Board: First Stable Public Release

**Goal:** LiTT stable for real users. Then new add-ons continue safely in preview.
**Rule:** No new features, no unrelated refactoring until this board is clear.
**Updated:** 2026-10-08 (supersedes FINAL_STATUS.md, PRODUCTION_READY_CHECKLIST.md,
docs/PRODUCTION-GATES.md — all stale, pre-October).

## Blockers (must clear before public launch)

| # | Item | Status | Owner / note |
|---|------|--------|--------------|
| 1 | **Supabase RLS verification** — RLS + privilege revocations CONFIRMED already present on the live DB (2026-10-08 read-only probes: all 4 tables return 42501; evidence at `~/workspace/security/phase2-verification-evidence.md`; Larry accepted Phase 2 COMPLETE). Outstanding work is **verification** (re-probe + confirm n8n `service_role` path), NOT reapplying the migration. The prepared SQL (`~/workspace/security/rls-fix-20261008.sql`) is held as fallback only — do not apply without explicit approval. | Verification pending | Larry |
| 2 | Authentication + user isolation verification | Pending — needs owner sign-in on preview (release-freeze rule: sign-in is Larry's step) | Larry + QA lane |
| 3 | App Builder + Creative Studio testing | Pending | QA lane (Playwright MCP charters 3–4) |
| 4 | AI functionality verification (chat, streaming, tools, cost attribution) | Pending | QA lane (charter 5) |
| 5 | #646 voice testing | Infra ready (2026-10-08 ~21:38 EDT: test Supabase live, preview redeployed); **blocked on Vapi daily outbound limit reset** | LiTT |
| 6 | n8n synthetic testing | Pending — synthetic test first (INACTIVE, zero DB writes), then v1.3 rebuild | LiTT |
| 7 | #630 review (Phase 3B Studio) | Open/unmerged; review findings pending | Larry (review) |
| 8 | Production readiness checks | Pending — runs after 1–7 clear | QA lane |

## In flight (not launch-blocking, tracked separately)

| Item | Status |
|------|--------|
| Playwright MCP QA-lane integration (this PR) | Config-only; Codex CLI first, verify before Claude lane. No merge/deploy without Larry's approval. |
| Phone assistant repetition quality ("repeats a lot on some shit") | Quality follow-up, not a blocker (P0 closed 2026-10-08) |

## Done (this window)

- #638 merged + deployed (288b4c03): Vapi www defaults + "lit" pronunciation; phone P0 closed via Larry's inbound test.
- #646 preview infra: test Supabase reactivated, preview redeployed with test creds.
- RLS audit complete: live DB confirmed hardened (RLS enabled, privileges revoked); remaining work is verification probes, fix SQL held as fallback only.
