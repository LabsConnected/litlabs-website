# Studio Health Report — 2026-06-08

> **TL;DR:** Studio shell is clean, well-grouped, and already cohesive. Tunnel "problem" was a naming illusion — `api_tunnel` + `n8n_tunnel` are actually one consolidated `cloudflared-main` service, which is currently **active and serving 200**. There's no `openclaw` CLI installed, so step 3 needs a small reframing.

---

## 1. Navigation & UX — Status: GOOD, no urgent changes

**Files reviewed**
- `src/app/studio/page.tsx` (235 lines)
- `src/app/studio/components/StudioSidebar.tsx` (196 lines)
- `src/components/Navbar.tsx` (324 lines)

**Current layout (already cohesive)**
- **Top-level Navbar** — logo, primary links (Home / Studio / Market / Agents), LitCoins wallet, notification bell, theme toggle, user menu, mobile hamburger
- **Studio shell** — sticky-top app shell with:
  - `StudioSidebar` on the left (Create / AI / Organize / External groups, collapsible 64↔196px, animated active dot, Ctrl+1-6 shortcuts, bottom status dot)
  - A Zed-style top bar with breadcrumb (Workspace / {activeTool}) + per-tool ModelBadge + coin balance + CRT toggle
  - Tool content area (lazy-loaded with `dynamic(...)` per tool)
  - Bottom marquee `StatusTicker`
- **Keyboard map** — Ctrl+1..6 jumps between tools, persisted CRT preference

**Quick-win observations (not blocking — pick & choose)**
1. **Model badge is static.** `MODEL_MAP` in `page.tsx` is hardcoded. If the user wants a real "active provider" indicator (e.g. flip FLUX↔Gemini for image tool when a fallback triggers), it would need a `useState` driven by tool health responses. Cheap to add.
2. **Coin balance is hardcoded `500`** in the top bar (line 179 of `page.tsx`). The wallet API exists at `/api/wallet` (per project history) but the studio top bar isn't reading it. Worth wiring to `useLocalStorageNumber` like Navbar does.
3. **Notification bell is hollow** (Navbar.tsx:181) — always says "No new notifications." A `/api/notifications` endpoint would make it real. Low priority.
4. **No global "Agent Chat" toolbar at the navbar level.** The Agent Chat tool lives at `/studio?tool=agents` via sidebar. If the user wants a persistent global entry point (a floating button or a navbar chip), that's the only "new toolbar" that would justify the plan's step 1 work. Current placement is already discoverable.

**Verdict:** The studio shell is already a cohesive control surface. The only "missing" element from the plan is a global Agent Chat entry point — that can be a single chip in the Navbar (between LitCoins and the bell) without touching StudioSidebar.

---

## 2. Backend tunnel health — Status: HEALTHY (with one naming fix)

**The naming trap**
`agents/system-brain/brain.sh` and `agents/monitor-agent/monitor.sh` reference services `litlabs-api-tunnel` and `n8n-tunnel`. **Those systemd units do not exist.** systemd reports:
```
● litlabs-api-tunnel.service    not-found inactive dead
● n8n-tunnel.service            not-found inactive dead
```

This is harmless today because the actual tunnel is `cloudflared-main.service` (active, running) which exposes both api.litlabs.net and litlabs.net through one Cloudflare tunnel config.

**Current state of the real tunnel stack (verified via WSL)**
```
cloudflared-main.service    loaded active running   Cloudflare Tunnel - Main (api + n8n)
litlabs-frontend.service    loaded active running   LitLabs Next.js Frontend
agent-bridge.service        loaded active running   LitLabs Agent Bridge (n8n webhook receiver)
agent-monitor.service       loaded active running   LitLabs Monitor Agent
```

**End-to-end probes**
```
https://api.litlabs.net  → 200
https://litlabs.net      → 200
```

**One real nit (non-blocking)**
Cloudflare precheck shows `UDP Connectivity ... QUIC connection failed` and auto-falls back to HTTP/2. Service is stable, just verbose logging. If the user wants to silence it: allow outbound UDP/7844 in the firewall. Not a fix — a polish.

**Action items — concrete commands**

A. **No restart needed.** Confirm the real service is alive:
```bash
wsl -e bash -c "systemctl status cloudflared-main --no-pager"
```

B. **If you do need to restart** (e.g. config change):
```bash
wsl -e bash -c "systemctl restart cloudflared-main && journalctl -u cloudflared-main -n 30 --no-pager"
```

C. **Optional: fix the brain/monitor scripts** so they stop logging phantom services. Suggested patch:

