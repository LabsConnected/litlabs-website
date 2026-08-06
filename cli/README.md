# LiTTree CLI

Two tools live in `cli/`:

| Tool | Entry | Mode |
|------|-------|------|
| **LiTT-Code** | `litt-code` / `littcode` | Node.js REPL + chat |
| **LiTTree PowerShell 7 module** | `Import-Module LiTTree` | PowerShell cmdlets |

---

## 1 — LiTT-Code (Node.js)

Engineering agent shell. REPL by default, one-shot chat with a quoted prompt.

### Install

```powershell
cd cli
pnpm install        # installs tsx + typescript as dev deps
pnpm build          # compiles to cli/dist/litt-code-cli.js
```

### Use locally (tsx, no build needed)

```powershell
pnpm dev            # REPL
pnpm dev -- "explain closures"   # one-shot
pnpm dev repl
pnpm dev chat "build a login page"
```

### Register globally so `litt-code` works anywhere

```powershell
pnpm link --global  # registers cli package for your user
litt-code --help
```

`pnpm install` will auto-build via the `prepare` script.

### Configure an LLM backend

LiTT-Code supports **OpenRouter (cloud)** and **Ollama (local)**.

**Option A — OpenRouter** (recommended, no local server needed):

1. Get a key at https://openrouter.ai/keys
2. Set it in your shell profile:
   ```powershell
   $env:OPENROUTER_API_KEY = "sk-or-..."
   ```
3. Run:
   ```powershell
   litt-code
   litt-code "write a TypeScript debounce hook"
   ```

Default OpenRouter model: `google/gemini-2.5-flash`.
Override with `--model` or `LITT_CODE_MODEL`:
```powershell
litt-code --model openai/gpt-4o-mini "summarize this file"
```

**Option B — Ollama** (fully local, requires Ollama running):

1. Install Ollama, then `ollama pull llama3.2:3b`
2. Start the daemon: `ollama serve`
3. Use the `/ollama` command inside the REPL, or prefix the model:
   ```powershell
   litt-code --ollama "explain closures"
   # or set env:
   $env:LITT_CODE_MODEL = "ollama:llama3.2:3b"
   litt-code
   ```

### REPL commands

| Command | Action |
|---------|--------|
| `/help` / `?` | Show help |
| `/scan` | Scan current workspace |
| `/fix` | Suggest project fixes |
| `/build` | Run build and explain errors |
| `/deploy` | Show deployment instructions |
| `/commit <msg>` | Generate git commit command |
| `/agent <name>` | Explain agent creation |
| `/feature <name>` | Explain adding a feature |
| `/explain <cmd>` | Explain a shell command |
| `/model <name>` | Switch OpenRouter model |
| `/ollama` | Switch to local Ollama |
| `/clear` | Clear screen |
| `/exit` / `/quit` / Ctrl+C | Exit REPL |

### Env vars

| Var | Purpose | Default |
|-----|---------|---------|
| `OPENROUTER_API_KEY` | OpenRouter auth | — |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://localhost:11434` |
| `LITT_CODE_MODEL` | Default model id or `ollama:<name>` | `google/gemini-2.5-flash` |
| `NEXT_PUBLIC_SITE_URL` | OpenRouter HTTP-Referer | `https://litlabs.net` |

---

## 2 — MyAios CLI

Terminal interface for the MyAios Brain — manage services, bookings, leads, config, and more.

### Use locally (no build needed)

```powershell
pnpm dev:myaios -- --help
pnpm dev:myaios -- list-services
pnpm dev:myaios -- get-config
pnpm dev:myaios -- create-lead --name "Jane Doe" --email "jane@example.com" --phone "555-1234"
```

### Register globally

```powershell
pnpm link --global
myaios --help
myaios list-services
```

### Configuration

| Var | Purpose | Default |
|-----|---------|---------|
| `MYAIOS_URL` | API base URL | `https://litlabs.net` |
| `INTERNAL_API_KEY` | API auth key | — |
| `MYAIOS_OWNER_ID` | Owner ID for operations | — |

Or pass via flags: `--url`, `--key`, `--owner`

### Commands

| Command | Action |
|---------|--------|
| `get-config` | Get MyAios configuration |
| `update-config` | Update config (business name, greeting, hours, etc.) |
| `list-services` | List all active services |
| `get-service <id>` | Get a single service |
| `create-service` | Create a new service |
| `delete-service <id>` | Delete a service |
| `get-slots <id> <date>` | Get available booking slots |
| `create-booking` | Create a booking |
| `get-booking <id>` | Get a booking by ID |
| `find-bookings <email>` | Find bookings by customer email |
| `reschedule-booking <id> <date> <time>` | Reschedule a booking |
| `cancel-booking <id>` | Cancel a booking |
| `create-lead` | Capture a lead |
| `update-lead <id> <status>` | Update lead status |
| `escalate` | Create a human escalation |
| `dashboard` | Get dashboard summary |
| `staff-hours` | Get staff availability |
| `update-staff-hours` | Update staff hours |

---

## 3 — LiTTree PowerShell 7 module

Installs `Invoke-Director`, `Invoke-Builder`, `Get-LiTTreeAgent` etc.

```powershell
irm https://raw.githubusercontent.com/LabsConnected/litlabs-website/main/cli/install.ps1 | iex
Import-Module LiTTree -Force
Get-LiTTreeAgent
```

Set an API key if you want to call the live backend:
```powershell
Set-LiTTreeConfig -ApiKey "your_key_from_settings"
```
