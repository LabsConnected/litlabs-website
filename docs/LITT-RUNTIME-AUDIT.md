# LiTT Runtime Truth-Audit

**Date:** 2026-08-13  
**Status:** DIAGNOSTIC — proven runtime state before any Termux or core extraction work.

---

## 1. What `litt` Actually Is Today

There are **three competing `litt` commands** on this machine. Only one works.

### Command #1: PowerShell function → `LiTT-Code.ps1` (THE REAL ONE)

```
Profile:  function global:litt { & "$HOME\LiTT\LiTT-Code.ps1" @args }
File:     C:\Users\litbi\LiTT\LiTT-Code.ps1  (39.6 KB, 1050 lines)
Updated:  2026-08-12 01:25
Status:   ACTIVE — this is what runs when you type `litt`
```

This is a **PowerShell 7 interactive cockpit shell** that:
- Renders a banner, status panels, quick actions, and a live bottom status bar
- Runs a heartbeat runspace (pings the brain every 20s)
- Streams LLM responses via NDJSON from a child Node process
- Has slash commands: `/status /ask /do /model /check /build /test /diff /git /web /doctor /studio /local /help`
- Falls through to `Ask-LiTT` for free text

**The actual brain is NOT in PowerShell.** The PowerShell script is a **renderer + command dispatcher**. It shells out to a Node/TypeScript process for all LLM work.

### Command #2: pnpm global shim → `@litt/code-cli` (DEAD)

```
Shim:     C:\Users\litbi\AppData\Local\pnpm\litt.ps1
Points:   E:\LiTTreeLabStudio Prod\cli\dist\litt-code-cli.js
Status:   DEAD — E:\LiTTreeLabStudio Prod was deleted (archive cleanup)
```

This was a `pnpm install -g @litt/code-cli` from the old archive. The archive is gone. The shim exists but crashes on use. The PowerShell profile function shadows it, so it never actually runs — but it's confusing noise on PATH.

### Command #3: `C:\Users\litbi\LiTT\litt.ps1` (OLDER, SHADOWED)

```
File:     C:\Users\litbi\LiTT\litt.ps1  (32.9 KB, 850 lines)
Updated:  2026-08-11 18:54
Status:   SHADOWED — never called, the profile function calls LiTT-Code.ps1 instead
```

This is an older version of the LiTT shell. It's not called by anything. It's a backup/leftover from before `LiTT-Code.ps1` became the active script.

---

## 2. The Real Runtime Architecture (Proven)

```
User types: litt
     ↓
PowerShell profile function
     ↓
C:\Users\litbi\LiTT\LiTT-Code.ps1  (renderer + command loop)
     ↓
    ├── /status, /diff, /git, /check, /build, /test
    │   → runs git/pnpm directly in PowerShell
    │
    └── /ask, /do, free text
        → Invoke-LiTTBrainStream
        → spawns child process:
            node dist/litt-code-stream.js
            (or: pnpm exec ts-node --transpile-only litt-code-stream.ts)
        → passes prompt via LITT_LOCAL_PROMPT_B64 env var
        → reads NDJSON events from stdout
        → renders streaming deltas to console
```

### The Brain Bridge

```
terminal-server/litt-code-stream.ts  (36 lines — thin entry point)
    ↓ imports from
terminal-server/litt-code.ts  (435 lines — the actual brain)
    ↓ calls
    ├── Ollama (localhost:11434) — tried first, 1.5s timeout
    └── OpenRouter (openrouter.ai) — fallback, streaming SSE
```

### What the Brain Actually Does

`litt-code.ts` is a **pure LLM chat streamer**. It:
1. Resolves a model profile (fast/smart/long/auto)
2. Detects if web search is needed
3. Builds a system prompt + user message
4. Streams from Ollama → OpenRouter (fallback chain)
5. Emits NDJSON events: `meta`, `delta`, `done`, `error`

**It does NOT:**
- Execute commands
- Read/write files
- Run git operations
- Use tools
- Have memory
- Have project context beyond what PowerShell injects into the prompt text

The PowerShell script handles `/check`, `/build`, `/test`, `/diff`, `/git` by running `pnpm` and `git` directly. The brain is only used for chat/ask/do.

---

## 3. The Separate Node CLI (Exists But Not Built)

