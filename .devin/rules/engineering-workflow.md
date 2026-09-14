---
description: "Core engineering, validation, performance, and error-handling rules for all work in this repo"
trigger: always_on
---

# Core Engineering & Workflow

## Validation

- Validate the smallest affected scope first: targeted Vitest/test files, package-scoped `tsc`/`lint`. Run heavy validation sequentially.
- Never claim a change is fully validated unless the relevant CI/full-validation gate passed; report skipped validation clearly.
- Do not hide warnings, failed tests, build errors, or incomplete checks; do not weaken tests merely to make CI pass.
- Per-package verification: `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm build` (run inside the affected package directory).

## Code changes & working style

- Inspect first, edit second; diagnose before patching; prefer evidence over assumptions.
- Read the relevant implementation before editing; understand the existing architecture before introducing a new abstraction.
- Make the smallest correct change; avoid unrelated refactors during bug fixes; preserve existing behavior unless the task requires changing it.
- Do not duplicate existing utilities, components, hooks, routes, or abstractions; follow existing repository conventions.
- Update tests when behavior changes; fix root causes instead of masking symptoms; no silent fallbacks that hide failures.
- Do not leave temporary debug code, logs, commented-out code, or dead files behind.
- When something fails, capture the exact command, exit code, and relevant error.
- Keep changes focused and reviewable; summarize what changed, what was validated, what remains unvalidated, and any risks.

## Performance

- Avoid unnecessary client bundles and unnecessary polling.
- Clean up timers, subscriptions, listeners, and spawned processes.
- Avoid duplicate network requests where single-flight behavior is appropriate.
- Prefer incremental/targeted work over expensive full-repo operations.
- Do not introduce obvious N+1 requests or repeated expensive model/API calls.

## Error handling

- Never silently ignore important failures; never convert an actual failure into a fake success response.
- Log enough context to diagnose failures without leaking secrets; preserve the original error cause where useful internally.
- Give users clear failure states; distinguish retryable failures from permanent failures.
