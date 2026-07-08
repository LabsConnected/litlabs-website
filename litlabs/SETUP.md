# LiTTree OS LiTTree LiT Terminal Setup

This adds a real browser-based terminal to `https://litlabs.net/lit-terminal`.

## Architecture

```
Browser (xterm.js)
  ↓ WebSocket / Socket.IO
Next.js app (frontend)
  ↓ REST API
LiTTree LiT AI helper (/api/lit/command)
  ↓
Terminal Server (Node.js + node-pty) [run on VPS / Railway / Fly.io / Render]
  ↓
Docker sandbox (optional, recommended for production)
```

**Important:** The terminal server does NOT run on Vercel. It must run on a separate Linux machine or container platform.

## Install

Frontend + backend dependencies are already added to the main `package.json`.

```bash
npm install
```

## Run locally

### 1. Start the terminal server

```bash
npm run terminal:dev
```

This starts the WebSocket server on `http://localhost:4001`.

### 2. Build the Docker sandbox image (optional)

```bash
npm run terminal:build-image
```

### 3. Start the Next.js app

```bash
npm run dev
```

### 4. Run both together

```bash
npm run dev:all
```

## Environment variables

Add to your `.env.local`:

```env
# Frontend connects here
NEXT_PUBLIC_TERMINAL_WS_URL=http://localhost:4001

# Terminal server
TERMINAL_SERVER_PORT=4001
TERMINAL_ALLOWED_ORIGIN=http://localhost:3000
TERMINAL_WORKSPACE_ROOT=/tmp/littree-workspaces
TERMINAL_USE_DOCKER=false

# Docker sandbox
DOCKER_TERMINAL_IMAGE=littree-terminal:latest

# AI fallback
OPENROUTER_API_KEY=your_key
```

For production:

```env
NEXT_PUBLIC_TERMINAL_WS_URL=https://your-terminal-server.com
TERMINAL_ALLOWED_ORIGIN=https://litlabs.net
TERMINAL_USE_DOCKER=true
```

## Deploy the terminal server

### Option A: Railway / Render / Fly.io

1. Create a new Node.js service.
2. Set environment variables.
3. Start command: `node terminal-server/dist/server.js` or `npm run terminal:start`.
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

- `src/app/lit-terminal/page.tsx` — terminal page
- `src/components/lit-terminal/*` — terminal UI components
- `src/app/api/lit/command/route.ts` — LiTTree LiT AI helper
- `terminal-server/server.ts` — WebSocket terminal server
- `terminal-server/security.ts` — command blocking + secret redaction
- `terminal-server/docker-manager.ts` — Docker sandbox session manager
- `terminal-server/tsconfig.json` — server TypeScript config
- `docker/Dockerfile.terminal` — sandbox image
- `terminal-server/Dockerfile` — production terminal server image
- `terminal-server/railway.json` — Railway deployment config
- `render.yaml` — Render deployment config
- `docker-compose.yml` — local frontend + terminal server
- `SETUP.md` — this file

## Next steps

1. Run `npm run dev:all` locally and test the terminal.
2. Apply the Supabase migrations in `supabase/migrations/`.
3. Deploy the terminal server using Railway, Render, or Docker.
4. Set `NEXT_PUBLIC_TERMINAL_WS_URL` in Vercel to the deployed terminal server URL.
5. Set `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` for the Deploy button.
6. Build the sandbox image (`npm run terminal:build-image`) and enable `TERMINAL_USE_DOCKER=true` in production.

## Phase roadmap

- **Phase 1-4 (done):** xterm UI, WebSocket backend, node-pty, auth guard.
- **Phase 5 (done):** Command history persistence via `/api/terminal/history`.
- **Phase 6 (done):** Docker sandboxing files and scripts.
- **Phase 7 (done):** LiTTree LiT AI helper with `lit <command>` terminal commands.
- **Phase 8 (done):** File explorer + Monaco editor.
- **Phase 9 (done):** Deploy button + agent runner.
- **Phase 10 (done):** Admin roles + usage limits.
