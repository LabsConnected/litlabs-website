---
description: "API design and request-handling rules — apply when creating or modifying routes, endpoints, or server handlers"
trigger: model_decision
---

# APIs

- Validate request payloads; return meaningful HTTP status codes; handle expected failure states explicitly.
- Avoid leaking internal stack traces or secrets; require authorization where appropriate.
- Protect high-cost endpoints from repeated abuse.
- Preserve backward compatibility unless an intentional breaking change is part of the task.
