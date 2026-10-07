# Environments

Single reference for which environments exist and how the code names them.
Items marked **verify** could not be confirmed from the repository alone and
need an owner to confirm against Railway / Clerk / Cloudflare.

## What exists

| Environment | Where | Notes |
| --- | --- | --- |
| Local dev | `pnpm dev` (port 3001), `pnpm terminal:dev` (terminal server, port 4001) | Terminal URL resolves to `http://localhost:4001` unless overridden. Never falls back to a production host. |
| Production | Railway project `litlabs-terminal-server`, environment `production`, service `web` (`RAILWAY.md`), `https://www.litlabs.net` | Deployed from `main`. Explicitly defines `NEXT_PUBLIC_TERMINAL_HTTP_URL`, `NEXT_PUBLIC_TERMINAL_WS_URL` and `TERMINAL_SERVER_INTERNAL_URL` (`TERMINAL_PUBLIC_URL` is not set; not needed). |
| Railway PR / preview deploys | Railway projects/services such as `web-phase3b-630` + `terminal-phase3b-630` | Each must define its own terminal URLs. **Do not key logic on `RAILWAY_ENVIRONMENT_NAME`**: at least one preview project also names its environment `production`. |
| Staging | **verify** | No staging environment is documented. See "Naming" below. |

Vercel is not a hosting target (Railway is production). Remaining Vercel
references in code are legacy and tracked for separate cleanup.

## Naming in code (`preview` / `staging` / `production`)

`src/lib/deployments.ts` defines `DeployEnvironment = "preview" | "staging" | "production"`
and `inferEnvironment(branch)`:

- `main` / `master` → `production`
- branch starting with `staging` or `release` → `staging`
- anything else → `preview`

This describes **user-project deploys** and the deploy tools exposed to LiTT
and Vapi (`project-tools/registry.ts`, `vapi-tool-definitions.ts`), derived
from a branch name. It does **not** mean the LiTTree platform itself has a
staging environment. Do not use it to reason about platform environments.

## Terminal-server URL resolution (fail closed)

There is **no implicit production fallback**. A deployment that does not
explicitly configure a terminal URL gets an unconfigured state, never the
production terminal. Localhost (`http://localhost:4001`) is a
development-only default (`NODE_ENV !== "production"`).

- Server resolver: `getTerminalServerUrl()` in `src/lib/terminal-url.ts`
  (`TERMINAL_PUBLIC_URL` -> `NEXT_PUBLIC_TERMINAL_WS_URL` -> `NEXT_PUBLIC_TERMINAL_HTTP_URL`;
  `""` in production when none is set).
- Server callers that make requests use `requireTerminalBaseUrl()` /
  `terminalNotConfiguredResponse()` in `src/lib/terminal-config.ts`
  (`TERMINAL_SERVER_INTERNAL_URL` first, then the resolver). When
  unconfigured, the Studio project API routes (files, files/raw, assets/insert,
  workspace-state, publish-readiness, checks, checks/run-all, checkpoints POST)
  return `503 {"code":"terminal_not_configured"}`, and library callers
  (workspace transport/checkpoints, mission executor, visual builds, project
  tools) throw `TerminalNotConfiguredError` (status 503). Status/health probes
  (`integrations/status`, `capabilities/project-terminal`) report not
  configured / unreachable instead of probing an empty URL.
- Server-to-server only: `resolveTerminalInternalUrl()` (unchanged).
- Client components: `resolveClientTerminalUrl()` in `src/lib/terminal-url-client.ts`.
  Production builds return `""` (the UI shows "not configured") when no
  non-localhost URL is set.
- `NEXT_PUBLIC_*` values are inlined at **build time**. A service that sets
  them only at runtime will see the client resolver fail closed.
- Every environment that serves the app (production `web`, each PR/preview
  web service) must explicitly define `NEXT_PUBLIC_TERMINAL_HTTP_URL` or
  `NEXT_PUBLIC_TERMINAL_WS_URL` and `TERMINAL_SERVER_INTERNAL_URL`.
- Remaining production-host literals (CSP in `next.config.ts`, the CLI auth
  config, tests, docs) are not fallbacks and are tracked for a later phase.

## CI and production

| Workflow | Touches production? |
| --- | --- |
| `build.yml`, `lighthouse.yml`, `migration-reproducibility.yml`, `companion.yml`, `secret-scan.yml` | No (local build / placeholder env) |
| `release-gate.yml` | Yes, read-only: hourly `GET /api/health` and terminal `/health`. Terminal URL overridable via repo variable `TERMINAL_BASE_URL`. |
| `deploy-terminal.yml` | Deploys the terminal service on `main` pushes touching `terminal-server/**`; post-deploy health check (same `TERMINAL_BASE_URL` override). |
| `prod-clerk-auth-smoke.yml` | Yes: signs a Clerk test user in on production. **Manual only.** |
| `final-acceptance-golden.yml` | Yes: full production journey with disposable users. **Manual only.** |
| `cron-deploy-digest.yml` | Weekday digest. |