```
cli/  directory in canonical repo
├── package.json          → @litt/code-cli v0.1.0
├── src/litt-code-cli.tsx → Ink (React for terminals) interactive UI
├── src/myaios-cli.ts     → MyAios business CLI (bookings, services, leads)
├── src/ui/App.tsx        → Ink UI component
└── dist/                 → DOES NOT EXIST (never built)
```

This is a **separate, unbuilt Node/TypeScript CLI** that uses:
- `commander` for command parsing
- `ink` (React for terminals) for UI
- `@litt/agent-core` (workspace package) for LLM calls

`@litt/agent-core` (`packages/litt-agent-core/src/index.ts`, 118 lines) is a **simpler duplicate** of `terminal-server/litt-code.ts`:
- Same Ollama → OpenRouter fallback
- Same `askLiTTCode()` function name
- But NO streaming, NO web search, NO model profiles, NO timing
- Just a basic chat completion

**This CLI was never built and never installed.** The pnpm global shim that pointed to it is dead.

---

## 4. The Third PowerShell Thing: `cli/LiTTree.psm1`

```
cli/LiTTree.psm1  (PowerShell module)
├── Director agent (planning)
├── Builder agent (coding)
└── Calls /api/agents/chat on litlabs.net
```

This is a **completely separate agent system** that calls a remote API. It has nothing to do with the local LiTT Code runtime. It's a marketplace/installable module, not the local CLI.

---

## 5. Gate Checklist — Where We Stand

| Gate | Status | Evidence |
|------|--------|----------|
| `litt` runtime path proven | ✅ | Profile → `LiTT-Code.ps1` → `litt-code-stream.ts` → `litt-code.ts` |
| One canonical LiTT runtime/state system | ❌ | **THREE runtimes exist**: `LiTT-Code.ps1` (PowerShell), `litt-code.ts` (Node), `@litt/agent-core` (Node, unbuilt). Plus `LiTTree.psm1` (PowerShell, remote API) |
| `/status /diff /test /build /debug` execute for real | 🟡 | `/status /diff /test /build` run real git/pnpm. `/debug` does not exist. None of them feed results back to the brain. |
| Runtime logic separated from PowerShell rendering | ❌ | **Brain is in Node, but command execution is in PowerShell.** `/check` runs pnpm in PowerShell. The brain can't run commands. |
| No hardcoded `C:\...` paths in core | ❌ | `LiTT-Code.ps1` line 14: `$BrainRepo = "C:\Users\litbi\CascadeProjects\litlabs-website"`. `litt.ps1` line 16: `$Script:DefaultProject = "C:\Users\litbi\CascadeProjects\litlabs-website"` |
| Shell abstraction supports PowerShell and bash | ❌ | No shell abstraction exists. All command execution is raw PowerShell. |
| Node/TypeScript core runs without `litbit-web` | 🟡 | `litt-code.ts` runs standalone (no Next.js import). But `@litt/agent-core` is a separate, simpler duplicate that also runs standalone. Neither has tools, memory, or project context. |
| Auth/model config can load securely cross-platform | 🟡 | Model config is env vars (`OPENROUTER_API_KEY`, `LITT_MODEL_*`). No auth system in the local runtime. |
| Windows fresh-terminal acceptance test passes | ❌ | Not yet run. Dead pnpm shim may interfere. |

**Score: 1.5 / 9 gates passed. Not ready for Termux.**

---

## 6. The Core Problems

### Problem 1: Three brains, no shared core

