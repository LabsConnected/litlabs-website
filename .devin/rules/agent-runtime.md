---
description: "Agent runtime, cancellation, disconnect, and truthful-state rules for this repo"
trigger: always_on
---

# Agent Runtime, Cancellation & Product Truthfulness

## LiTT product behavior

- Prefer truthful UI state over optimistic/fake success states.
- Never report preview, deploy, agent, terminal, model, billing, or build success until the backend confirms it.
- Recover server-side state after client disconnects whenever possible.
- A browser disconnect must not automatically cancel server-side work.
- Intentional user Stop/Cancel actions must cancel the run.
- Finished server-side runs should be recoverable after reload/reconnect.
- Preview should start automatically when appropriate rather than requiring unnecessary manual user actions.
- User-visible errors must explain what failed and provide a meaningful recovery path.
- Do not expose raw internal exceptions unnecessarily to end users.

## Agent/runtime behavior

- Server-side agent work should survive ordinary client disconnects.
- Client disconnect and explicit cancellation are different events.
- Cancellation must be explicit and truthful.
- Do not claim an agent completed if execution failed or was interrupted.
- Persist enough state to recover active/completed runs where architecture supports it.
- Avoid spawning unnecessary background processes on Android.
- Clean up child processes after failed or cancelled tasks.
