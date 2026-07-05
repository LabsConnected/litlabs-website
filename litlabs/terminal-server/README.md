# LiTTree Jarvis Terminal Server

Backend for the Jarvis terminal, file system, agents, and logs.

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, create a new project from this repo.
3. Set the service start command to:

   ```bash
   cd terminal-server && npm install && npm start
   ```

4. Add the environment variables below.

## Environment variables

```env
PORT=4001
TERMINAL_ALLOWED_ORIGINS=https://litlabs.net,https://www.litlabs.net
TERMINAL_WORKSPACE_ROOT=/tmp/littree-workspaces

CLERK_SECRET_KEY=sk_...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

OPENROUTER_API_KEY=sk-or-...
GEMINI_API_KEY=...
GROQ_API_KEY=gsk_...

STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Endpoints

- `GET /health` — health check
- `GET /api/files?path=` — list files
- `POST /api/files/create` — create file
- `POST /api/files/update` — update file
- `POST /api/files/read` — read file
- `POST /api/files/delete` — delete file
- `POST /api/terminal/session` — create session
- `WS /terminal` — WebSocket terminal
- `POST /api/agents/run` — run agent
- `POST /api/agents/stop` — stop agent
- `GET /api/logs` — get logs
- `POST /api/deploy` — request deploy

## Frontend env

```env
NEXT_PUBLIC_API_URL=https://your-railway-api.up.railway.app
NEXT_PUBLIC_WS_URL=wss://your-railway-api.up.railway.app
```

> In production, the frontend on Vercel connects to Railway for terminal and file API.
