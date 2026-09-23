# P0 Security Fixes — Branch Inventory

Branch: `main`
Last updated: **2026-09-20 — audit fixes applied**

---

## P0-1: Anonymous `/api/ai-chat` LLM access — ✅ FIXED (prev session)

**File:** `src/app/api/ai-chat/route.ts`
**Fix applied:** Returns 401 before any LLM call if `!userId`. Rate-limited to 10 req/min.

---

## P0-2: File write/delete approval gate — ⚠️ PARTIALLY ADDRESSED

The mission executor (`startMissionRun` → `createApproval` → `resolveMissionApproval`)
correctly gates agent-initiated file writes behind user approval.

Direct `/api/studio-projects/[projectId]/files` POST calls are user-initiated
(source: "user") and logged to `file_audit` — no separate approval needed since
the user is the approver.

**Remaining gap:** CanvasTool.tsx writes to localStorage (see P0-4).

---

## P0-3: Checkpoint command injection — ✅ FIXED (both sites)

- `checkpoints/route.ts` — uses `git commit --file=-` (fixed prev session)
- `mission-executor.ts` `createGitCheckpoint()` — **fixed 2026-09-20**:
  was using `git commit -m "${message.replace(...)}"`. Now uses `--file=-` stdin.

---

## P0-4: CanvasTool uses localStorage for files — ❌ OPEN

**File:** `src/app/studio/tools/CanvasTool.tsx`
**Fix needed:** Replace localStorage with a Supabase table (canvas_blocks)
scoped to project+user. Requires new migration, new API route, client refactor.

---

## P0-5: Approvals API disconnected from file operations — ✅ RESOLVED

The approval system IS connected for mission-executor file writes.
Direct user-initiated file operations are intentionally approval-free.

---

## P0-6: No cross-user isolation tests — ❌ OPEN

**Fix needed:** `tests/integration/cross-user-isolation.test.ts`

---

## Additional fixes applied 2026-09-20

| Item | File | Status |
|---|---|---|
| Clerk middleware | `src/middleware.ts` (NEW) | ✅ Applied |
| Extended secret redaction | `terminal-server/security.ts` | ✅ Applied |
| Supabase audit log persistence | `terminal-server/security.ts` | ✅ Applied |
| posts is_published RLS | `supabase/migrations/20260920000001_*` | ✅ Applied |
| terminal_audit_log table | `supabase/migrations/20260920000002_*` | ✅ Applied |
| .gitignore date dirs | `.gitignore` | ✅ Applied |

---

## Remaining open items

| ID | Severity | Description |
|---|---|---|
| P0-4 | P0 | CanvasTool localStorage — no server persistence |
| P0-6 | P0 | Cross-user isolation tests missing |
| T-Docker | P0 | Terminal needs Docker; Railway has no daemon |
| Voice-RED | P0 | Voice service deploy failed; no tests |

---

## Apply Supabase migrations

```bash
# Option A — Supabase CLI (install if missing: https://supabase.com/docs/guides/cli)
supabase db push

# Option B — direct psql
psql "$DATABASE_URL" < supabase/migrations/20260920000001_posts_rls_published_filter.sql
psql "$DATABASE_URL" < supabase/migrations/20260920000002_terminal_audit_log.sql
```
