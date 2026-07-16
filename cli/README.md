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

## 2 — LiTTree PowerShell 7 module

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
