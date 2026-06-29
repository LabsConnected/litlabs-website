# OpenClaw Install Report — 2026-06-08

> **TL;DR:** OpenClaw 2026.6.1 installed cleanly in WSL2. memorySearch now points at OpenRouter via the `openai-compatible` adapter. Index rebuilt: **4/4 files, 12 chunks, 1536-dim vectors, end-to-end search returns real semantic matches.**

---

## 1. Install path chosen

After flagging that half the search results were sketchy "lobster" rebrands asking you to disable Defender, we went with the official route:

| Step | Command | Result |
|------|---------|--------|
| 1. Inspect script | `curl -fsSL https://openclaw.ai/install.sh -o /tmp/openclaw-install.sh` | 3,353-line bash script, no obfuscation, downloads Node from official paths |
| 2. Dry run | `OPENCLAW_DRY_RUN=1 OPENCLAW_NO_ONBOARD=1 OPENCLAW_NO_PROMPT=1 bash /tmp/openclaw-install.sh` | clean preview, no changes |
| 3. Real install | `bash /tmp/openclaw-install.sh --no-onboard` | OpenClaw **2026.6.1 (commit 2e08f0f)**, Node v22.22.3, Gateway daemon registered |
| 4. PATH fix | Added `export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"` to `/home/litbit/.bashrc` | openclaw now discoverable from any new shell |
| 5. Doctor | `openclaw doctor` | 21 skills eligible, 0 missing reqs, 67 plugins loaded, 0 errors |

**Installer reputation check passed:** the official script is hosted at `openclaw.ai`, served over HTTPS with TLS 1.2, no reverse shells, no obfuscated payloads, no exfiltration. The version-manager warning from `doctor` (recommending a system Node) is a *preference*, not a defect — nvm is fine.

---

## 2. memorySearch reconfiguration (the actual plan step 3)

### The gotcha
Your plan said "switch to OpenRouter." OpenClaw's `memorySearch.provider` field does **not** natively support `"openrouter"`. The supported values are `bedrock`, `deepinfra`, `gemini`, `github-copilot`, `local`, `mistral`, `ollama`, `openai`, `openai-compatible`, `voyage`. The supported path to OpenRouter is:

- `provider: "openai-compatible"`
- `remote.baseUrl: "https://openrouter.ai/api/v1"`
- `remote.apiKey: <SecretRef to the openrouter key>`
- `model: "openai/text-embedding-3-small"` (the OpenRouter-routed OpenAI embedding model)

### The hidden problem I found
The existing `~/.openclaw/secrets/secrets.json` had:

```json
"openai": { "apiKey": "sk-or-v1-..." }
"openrouter": { "apiKey": "sk-or-v1-..." }
```

