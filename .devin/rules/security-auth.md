---
description: "Security, authentication, and authorization rules for all work in this repo"
trigger: always_on
---

# Security & Auth

- Never expose secrets, tokens, API keys, cookies, credentials, or private environment variables.
- Never print secret values into logs.
- Validate authentication and authorization on server-side privileged operations.
- Never trust client-provided user IDs, project IDs, tenant IDs, file paths, or permissions without server verification.
- Prevent tenant/project crossover.
- Validate and normalize filesystem paths.
- Prevent path traversal.
- Treat terminal/shell input as untrusted.
- Avoid shell interpolation where structured process execution can be used.
- Validate tool inputs before execution.
- Verify webhook signatures.
- Protect expensive endpoints from abuse.
- Do not weaken RLS, authentication, authorization, or billing controls just to fix a test or unblock development.
- Do not put server secrets in client bundles.
- Never commit `.env` files containing secrets.
- Inspect dependencies and generated changes before accepting security-sensitive modifications.
