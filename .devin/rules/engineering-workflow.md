---
description: "Core engineering, validation, and working-style rules for all changes in this repo"
trigger: always_on
---

# Core Engineering & Workflow

## Validation

- Validate the smallest affected scope first.
- Prefer targeted Vitest/test files over the entire test suite.
- Prefer package-scoped TypeScript checks over full-repo `tsc`.
- Prefer package-scoped linting over full-repo linting.
- Run heavy validation sequentially.
- GitHub CI/WSL is the final full-validation gate.
- Never claim a change is fully validated unless the relevant CI/full-validation gate passed.
- Report skipped validation clearly.
- Do not hide warnings, failed tests, build errors, or incomplete checks.
- Do not weaken tests merely to make CI pass.

## Code changes

- Read the relevant implementation before editing.
- Understand the existing architecture before introducing a new abstraction.
- Make the smallest correct change that solves the problem.
- Avoid unrelated refactors during bug fixes.
- Preserve existing behavior unless the task requires changing it.
- Do not duplicate existing utilities, components, hooks, routes, or abstractions unnecessarily.
- Follow existing repository conventions.
- Update tests when behavior changes.
- Fix root causes instead of masking symptoms.
- Do not introduce silent fallbacks that hide failures.
- Do not leave temporary debug code, logs, commented-out code, or dead files behind.

## Error handling

- Never silently ignore important failures.
- Log enough context to diagnose failures without leaking secrets.
- Give users clear failure states.
- Distinguish retryable failures from permanent failures.
- Preserve the original error cause where useful internally.
- Never convert an actual failure into a fake success response.

## Performance

- Avoid unnecessary client bundles.
- Avoid unnecessary polling.
- Clean up timers, subscriptions, listeners, and spawned processes.
- Avoid duplicate network requests where single-flight behavior is appropriate.
- Prefer incremental/targeted work over expensive full-repo operations.
- Do not introduce obvious N+1 requests or repeated expensive model/API calls.

## Working style

- Inspect first, edit second.
- Diagnose before patching.
- Prefer evidence over assumptions.
- Do not make speculative changes without identifying the failure mechanism.
- When something fails, capture the exact command, exit code, and relevant error.
- Avoid asking unnecessary questions when repository evidence can answer them.
- Keep changes focused and reviewable.
- Summarize what changed, what was validated, what remains unvalidated, and any risks.
