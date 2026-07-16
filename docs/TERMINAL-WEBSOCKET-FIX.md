# WebSocket Terminal Fix — Complete Guide

**Date:** 2026-07-15  
**Issue:** 9-second typing delay in terminal panel  
**Root Cause:** Terminal server not running, Socket.IO connection timeouts  
**Status:** ✅ Fixed with graceful fallbacks

---

## What You Built (CLI Module)

Your `cli/LiTTree.psm1` is a **PowerShell 7 CLI module** that calls the LiTTree REST API.

### Features
- `Invoke-Director "<goal>"` — Strategic planning & orchestration
- `Invoke-Builder "<task>"` — Hands-on code & shipping
- Two modes: `-Local` (preview prompts) or API mode (requires API key)
- **Status: ✅ Working** — Completely separate from WebSocket terminal

---

## The WebSocket Problem

Your Next.js app has a terminal component (`TerminalPanel.tsx`) that provides a real shell in the browser.

### What Was Broken
- ❌ Terminal server not running → port 4001 not listening
- ❌ Socket.IO tried to connect → timeout after ~9 seconds
- ❌ Every keystroke emitted to dead socket → React re-rendered
- ❌ No feedback to user
- ❌ 9-second lag on every character

### What's Fixed Now
- ✅ **Health check before connecting** — Fast 3-second timeout
- ✅ **Graceful fallback** — Terminal shows "Server Down" status
- ✅ **Clear messaging** — Shows how to start terminal server
- ✅ **No more lag** — Terminal works instantly in offline mode
- ✅ **Status indicators:** Server Down / Offline / Online

---

## Files Modified

1. `src/components/litt-terminal/TerminalPanel.tsx` — Added health check & graceful fallback
2. `terminal-server/server.ts` — Enhanced `/health` endpoint with uptime & active sessions
3. `package.json` — Changed dev to webpack mode on port 3001
4. `scripts/start-terminal-if-needed.ps1` — NEW: Auto-start script

---

## How to Use

### Start Terminal Server:
```powershell
# Option 1: Just terminal server
pnpm terminal:dev

# Option 2: Both servers at once
pnpm dev:all
```

### What You'll See:

**Offline Mode (No Lag):**
- 🟡 Server Down status
- "⚠ Terminal server not available"
- "Start it with: pnpm terminal:dev"
- No typing lag — instant feedback

**Online Mode (Full Shell):**
- 🟢 Online status with Wifi icon
- "✅ Connected to terminal server"
- Real PowerShell/Bash/Docker shell
- No typing lag

---

## Summary

✅ **Fixed:** WebSocket terminal now has health checks and graceful fallback
⚠️ **Action:** Start terminal server with `pnpm terminal:dev` for full features
✅ **Working:** PowerShell CLI module (`cli/LiTTree.psm1`) — no action needed

**Everything is fixed. Your CLI is separate and working perfectly.**
