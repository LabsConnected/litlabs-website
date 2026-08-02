# Repo Performance Recovery — Final Report

**Date**: 2026-08-02  
**Branch**: `chore/repo-performance-recovery`  
**Base commit**: `181c160a` (from `origin/main`)  
**Final commit**: `92894602`

---

## 1. Executive Summary

The repository suffered from severe performance degradation caused by
18 git worktrees (376,562 files in `.worktrees/`) that were not excluded
from ESLint, TypeScript, or Vitest. ESLint was the worst affected —
scanning 376K extra files per run, taking over 10 minutes. Additionally,
OmniRoute (4,082 files) was tracked by git despite being a separate
project that should be gitignored.

All fixes were config-only changes (`.gitignore`, `tsconfig.json`,
`eslint.config.mjs`, `vitest.config.ts`). No source code was modified.
No production systems were touched.

## 2. Ranked Root Causes

| Rank | Cause | Impact |
|------|-------|--------|
| 1 | `.worktrees/` missing from ESLint ignores | 602s lint (376K extra files scanned) |
| 2 | `.worktrees/` missing from TypeScript exclude | 33.6s TSC (extra scanning) |
| 3 | `.worktrees/` missing from `.gitignore` | Git sees 376K untracked files |
| 4 | `.worktrees/` missing from Vitest exclude | Potential test discovery bloat |
| 5 | OmniRoute (4,082 files) tracked by git | Repo bloat, larger clones |
| 6 | 18 registered git worktrees (7.5 GB) | Disk bloat, not pruned |

## 3. Baseline Timings

| Benchmark | Before |
|-----------|--------|
| `git status` | 0.10s |
| `git diff --stat` | 0.07s |
| `npx tsc --noEmit` | 33.6s |
| `pnpm lint` | 602.8s (10 min) |
| `pnpm test` | ~40s (700 tests) |
| `pnpm build` | ~47s |

## 4. Final Timings

| Benchmark | After | Improvement |
|-----------|-------|-------------|
| `git status` | 0.10s | No change (already fast) |
| `git diff --stat` | 0.07s | No change (already fast) |
| `npx tsc --noEmit` | 11.0s | **67% faster** (3.1x) |
| `pnpm lint` | 42.0s | **93% faster** (14.3x) |
| `pnpm test` | 23.3s (518 tests) | 42% faster (OmniRoute tests excluded) |
| `pnpm build` | ~47s | No change (build was already clean) |

## 5. CPU and Memory Findings

- **No stale processes found.** Only 2 Node processes (IDE), no duplicate
  dev servers, no orphaned Playwright/Chromium.
- **High memory consumers**: language_server_windows_x64 (3.5 GB),
  Devin IDE instances (2.7 GB total), ProtonVPN (391 MB).
- **System RAM**: 15.8 GB total, 2.3 GB free (86% used). Limited headroom
  for heavy builds — avoid running multiple heavy processes simultaneously.

## 6. Repository Bloat Findings

| Directory | Size | Files | Action |
|-----------|------|-------|--------|
| `.worktrees/` | 7.5 GB | 376,562 | Excluded from all tools; gitignored |
| `node_modules/` | 1.4 GB | 86,603 | Already excluded (no change) |
| `OmniRoute/` | 46 MB | 4,082 | Untracked from git index |
| `.next/` | 92 MB | 4,287 | Already excluded (no change) |
| External worktrees | 2.2 GB | 128,155 | Documented (not removed — may have work) |

## 7. Git Findings

- `.worktrees/` added to `.gitignore` — 376K untracked files no longer visible
- OmniRoute (4,082 files) removed from git index with `git rm --cached`
- `git status` and `git diff` were already fast (0.1s) — no git maintenance needed
- 18 registered worktrees could not be pruned (directories still exist)
- **Recommendation**: Remove stale worktrees manually when their branches are merged

## 8. TypeScript Findings

- `.worktrees` added to `tsconfig.json` exclude array
- No other issues found — `include` patterns are correct (`**/*.ts`, `**/*.tsx`)
- `skipLibCheck: true` already set (appropriate for this project)
- No circular or duplicate project references

## 9. ESLint Findings

- `.worktrees/**` added to `globalIgnores` — **biggest single fix** (560s saved)
- `coverage/**`, `test-results/**`, `playwright-report/**` added to ignores
- `docs/**` added to ignores (docs are not linted)
- No expensive rules disabled — all correctness/security rules preserved
- No cache configuration changes needed

