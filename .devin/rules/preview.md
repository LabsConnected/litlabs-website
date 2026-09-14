---
description: "Preview startup/status rules — apply when working on Studio preview, dev servers, or runtime readiness"
trigger: model_decision
---

# Preview & Runtime

- Treat preview startup as a first-class workflow.
- If preview is not started and the user expects a preview, start it automatically where safe.
- Differentiate `not_started`, `starting`, `ready`, `unreachable`, and `failed`.
- Do not label `not_started` as `offline` or `failed`.
- Retry transient startup failures conservatively.
- Avoid duplicate preview-start requests.
- Surface useful retry/details controls when preview genuinely fails.
