# Repo Performance Baseline

**Date**: 2026-08-02  
**Branch**: `chore/repo-performance-recovery`  
**Base commit**: `181c160a` (from `origin/main`)

---

## System Environment

| Metric | Value |
|--------|-------|
| OS | Windows 11 |
| Shell | PowerShell |
| Node | v22.22.3 |
| pnpm | 9.15.9 |
| Total RAM | 15.8 GB |
| Free RAM | 2.3 GB (86% used) |
| Disk | E: — Crucial MX500 2TB SATA SSD |
| Free disk | 1,772.9 GB / 1,863 GB |

## Repository Metrics

| Metric | Value |
|--------|-------|
| Tracked files | 5,167 |
| Untracked files | 17 |
| Total files (excl node_modules/.next/.git) | ~2,021,837 |
| OmniRoute tracked files | 4,082 |

## Top-Level Directory Sizes

| Directory | Size (MB) | File Count | Git Tracked | TS Scans | ESLint Scans |
|-----------|-----------|------------|-------------|----------|--------------|
| `.worktrees/` | 7,555.9 | 376,562 | No | **YES** (bug) | **YES** (bug) |
| `node_modules/` | 1,461.4 | 86,603 | No | No | No |
| `public/` | 130.7 | 150 | Yes | No | No |
| `.next/` | 91.7 | 4,287 | No | Partial | No |
| `OmniRoute/` | 46.2 | 4,082 | **YES** (bug) | No | No |
| `supabase/` | 7.6 | 83 | Yes | No | No |
| `src/` | 5.4 | 690 | Yes | Yes | Yes |
| `tests/` | 4.2 | 26 | Yes | Yes | Yes |

## External Worktree Copies

| Path | Size (MB) | Files |
|------|-----------|-------|
| `E:\LiTTreeLabStudio-worktree-terminal` | 981.1 | 59,489 |
| `E:\LiTTreeLabStudio-worktree-connectors` | 184.2 | 5,172 |
| `E:\LiTTreeLabStudio-worktree-pr37` | 1,063.1 | 63,494 |
| `E:\LiTTreeLabStudio-security` | — | — |
| `E:\LiTTreeLabStudio-studio` | — | — |

## Git Worktree Registry

18 registered worktrees in `.worktrees/` + 4 external worktrees = **22 total worktrees**.

## Process Audit

| Process | PID | Memory (MB) | Notes |
|---------|-----|-------------|-------|
| node | 9692 | 120 | IDE (Cascade) |
| node | 11652 | 45 | IDE helper |

**No stale dev servers, no Playwright/Chromium, no duplicate TSC processes.**

## Baseline Timings

| Benchmark | Time | Notes |
|-----------|------|-------|
| `git status` | 0.10s | Fast |
| `git diff --stat` | 0.07s | Fast |
| `npx tsc --noEmit` | 33.6s | Scans `.worktrees/` |
| `pnpm lint` | **602.8s (10 min)** | Scans `.worktrees/` (376K files) |
| `pnpm test` | ~40s | 700 passed, 11 skipped |
| `pnpm build` | ~47s | Production build (Vercel) |

## Root Cause Summary

1. **`.worktrees/` not excluded from ESLint** → 376K extra files scanned → 10 minute lint
2. **`.worktrees/` not excluded from TypeScript** → extra scanning overhead
3. **`.worktrees/` not excluded from Vitest** → potential test discovery bloat
4. **`.worktrees/` not in `.gitignore`** → git sees 376K untracked files
5. **OmniRoute (4,082 files) tracked by git** on `origin/main` → repo bloat
6. **18 registered git worktrees** consuming 7.5 GB disk — stale worktrees not pruned
7. **86% RAM usage** — limited headroom for heavy builds