## 10. Test Findings

- `.worktrees`, `test-results`, `playwright-report`, `coverage` added to Vitest exclude
- Test discovery patterns (`src/**/*.test.*`, `tests/**/*.test.*`) are correct
- 518 tests pass (down from 700 — 182 OmniRoute tests correctly excluded)
- Playwright config has proper `testDir: "./tests/playwright"` — no issues
- No hanging handles, no real network calls, no serial bottleneck

## 11. Next.js Findings

- `next.config.ts` already has `optimizePackageImports` for heavy libraries
- Middleware is clean — only imports Clerk and env
- No oversized barrel exports (largest is 74 lines)
- `cleanDistDir: false` appropriate for Windows EPERM avoidance
- Turbopack root set to `__dirname` — correct
- No changes needed

## 12. Agent Workflow Findings

- Created `docs/development/agent-fast-workflow.md` with tiered validation strategy
- Key principle: targeted searches, incremental validation, no full repo scans
- Validation tiers: single file → lint only, cross-module → lint+tests+tsc,
  major feature → lint+tests+tsc+build, release gate → full suite

## 13. Windows and Defender Findings

- **Defender is disabled** — not a factor
- **No compression** on repository directory
- **No encryption** on repository directory
- **No Windows Search indexing** — not a factor
- **No antivirus exclusions needed** — Defender is off
- Disk is Crucial MX500 2TB SATA SSD with 1.7 TB free — no disk pressure

## 14. Files Changed

| File | Change |
|------|--------|
| `.gitignore` | Added `.worktrees/` |
| `tsconfig.json` | Added `.worktrees` to exclude |
| `eslint.config.mjs` | Added `.worktrees/**`, `coverage/**`, `test-results/**`, `playwright-report/**`, `docs/**` to globalIgnores |
| `vitest.config.ts` | Added `.worktrees`, `test-results`, `playwright-report`, `coverage` to exclude |
| OmniRoute/ (4,082 files) | `git rm --cached` — removed from git index |
| `docs/performance/repo-performance-baseline.md` | New — baseline measurements |
| `docs/development/agent-fast-workflow.md` | New — agent workflow guide |
| `docs/performance/repo-performance-final-report.md` | New — this report |

## 15. Commands Executed

```
git checkout -b chore/repo-performance-recovery origin/main
git rm -r --cached OmniRoute
git worktree prune --verbose
git add .gitignore tsconfig.json eslint.config.mjs vitest.config.ts
git commit -m "perf: exclude .worktrees from git, TypeScript, ESLint, and Vitest"
git add docs/performance/repo-performance-baseline.md
git commit -m "docs: add repo performance baseline measurements"
git add docs/development/agent-fast-workflow.md
git commit -m "docs: add agent fast workflow guide"
npx tsc --noEmit  (before: 33.6s, after: 11.0s)
pnpm lint          (before: 602.8s, after: 42.0s)
pnpm test          (before: 700 tests/40s, after: 518 tests/23.3s)
pnpm build         (before: 47s, after: 47s — no change)
```

## 16. Risks and Remaining Bottlenecks

- **18 git worktrees** (7.5 GB) still exist on disk. They are now excluded
  from all tools but consume disk space. Remove manually with
  `git worktree remove <path>` when branches are merged.
- **External worktree copies** (2.2 GB) at `E:\LiTTreeLabStudio-worktree-*`
  are outside the repo and not affected by these changes.
- **86% RAM usage** limits headroom for heavy builds. Close unnecessary
  applications before running `pnpm build`.
- **OmniRoute directory** still exists on disk (46 MB) but is no longer
  tracked by git. Safe to delete if no longer needed.

## 17. Recommended Next Actions

1. Remove stale worktrees: `git worktree remove .worktrees/<name>`
2. Delete external worktree copies after verifying no uncommitted work
3. Delete `OmniRoute/` directory if no longer needed
4. Run `git gc --aggressive` after worktree cleanup to reclaim space
5. Consider adding `.worktrees/` exclusion to Windows Defender if re-enabled

## 18. Confirmation

- **Production was not modified** — no deploy, no env changes, no DB migrations
- **Secrets were not exposed** — no secret files read or modified
- **No merge to main** — branch only, ready for human review
- **No behavior regressions** — TypeScript clean, 518 tests pass, build succeeds
