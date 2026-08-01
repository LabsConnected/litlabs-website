# P0 Security Fixes — Branch Inventory

Branch: `security/p0-fixes` (from `main`)
Status: **Inventory only — no fixes applied yet**

## P0-1: Anonymous `/api/ai-chat` LLM access

**File:** `src/app/api/ai-chat/route.ts` (line 18-19)
**Issue:** `const { userId } = await auth(); const uid = userId || "anonymous";`
Anonymous users get full LLM access with their own memory container. No 401 gate.
**Fix:** Return 401 if `!userId` before proceeding.

## P0-2: File write/delete has no approval gate

**Files:**
- `src/lib/missions/mission-executor.ts` (lines 188, 257) — `writeWorkspaceFile` / `deleteFile`
- `src/lib/visual-builds/orchestrator.ts` (lines 52, 402, 514) — file writes
- `src/components/litt-terminal/FileExplorer.tsx` (lines 123, 167) — UI file ops
- `src/app/studio/tools/CanvasTool.tsx` (lines 356, 764) — canvas file writes

**Issue:** File operations execute directly without creating an approval record.
The approvals API exists (`src/app/api/approvals/[approvalId]/route.ts`) but is
only used by the mission executor's `resolveMissionApproval` — not by direct
file write/delete operations.
**Fix:** Route all file writes/deletes through the approval system.

## P0-3: Checkpoint command injection

**File:** `src/app/api/studio-projects/[projectId]/checkpoints/route.ts` (line 77)
**Issue:** `git commit -m "${body.label.replace(/"/g, '\\"')}"` — only escapes
double quotes. Backticks, `$()`, and newlines can still inject shell commands.
**Fix:** Use a heredoc or `--file=-` with stdin to pass the label safely,
or use `git commit -m "..." --` with full shell escaping.

## P0-4: CanvasTool uses localStorage for files

**File:** `src/app/studio/tools/CanvasTool.tsx` (lines 105, 113, 124, 131, 364, 366, 380, 381, 389)
**Issue:** Canvas blocks are stored in `localStorage` and file content is parsed
from markdown code fences. No server-side ownership, no RLS, no persistence
beyond the browser.
**Fix:** Replace localStorage with server-backed storage (Supabase table or
project workspace files).

## P0-5: Approvals API disconnected from file operations

**Files:**
- `src/app/api/approvals/route.ts` — list pending approvals
- `src/app/api/approvals/[approvalId]/route.ts` — get/resolve approval
- `src/lib/missions/mission-executor.ts` — `resolveMissionApproval`

**Issue:** The approval system exists and works for missions, but file
write/delete operations (P0-2) bypass it entirely.
**Fix:** Wire file operations through the approval creation + resolution flow.

## P0-6: Lack of cross-user isolation tests

**Issue:** No tests verify that User B cannot access User A's conversations,
projects, memories, or agent system notifications.
**Fix:** Add integration tests for cross-user isolation on all user-scoped tables.

## Implementation Order

1. P0-1: Block anonymous `/api/ai-chat` (smallest, highest risk)
2. P0-3: Fix checkpoint command injection (smallest, highest risk)
3. P0-6: Add cross-user isolation tests (validates the rest)
4. P0-2 + P0-5: Wire file operations through approval system
5. P0-4: Replace Canvas localStorage with server storage

## Files Touched (planned)

- `src/app/api/ai-chat/route.ts` — add 401 gate
- `src/app/api/studio-projects/[projectId]/checkpoints/route.ts` — fix injection
- `src/lib/missions/mission-executor.ts` — route file ops through approvals
- `src/lib/visual-builds/orchestrator.ts` — route file ops through approvals
- `src/components/litt-terminal/FileExplorer.tsx` — route file ops through approvals
- `src/app/studio/tools/CanvasTool.tsx` — replace localStorage
- `tests/integration/cross-user-isolation.test.ts` — new test file
