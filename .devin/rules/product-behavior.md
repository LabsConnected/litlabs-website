---
description: "LiTT product truthfulness rules — apply to all user-facing state, status, and success reporting"
trigger: always_on
---

# LiTT Product Behavior

- Prefer truthful UI state over optimistic/fake success states.
- Never report preview, deploy, agent, terminal, model, billing, or build success until the backend confirms it.
- Recover server-side state after client disconnects whenever possible.
- A browser disconnect must not automatically cancel server-side work.
- Intentional user Stop/Cancel actions must cancel the run.
- Finished server-side runs should be recoverable after reload/reconnect.
- Preview should start automatically when appropriate rather than requiring unnecessary manual user actions.
- User-visible errors must explain what failed and provide a meaningful recovery path.
- Do not expose raw internal exceptions unnecessarily to end users.