`agents/system-brain/brain.sh` line 18-19:
```bash
# OLD
local api_tunnel=$(systemctl is-active litlabs-api-tunnel 2>/dev/null)
local n8n_tunnel=$(systemctl is-active n8n-tunnel 2>/dev/null)
# NEW
local api_tunnel=$(systemctl is-active cloudflared-main 2>/dev/null)
local n8n_tunnel=$(systemctl is-active cloudflared-main 2>/dev/null)
```

`agents/monitor-agent/monitor.sh` line 32:
```bash
# OLD
for svc in litlabs-frontend litlabs-api-tunnel n8n-tunnel; do
# NEW
for svc in litlabs-frontend cloudflared-main agent-bridge; do
```

D. **Optional: document the new timer-less run pattern.** `monitor.sh` only runs when launched manually (no systemd timer is attached). If you want it to actually monitor 24/7, either:
- add a systemd timer: `agents/monitor-agent/monitor.service` + `monitor.timer` (5-min interval)
- or just leave it as a manual check tool, since systemd's own `Restart=on-failure` on cloudflared-main already covers the "tunnel died" case

---

## 3. Memory search & config — Status: NEEDS REFRAMING

**What the plan expected**
- A `memorySearch` provider setting
- An `openclaw memory index --force` command

**What actually exists**
- **No `openclaw` CLI** is installed on this machine. `Get-Command openclaw` returns "term not recognized."
- **No `openclaw.json`** in the project. The only `openclaw` reference is in `IDENTITY.md` (an avatar file path).
- The closest thing to "memory config" is `C:\Users\litbi\.mavis\memory\user.md` (Mavis's own agent memory layer), not an OpenClaw-style config file.

**My read:** the plan's step 3 was written from the OpenClaw mental model. In this workspace, the analogous concept is Mavis memory. The LLM client that *does* live here is the unified `src/lib/llm.ts` (per project history), which already has the failover chain:
- chat/creative/precise → **Gemini 2.5 Flash (primary)** → OpenRouter free → DeepSeek V3
- code → Qwen3 Coder free → Gemini → OpenRouter free
- json → Gemini (response_mime_type=application/json) → DeepSeek V3 → OpenRouter free

**So the equivalent "use OpenRouter" check is already done** at the lib layer. OpenRouter is the fallback (and `OPENROUTER_API_KEY` is in `.env.local`).

**Concrete commands to verify**
```bash
# Confirm OpenRouter key exists (don't dump the value)
wsl -e bash -c "grep -q OPENROUTER_API_KEY /home/litbit/LiTTreeLabstudios/.env.local && echo OK || echo MISSING"

# Check LLM provider health from the actual API
curl -s http://localhost:3000/api/llm/health | python -m json.tool

# Force-reindex memory (Mavis's layer, not openclaw)
mavis memory index --force   # if a memory indexer exists; otherwise skip
```

If the user actually meant **OpenClaw** (a separate tool) and wants it installed, that's a different conversation — needs to know what OpenClaw install method they want (npm? their installer?) and where it lives.

---

## 4. Quick verification — one-liner

```bash
wsl -e bash -c "systemctl is-active cloudflared-main litlabs-frontend agent-bridge agent-monitor | sed 's/^/  /'; echo '---'; curl -s -o /dev/null -w 'litlabs.net=%{http_code} api.litlabs.net=' --max-time 8 https://litlabs.net; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://api.litlabs.net"
```

**Expected output**
```
  cloudflared-main
  active
  active
  active
  active
---
litlabs.net=200 api.litlabs.net=200
```

---

## Summary of recommended actions

| # | Action | Effort | Status |
|---|--------|--------|--------|
| 1 | Add a global Agent Chat chip to Navbar (between LitCoins and bell) | 5 min | Optional |
| 1 | Wire `/api/wallet` to studio top bar coin badge | 10 min | Optional |
| 1 | Make ModelBadge reactive to real provider status | 30 min | Optional |
| 2 | Patch brain.sh + monitor.sh to use `cloudflared-main` | 2 min | **Recommended** |
| 2 | Add systemd timer for `agent-monitor.service` | 5 min | Optional |
| 3 | Verify OpenRouter key + run `/api/llm/health` | 1 min | **Recommended** |
| 3 | Clarify whether "openclaw" was a mental shortcut for Mavis memory | conversation | **Recommended** |

**No critical issues found.** Studio is shipping, tunnels are green, the LLM failover is already configured. The biggest win is just patching the two brain/monitor scripts so they don't log ghost services anymore.
