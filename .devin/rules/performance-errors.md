---
description: "Performance and error-handling rules for all changes in this repo"
trigger: always_on
---

# Performance & Error Handling

## Performance

- Avoid unnecessary client bundles.
- Avoid unnecessary polling.
- Clean up timers, subscriptions, listeners, and spawned processes.
- Avoid duplicate network requests where single-flight behavior is appropriate.
- Prefer incremental/targeted work over expensive full-repo operations.
- Do not introduce obvious N+1 requests or repeated expensive model/API calls.

## Error handling

- Never silently ignore important failures.
- Log enough context to diagnose failures without leaking secrets.
- Give users clear failure states.
- Distinguish retryable failures from permanent failures.
- Preserve the original error cause where useful internally.
- Never convert an actual failure into a fake success response.
