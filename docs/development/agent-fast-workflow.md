# Agent Fast Workflow

This document defines the efficient operating procedure for AI coding agents
working in the LiTTree Lab Studios repository.

## Core Principle

**Search only the relevant subsystem. Read only files required for the task.
Make the smallest cohesive change. Validate incrementally.**

## Step-by-Step Procedure

1. **Read the current task.** Understand what is being asked.
2. **Inspect `git status` and `git diff`.** Know what's already changed.
3. **Search only the relevant subsystem.** Use `code_search` or `grep_search`
   with targeted queries — never scan the entire repository.
4. **Read only files required for the task.** Don't open unchanged files.
5. **Make the smallest cohesive change.** Prefer `edit` over `write_to_file`.
6. **Validate modified files.** Check for lint errors in the IDE feedback.
7. **Run affected unit tests only.**
   ```powershell
   npx vitest run tests/<relevant-test>.test.ts --reporter=verbose
   ```
8. **Run TypeScript when the change crosses module boundaries.**
   ```powershell
   npx tsc --noEmit
   ```
9. **Run the production build before declaring a major task complete.**
   ```powershell
   pnpm build
   ```
10. **Run the full Playwright suite only:**
    * At the final release gate
    * After authentication changes
    * After middleware changes
    * After navigation changes
    * After shared Studio shell changes
    * After changes that affect many routes

## What NOT to Do

- **Full repository scans after every edit** — use targeted searches.
- **Full Playwright runs after CSS or isolated component changes** — run
  only the affected spec.
- **Repeated dependency installation** — `pnpm install` only when
  `package.json` or `pnpm-lock.yaml` changes.
- **Repeated `.next` deletion** — only when build cache is corrupted.
- **Reopening unchanged files** — trust the context you already have.
- **Rebuilding unrelated workspaces** — stay in the current workspace.
- **Running multiple heavy validation commands simultaneously** — run
  them sequentially to avoid memory pressure.
- **Starting duplicate development servers** — check for existing servers
  on port 3000 before starting a new one.

## Validation Tiers

| Change Scope | Validation |
|-------------|------------|
| Single file, no new imports | Lint check only |
| Single module | Lint + affected tests |
| Cross-module | Lint + tests + `tsc --noEmit` |
| Major feature | Lint + tests + tsc + `pnpm build` |
| Release gate | Lint + tests + tsc + build + Playwright |

## Performance Tips

- The repository has 18+ git worktrees in `.worktrees/`. These are excluded
  from TypeScript, ESLint, and Vitest via config. Never remove `.worktrees`
  from these excludes.
- `pnpm lint` takes ~42s. Run it only when needed (before commits, not after
  every edit).
- `npx tsc --noEmit` takes ~11s. Run it when changes cross module boundaries.
- `pnpm test` takes ~23s for 518 tests. Run only affected test files during
  development.
- `pnpm build` takes ~47s. Run it before declaring a major task complete.
- Memory is constrained (15.8 GB total, ~2 GB free). Avoid running multiple
  heavy processes simultaneously.
