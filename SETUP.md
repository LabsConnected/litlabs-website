# LiTTree OS LiTT Terminal Setup

This adds a real browser-based terminal to `https://litlabs.net/litt-terminal`.

## Architecture

```text
Browser (xterm.js)
  ↓ WebSocket / Socket.IO
Next.js app (frontend)
  ↓ REST API
LiTT AI helper (/api/litt/command)
  ↓
Terminal Server (Node.js + node-pty) [run on VPS / Railway / Fly.io / Render]
  ↓
Docker sandbox (optional, recommended for production)
```

**Important:** The terminal server does NOT run on Vercel. It must run on a separate Linux machine or container platform.

## Install

Frontend + backend dependencies are already added to the main `package.json`.

```bash
pnpm install
```

## Run locally

### 1. Start the terminal server

```bash
pnpm terminal:dev
```

This starts the WebSocket server on `http://localhost:4001`.

### 2. Build the Docker sandbox image (optional)

```bash
pnpm terminal:build-image
```

### 3. Start the Next.js app

```bash
pnpm dev
```

### 4. Run both together

```bash
pnpm dev:all
```

## Environment variables

Add to your `.env.local`:

```env
# Frontend connects here
NEXT_PUBLIC_TERMINAL_WS_URL=http://localhost:4001

# Terminal server
TERMINAL_SERVER_PORT=4001
TERMINAL_ALLOWED_ORIGIN=http://localhost:3000
TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces
TERMINAL_USE_DOCKER=false

# Docker sandbox
DOCKER_TERMINAL_IMAGE=littree-terminal:latest

# AI fallback
OPENROUTER_API_KEY=your_key

# Facebook Page publishing (server-side only)
FACEBOOK_PAGE_ID=your_page_id
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token
```

For production:

```env
NEXT_PUBLIC_TERMINAL_WS_URL=https://your-terminal-server.com
TERMINAL_ALLOWED_ORIGIN=https://litlabs.net
TERMINAL_USE_DOCKER=true
TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces
```

## Terminal isolation options

The terminal server supports three isolation modes. Choose one before launch:

| Mode | Env | Isolation | Where it works |
|------|-----|-----------|----------------|
| Host PTY | `TERMINAL_USE_DOCKER=false` | None. Commands run on the host shell. | Railway default, local dev |
| Docker | `TERMINAL_USE_DOCKER=true` | Container + resource limits + read-only rootfs | Self-hosted VM, Render, Fly.io |
| Sandbox provider | future flag | Ephemeral VM/sandbox per session | E2B, Fly Machines, CodeSandbox |

### Current production recommendation

Railway does **not** provide a Docker daemon inside the container. The safest current production path is:

1. Keep `TERMINAL_USE_DOCKER=false`
2. Mount a Railway persistent volume at `/data/littree-workspaces`
3. Keep command blocking + audit logging enabled
4. Treat the terminal server as a multi-tenant shared host until sandbox provider integration is added

If you need stronger isolation, move the terminal server to a provider that exposes a Docker daemon or a sandbox runtime.

## Workspace persistence

Cloned repositories are stored under `TERMINAL_WORKSPACE_ROOT`. Without a persistent volume, workspaces are lost on every Railway restart.

### Local (`docker-compose.yml`)

A named volume is already configured:

```yaml
volumes:
  littree-workspaces:/data/littree-workspaces
```

### Railway

1. In the Railway dashboard, create a **Volume** for the terminal service.
2. Mount it at `/data/littree-workspaces`.
3. Set `TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces`.

If you do not mount a volume, the server logs a startup warning and workspaces will be ephemeral.

## Deploy the terminal server

### Option A: Railway / Render / Fly.io

1. Create a new Node.js service.
2. Set environment variables.
3. Start command: `node terminal-server/dist/server.js` or `pnpm terminal:start`.
4. Expose port `4001` (or whatever `TERMINAL_SERVER_PORT` is).

### Option B: Docker Compose

```yaml
services:
  terminal:
    build:
      context: .
      dockerfile: docker/Dockerfile.terminal
    command: ["npx", "tsx", "terminal-server/server.ts"]
    ports:
      - "4001:4001"
    environment:
      - TERMINAL_SERVER_PORT=4001
      - TERMINAL_ALLOWED_ORIGIN=https://litlabs.net
      - TERMINAL_USE_DOCKER=false
    volumes:
      - /tmp/littree-workspaces:/tmp/littree-workspaces
```

## Security rules

1. **Never run the terminal server as root.**
2. **Never expose the host server shell directly.** Use Docker sandbox in production.
3. **Every user gets an isolated workspace.**
4. **Block destructive commands.** (see `terminal-server/security.ts`)
5. **Redact secrets from output.**
6. **Limit CPU/RAM/time per session.** Docker flags are set.
7. **Kill idle sessions.**
8. **Log command history.** (see `CommandHistory` component)
9. **Require Clerk auth.** API routes and frontend require sign-in.
10. **Admin-only elevated commands.** Add role checks later.

## Files added

- `src/app/litt-terminal/page.tsx` — terminal page
- `src/components/litt-terminal/*` — terminal UI components
- `src/app/api/litt/command/route.ts` — LiTT AI helper
- `terminal-server/server.ts` — WebSocket terminal server
- `terminal-server/security.ts` — command blocking + secret redaction
- `terminal-server/docker-manager.ts` — Docker sandbox session manager
- `terminal-server/tsconfig.json` — server TypeScript config
- `docker/Dockerfile.terminal` — sandbox image
- `terminal-server/Dockerfile` — production terminal server image
- `terminal-server/railway.json` — Railway deployment config
- `terminal-server/fly.toml` — Fly.io deployment config
- `render.yaml` — Render deployment config
- `docker-compose.yml` — local frontend + terminal server
- `SETUP.md` — this file

## Next steps

1. Run `pnpm dev:all` locally and test the terminal.
2. Apply the Supabase migrations in `supabase/migrations/`.
3. Deploy the terminal server using Railway, Render, Fly.io, or Docker.
4. Set `NEXT_PUBLIC_TERMINAL_WS_URL` in Vercel to the deployed terminal server URL.
5. Set `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` for the Deploy button.
6. Build the sandbox image (`pnpm terminal:build-image`) and enable `TERMINAL_USE_DOCKER=true` in production.

## Phase roadmap

- **Phase 1-4 (done):** xterm UI, WebSocket backend, node-pty, auth guard.
- **Phase 5 (done):** Command history persistence via `/api/terminal/history`.
- **Phase 6 (done):** Docker sandboxing files and scripts.
- **Phase 7 (done):** LiTT AI helper with `litt-code <command>` terminal commands.
- **Phase 8 (done):** File explorer + Monaco editor.
- **Phase 9 (done):** Deploy button + agent runner.
- **Phase 10 (done):** Admin roles + usage limits.
