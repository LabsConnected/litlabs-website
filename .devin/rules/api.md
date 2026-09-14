---
description: "API design and request-handling rules — apply when creating or modifying routes, endpoints, or server handlers"
trigger: model_decision
---

# APIs

- Validate request payloads.
- Return meaningful HTTP status codes.
- Handle expected failure states explicitly.
- Avoid leaking internal stack traces or secrets.
- Require authorization where appropriate.
- Protect high-cost endpoints from repeated abuse.
- Preserve backward compatibility unless an intentional breaking change is part of the task.