| Brain | Location | Language | Used? | Has tools? | Has memory? |
|-------|----------|----------|-------|------------|-------------|
| `LiTT-Code.ps1` | `C:\Users\litbi\LiTT\` | PowerShell | ✅ Active | ❌ (runs pnpm/git directly) | ❌ |
| `litt-code.ts` | `terminal-server/` | TypeScript | ✅ Active (child process) | ❌ | ❌ |
| `@litt/agent-core` | `packages/litt-agent-core/` | TypeScript | ❌ Never built | ❌ | ❌ |

Three separate implementations of "ask an LLM a question." None of them have tools, memory, or project context. The PowerShell one is the most capable (it can run commands) but it's Windows-only.

### Problem 2: Command execution is PowerShell-only

`/check`, `/build`, `/test`, `/diff`, `/git` are hardcoded PowerShell calls to `pnpm` and `git`. There is no shell abstraction. This cannot run on Termux/bash.

### Problem 3: The brain can't act

`litt-code.ts` is a pure chat streamer. It can answer questions but cannot:
- Read files
- Run commands
- Search code
- Edit files
- Create PRs
- Deploy

The PowerShell script runs commands, but the brain can't. They're disconnected.

### Problem 4: Dead pnpm shim

`C:\Users\litbi\AppData\Local\pnpm\litt.ps1` points to the deleted archive. It's shadowed by the profile function but it's confusing and should be removed.

### Problem 5: Hardcoded Windows paths

`LiTT-Code.ps1` hardcodes `C:\Users\litbi\CascadeProjects\litlabs-website`. `litt.ps1` does the same. These won't work on any other machine or OS.

---

## 7. What Needs to Happen Before Termux

### Step 1: Clean up the dead shim (immediate)

Remove the dead pnpm global shim:
```powershell
Remove-Item "C:\Users\litbi\AppData\Local\pnpm\litt.ps1"
Remove-Item "C:\Users\litbi\AppData\Local\pnpm\litt.CMD"
Remove-Item "C:\Users\litbi\AppData\Local\pnpm\litt-code.ps1"
Remove-Item "C:\Users\litbi\AppData\Local\pnpm\litt-code.CMD"
```

### Step 2: Pick the canonical Node core

**`terminal-server/litt-code.ts` wins.** It's the one that's actually used, has streaming, has model profiles, has web search detection, and has a health check. `@litt/agent-core` is a simpler duplicate that should be deleted or merged.

### Step 3: Extract the core from terminal-server

Move the brain logic into a standalone package that doesn't depend on `terminal-server/` or `litbit-web`:

```
packages/litt-core/
├── src/
│   ├── index.ts          # exports: streamLiTT, askLiTT, health
│   ├── llm.ts            # Ollama + OpenRouter streaming
│   ├── profiles.ts       # model profiles + auto-routing
│   ├── shell.ts          # shell abstraction (run command, cross-platform)
│   ├── tools.ts          # tool registry (read file, search, git, etc.)
│   └── memory.ts         # project context, conversation memory
├── package.json
└── tsconfig.json
```

### Step 4: Build a shell abstraction

```typescript
// packages/litt-core/src/shell.ts
export interface ShellAdapter {
  run(command: string, args: string[], cwd: string): Promise<ShellResult>;
  detectShell(): "powershell" | "bash" | "zsh";
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

PowerShell adapter wraps `Start-Process`. Bash adapter wraps `child_process.exec`. Same interface.

### Step 5: Move command execution into the brain

Instead of PowerShell running `pnpm build` directly, the brain should call `shell.run("pnpm", ["build"], projectRoot)` and get structured results back. This makes `/check`, `/build`, `/test` work on any OS.

### Step 6: Replace the PowerShell renderer with a thin adapter

The PowerShell script becomes a **renderer only** — it renders the UI and forwards commands to the Node core. The Node core handles all logic.

```
PowerShell adapter (Windows)  ──┐
                                ├──→  LiTT Core (Node/TS)  ──→  LLM + Tools + Shell
Bash adapter (Termux/Linux)  ──┘
```

### Step 7: Build the Node CLI from `cli/`

The existing `cli/` directory with Ink (React for terminals) becomes the cross-platform UI. Build it, install it, and it works on both Windows and Termux.

### Step 8: Windows acceptance test

Open a fresh PowerShell terminal (no profile) and verify:
- `litt` starts
- `/status` shows project, branch, model
- `/ask "what is 2+2"` streams a response
- `/check` runs typecheck + lint + tests
- `/build` runs the build
- `/diff` shows git diff
- `/exit` returns to shell

### Step 9: Termux adapter

Only after all 8 steps pass, build the bash/Termux adapter using the same core.

---

## 8. What NOT to Do

- **Do NOT build Termux against the current runtime.** It has three brains, no shell abstraction, hardcoded Windows paths, and a dead shim.
- **Do NOT try to make PowerShell run on Termux.** That's the wrong direction.
- **Do NOT keep `@litt/agent-core` as a separate package.** It's a duplicate of `litt-code.ts` with less functionality. Merge or delete.
- **Do NOT add more features to `LiTT-Code.ps1`.** It's the renderer, not the brain. New logic goes in the Node core.
- **Do NOT remove the PowerShell profile function yet.** It's the only thing that works right now. Replace it only after the Node CLI is built and tested.