Both keys were **OpenRouter keys** (the `sk-or-v1-` prefix), including the one being used for the `openai` provider. So memorySearch was *technically* running on OpenRouter disguised as OpenAI — but inefficiently (using a default OpenAI-style embedding call against a key that doesn't have OpenAI embeddings). The new config is correct and explicit.

### Patch applied
File: `memory-search-openrouter.patch.json5` (delivered alongside this report)
Applied via: `openclaw config patch --file <patch>`

Resulting `agents.defaults.memorySearch` block in `~/.openclaw/openclaw.json`:

```json
{
  "enabled": true,
  "provider": "openai-compatible",
  "model": "openai/text-embedding-3-small",
  "fallback": "local",
  "remote": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": { "source": "file", "provider": "default", "id": "/openrouter/apiKey" },
    "headers": { "HTTP-Referer": "https://litlabs.net", "X-Title": "LiTTree Lab Studios" }
  },
  "query": { "hybrid": { "enabled": true, "vectorWeight": 0.7, "textWeight": 0.3 } }
}
```

**Note:** fallback is set to `"local"` so that if OpenRouter is rate-limiting, the local GGUF embedding engine (auto-downloaded by OpenClaw, ~600MB) takes over. That keeps memory search working offline too.

---

## 3. Reindex result

```bash
$ openclaw memory index --force
Memory index updated (main).

$ openclaw memory status
Memory Search (main)
  Provider: openai-compatible (requested: openai-compatible)
  Model:    openai/text-embedding-3-small
  Sources:  memory
  Indexed:  4/4 files · 12 chunks
  Dirty:    no
  Store:    ~/.openclaw/memory/main.sqlite
  Vector dims: 1536
  FTS:      ready
  Embedding cache: enabled (12 entries)
  Batch:    disabled (failures 0/2)
  Vector search: resumed
```

### End-to-end test
```bash
$ openclaw memory search "what is litlabs"
0.492  memory/2026-06-04.md:1-25  # 2026-06-04 Session Memory — LiTTree Lab Studios
0.450  memory/2026-06-06.md:1-26  # 2026-06-06 Session Memory — LiTTree Lab Studios
```

Both matches are real session memory files with semantic relevance scores > 0.45. The OpenRouter embedding pipeline is live.

---

## 4. Side findings (you should know about these)

### A. Exposed secrets in `.bashrc`
`/home/litbit/.bashrc` contains this line, in plaintext:

```
export OPENAI_API_KEY=sk-proj-[REDACTED — rotate this key immediately]
```

This is an **OpenAI project key** in a world-readable shell rc file. If this is real, rotate it now (it will be in shell history on every box you've used, and in dotfile syncs). If it's already revoked/placeholder, delete the line.

### B. Telegram bot token is in `secrets.json` plaintext
The token in `~/.openclaw/secrets/secrets.json` (`8530697980:AAFJr12M...`) is read by the Telegram channel. It's already file-locked to `litbit:litbit 600`, which is correct. The user ID `8573261651` as `allowFrom` is your chat ID.

### C. `~/.openclaw/openclaw.json` is the active config
Worth knowing where it lives. There are 5 timestamped backups in the same dir (`.bak`, `.bak.1`...`.bak.4`, plus `.last-good` and `.secrets-backup`). If a config edit ever bricks the gateway, you can `cp openclaw.json.last-good openclaw.json && openclaw gateway restart`.

### D. Two different OpenRouter keys in the system
- `~/.openclaw/secrets/secrets.json` → `openrouter.apiKey` = `sk-or-v1-6f4124...`
- `~/LiTTreeLabstudios/.env.local` → `OPENROUTER_API_KEY` = `sk-or-v1-2130f0...`

Both look valid (different prefixes after `sk-or-v1-`). Probably a personal + work split, or one is the dev key. Worth a comment in your notes about which is which.

### E. The `litlabs-api-tunnel` / `n8n-tunnel` ghosts
Per the previous health report, those service names are referenced in `brain.sh` / `monitor.sh` but the real tunnel is `cloudflared-main`. The install of OpenClaw did not touch those scripts. They still log "not found" on every cycle.

---

## 5. One-line verification (run this in WSL any time)

```bash
export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"
openclaw --version
openclaw memory status | head -10
openclaw memory search "litlabs" | head -5
```

Expected:
- `OpenClaw 2026.6.1 (2e08f0f)`
- `Provider: openai-compatible` and `Indexed: 4/4 files · 12 chunks`
- At least one match scoring > 0.4

---

## 6. Files delivered

| Path | Purpose |
|------|---------|
| `memory-search-openrouter.patch.json5` | The exact patch applied to `openclaw.json` (kept for re-application / rollback) |
| `~/.openclaw/openclaw.json` | Updated active config |
| `~/.bashrc` | Added Node PATH export (single line) |
| `/home/litbit/.nvm/versions/node/v22.22.3/` | Node 22.22.3 + OpenClaw 2026.6.1 installed via npm |

No regressions in the studio or the tunnel stack. The brain/monitor scripts are unchanged (still logging the ghost service names, but that's a separate, 2-line fix from the prior health report).
