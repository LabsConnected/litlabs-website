---
name: litlab-verify
description: Run the full litlab verification suite — typecheck, lint, build. Use after any code change to confirm nothing broke.
argument-hint: "[scope: full|typecheck|lint|build]"
model: swe
allowed-tools:
  - exec
  - read
  - grep
permissions:
  allow:
    - Exec(pnpm)
    - Exec(npx tsc)
    - Exec(npx eslint)
    - Exec(npx next)
    - Read(**)
---

Run the litlab verification suite. The user may pass a scope argument: `full` (default), `typecheck`, `lint`, or `build`.

## Commands (run from repo root)

**Typecheck** (always run first — fastest signal):
```powershell
npx tsc --noEmit
```
Expected: 0 errors. Known pre-existing errors to ignore if they appear:
- `src/lib/missions/mission-executor.ts` — `simple-git` module not installed, `match` property, arg count (3 errors)

**Lint** (scoped to changed files when possible):
```powershell
npx eslint <changed-files>
# or for full lint:
pnpm lint
```
Expected: 0 errors. Warnings about unused `T` arg in `src/app/settings/page.tsx` are pre-existing.

**Build** (slowest — only run for full verification):
```powershell
pnpm build
```
Expected: 57 routes, no errors. Uses `next build` per `vercel.json`.

## Workflow
1. If scope is `typecheck` or `full`: run `npx tsc --noEmit` and report any NEW errors (not in the known list above).
2. If scope is `lint` or `full`: run `pnpm lint` (or scoped eslint on changed files).
3. If scope is `build` or `full`: run `pnpm build` only if typecheck + lint pass.
4. Summarize: ✅ pass / ❌ fail with specific error lines and file paths.

## Important
- This is Windows PowerShell — use `;` not `&&` to chain commands, or run separately.
- `pnpm` is the package manager (NOT npm/yarn).
- Do NOT run `supabase db reset` or any DB commands — this is verification only.
- If `pnpm build` fails with Windows EPERM on `.next/`, that's expected — `cleanDistDir: false` in `next.config.ts` is the workaround.
