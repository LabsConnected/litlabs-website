---
description: Run a full quality gate — lint, typecheck, tests, and production build
---

1. Run ESLint
   ```powershell
   pnpm lint
   ```

2. Run TypeScript type-check
   ```powershell
   npx tsc --noEmit
   ```

3. Run Vitest
   ```powershell
   pnpm test
   ```

4. Run production build
   ```powershell
   pnpm build
   ```

If any step fails, stop and report the error. Do not proceed to the next step.
