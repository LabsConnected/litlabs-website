# LitLabs Architectural Manifest

This file maps the canonical file structure for the LitLabs Autonomous Media Matrix. Use this as your reference to maintain perfect consistency between development environments (Termux/Phone & Windows PC).

## 1. Directory Structure
```text
/LitLabs/
├── api/             # Backend Express server (litlabs-api)
├── ai-engine/       # Autonomous chat-agent.js & workflow logic (litlabs-n8n)
├── frontend/        # Next.js web application (litlabs-ai)
├── sync/            # Google Drive Mount Point (litlabs.json state store)
├── storage/         # Local assets, logs, and temp media
└── config/          # .env files and shared secrets
```

## 2. Synchronization Protocol
- **Logic (Code):** Managed via `git`. Always `push` from the Phone/Controller node and `pull` on the PC/Compute node.
- **State (Data):** Managed via Google Drive `sync/`. 
    - Phone path: `~/litlabs-sync/litlabs.json`
    - PC path: `[GDrive_Path]/LitLabs/litlabs.json`
- **Dependencies:** Never commit `node_modules` or local `.env` files.

## 3. Maintenance Commands
- **Check Health:** `curl http://localhost:3000/health`
- **Monitor Queue:** `curl http://localhost:3000/api/queue`
- **Trigger Cycle:** Manually inject into `sync/litlabs.json` or call the `/api/queue/update` endpoint.

---
*Maintained by the LitLabs System Brain.*
EOF
