---
description: "Agent runtime, cancellation, disconnect, and recovery rules for this repo"
trigger: always_on
---

# Agent Runtime, Cancellation & Recovery

- Server-side agent work should survive ordinary client disconnects.
- Client disconnect and explicit cancellation are different events.
- Cancellation must be explicit and truthful.
- Do not claim an agent completed if execution failed or was interrupted.
- Persist enough state to recover active/completed runs where architecture supports it.
- Avoid spawning unnecessary background processes on Android.
- Clean up child processes after failed or cancelled tasks.
