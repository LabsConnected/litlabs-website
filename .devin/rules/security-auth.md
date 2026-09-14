---
description: "Security, authentication, authorization, and tenant-isolation rules for all work in this repo"
trigger: always_on
---

# Security, Auth & Tenant Isolation

- Never expose secrets, tokens, API keys, cookies, credentials, or private environment variables; never print secret values into logs.
- Never commit `.env` files containing secrets; do not put server secrets in client bundles.
- Validate authentication and authorization on server-side privileged operations.
- Never trust client-provided user IDs, project IDs, tenant IDs, file paths, or permissions without server verification.
- Prevent tenant/project crossover; validate and normalize filesystem paths; prevent path traversal.
- Treat terminal/shell input as untrusted; avoid shell interpolation where structured process execution can be used; validate tool inputs before execution.
- Verify webhook signatures; protect expensive endpoints from abuse.
- Do not weaken RLS, authentication, authorization, or billing controls just to fix a test or unblock development.
- Inspect dependencies and generated changes before accepting security-sensitive modifications.
