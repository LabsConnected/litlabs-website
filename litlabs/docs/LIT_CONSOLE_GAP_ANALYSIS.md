# LiT Console Gap Analysis — July 2026

## What you have today (the good)

Your current stack is already a real project-aware AI workspace, not just a chat wrapper:

| Component | Status | Evidence |
|-----------|--------|----------|
| **Next.js 16 + React 19 + Tailwind 4** | ✅ Built | `package.json`, `AGENTS.md` |
| **Clerk auth + Supabase data** | ✅ Wired | `package.json`, `AgentOrchestrator.ts` |
| **Terminal server** | ✅ Real PTY | `terminal-server/server.ts` (node-pty + Socket.IO) |
| **File CRUD via terminal API** | ✅ Working | `/api/files/*`, `/files/read` etc. |
| **Agent system** | ✅ In-memory + DB | `src/lib/agents.ts`, `AgentOrchestrator.ts` |
| **Agent chat API** | ✅ Exists | `/api/chat`, `/api/chat/unified` |
| **Unified LLM failover** | ✅ Solid | `src/lib/llm.ts` (Gemini → OpenRouter) |
| **Chat UI with streaming** | ✅ Has it | `ChatPanel.tsx` |
| **CommandDock** | ✅ Good shell | `CommandDock.tsx` |
| **xterm terminal UI** | ✅ Present | `@xterm/xterm`, `@xterm/addon-fit` |
| **Monaco editor** | ✅ Present | `@monaco-editor/react` |

That is a **strong foundation**. Most builders never get this far.

## What litlabs.net is about

Public signals (homepage + search snippets):

- **Positioning**: "Autonomous Agent Orchestration Platform"
- **Pitch**: Director → Executors → Logs → Jobs → Self-evolving workflows
- **6 named agents**: Director, Champion, Code Champion, Social Dominator, Data Slayer, Writing Coach
- **Pricing**: Explorer ($0), Architect ($19/mo), Commander (custom)
- **Stack claims**: Next.js, React, TypeScript, Tailwind, Clerk, Supabase, Vercel
- **Vibe**: Dark terminal / cyberpunk, "Ready to Synchronize"

Public site status: the marketing story is ahead of the public docs (404 on docs link, auth-walled app pages during scan). That means the market window is open.

## What the best tools have that you still need

### 1. Persistent repo brain

Top tools keep durable project context:

- **Cursor**: `.cursorrules`, `AGENTS.md`, project rules, chat memory
- **Windsurf**: Memories, Rules, Skills, `AGENTS.md`
- **Claude Code**: `/memory`, `/project`, skills, `CLAUDE.md`
- **Codex**: reusable skills, repo-level instructions

Your `AGENTS.md` exists but is mostly a dev guide. Your agent memory is only last 20 in-memory strings. You need **project memories, workspace rules, and per-repo instruction files** that survive across sessions and agents.

### 2. Real agent orchestration, not persona switching

Your agent switcher is a UI control. The best tools treat agents as **execution units**:

- **Cursor**: Cloud agents, subagents, background tasks
- **Claude Code**: subagents, custom agents
- **Codex**: subagents, task decomposition
- **Windsurf**: Cascade workflows, multi-step automation

You have two orchestrators (`src/lib/agents.ts` and `src/lib/AgentOrchestrator.ts`) but they do not currently drive terminal commands, file edits, or code changes end-to-end.

### 3. Tight terminal execution loop

Best terminal agents can:

- Read files
- Edit files
- Run commands
- Inspect output
- Recover and retry

Your terminal is a real PTY (`node-pty`), but the `jarvis-ai.ts` layer is mostly Q&A. It does not yet **close the loop**: parse intent → plan → execute → observe → iterate.

### 4. Browser/app preview + debugging loop

For web products, this is table stakes:

- **Windsurf / Devin**: preview pane, browser logs, route inspection
- **Cursor**: preview support, web context

Your console does not yet show a live app preview or capture browser errors back into the chat loop.

### 5. Hooks and workflow automation

Examples users expect:

- Auto-run lint after edits
- Auto-format before commit
- Block dangerous commands
- Auto-run tests after file changes
- Pre-commit checks

Your `security.ts` has blocked commands, but you do not have user-defined hooks or workflow builder yet.

### 6. MCP / tool ecosystem

Modern agents win by plugging into external systems:

- GitHub (PRs, issues, repo context)
- Supabase (DB introspection)
- Vercel (deploy, preview)
- Docs / knowledge bases
- Issue trackers
- Browser / search

Your tools are mostly internal. You need an MCP layer or pluggable tool registry.

### 7. Safety + approvals + trust

Best tools expose:

- Approval modes (always ask, smart, auto)
- Sandbox scopes
- Network policy
- Command allow/deny lists
- Audit logs

Your terminal has `isBlockedCommand` but no per-user approval policy or sandbox boundaries.

### 8. Native code review / PR workflow

The best products connect to the team workflow:

- PR review agents
- GitHub-aware diffs
- Async review runs
- Deploy loop

Your deploy endpoint is a stub. You need a real GitHub/Vercel loop.

## The blunt summary

| Area | Your current state | Best-in-class bar |
|------|-------------------|-------------------|
| UI shell | Good | Good |
| Terminal | Real PTY, basic | Stateful, recoverable, AI-driven |
| Agent orchestration | In-memory + DB schema | Task graph, parallel subagents, background jobs |
| Project memory | 20-string agent memory | Persistent rules, memories, skills, AGENTS.md |
| Code editing | Monaco present | Diff-first, approval-based, tested |
| Preview/debug | None | Live preview + browser logs |
| Integrations | Limited | MCP / GitHub / Supabase / Vercel |
| Safety | Blocked commands | Approval policies + sandbox |
| Team workflow | None | PR review + deploy loop |

## The winning loop you need to own

The best tools reduce this to seconds:

```
Understand repo → Make safe changes → Run/test → Show proof → Iterate
```

Your console should make that loop visible, fast, and trustworthy.

## Biggest product mistake to avoid

Do not build more agent personalities, more cards, or more branding.

Build the **execution loop** first. That is what makes a tool feel best.
