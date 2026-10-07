# Environments

Single reference for which environments exist and how the code names them.
Items marked **verify** could not be confirmed from the repository alone and
need an owner to confirm against Railway / Clerk / Cloudflare.

## What exists

| Environment | Where | Notes |
| --- | --- | --- |
| Local dev | `pnpm dev` (port 3001), `pnpm terminal:dev` (terminal server, port 4001) | Client terminal URL resolves to `http://localhost:4001` unless `NEXT_PUBLIC_TERMINAL_HTTP_URL` / `NEXT_PUBLIC_TERMINAL_WS_URL` is set. It never falls back to the production terminal host. |
| Production | Railway (`RAILWAY.md`), `https://www.litlabs.net` | Deployed from `main`. Terminal server is a separate Railway service (`litlabs-terminal-server`). |
| Railway PR / preview deploys | **verify** | Not documented anywhere in the repo. If they exist, confirm they get their own `TERMINAL_PUBLIC_URL` and `TERMINAL_SERVER_INTERNAL_URL`. |
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

## Terminal-server URL resolution

- Server code: `getTerminalServerUrl()` in `src/lib/terminal-url.ts`
  (`TERMINAL_PUBLIC_URL` → `NEXT_PUBLIC_TERMINAL_WS_URL` → `NEXT_PUBLIC_TERMINAL_HTTP_URL` → legacy production host).
- Server-to-server: `resolveTerminalInternalUrl()` (no hardcoded host).
- Client components: `resolveClientTerminalUrl()` in `src/lib/terminal-url-client.ts`.
  Production builds keep the legacy production fallback; other builds do not.
- The legacy production host literal lives in `terminal-url-client.ts`
  (`LEGACY_PROD_TERMINAL_URL`). Remaining literals (CSP in `next.config.ts`,
  the CLI auth config, tests, docs) are tracked for a later phase.

**Risk to be aware of:** a *production-mode* deployment that forgets
`TERMINAL_PUBLIC_URL` / `NEXT_PUBLIC_TERMINAL_*` (for example a Railway
preview build, which runs with `NODE_ENV=production`) still talks to the
production terminal server. Removing that fallback is a behaviour change
that needs the Railway env vars confirmed first.

## CI and production

| Workflow | Touches production? |
| --- | --- |
| `build.yml`, `lighthouse.yml`, `migration-reproducibility.yml`, `companion.yml`, `secret-scan.yml` | No (local build / placeholder env) |
| `release-gate.yml` | Yes, read-only: hourly `GET /api/health` and terminal `/health`. Terminal URL overridable via repo variable `TERMINAL_BASE_URL`. |
| `deploy-terminal.yml` | Deploys the terminal service on `main` pushes touching `terminal-server/**`; post-deploy health check (same `TERMINAL_BASE_URL` override). |
| `prod-clerk-auth-smoke.yml` | Yes: signs a Clerk test user in on production. **Manual only.** |
| `final-acceptance-golden.yml` | Yes: full production journey with disposable users. **Manual only.** |
| `cron-deploy-digest.yml` | Weekday digest. |
