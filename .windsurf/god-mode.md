# ⚡ GOD MODE PRODUCTIVITY — Devin Windsurf Edition

## 🔥 Quick Wins (5 Minutes)

### VS Code Settings (Apply Now)
1. Open Settings (Ctrl+,)
2. Search "auto save" → Set to "onFocusChange"
3. Search "minimap" → Enable
4. Search "bracket pair" → Enable colorization
5. Search "sticky scroll" → Enable

### Keyboard Shortcuts (Master These)
| Key | Action |
|-----|--------|
| **Ctrl+.** | Quick Fix (fix EVERYTHING) |
| **F2** | Rename all occurrences |
| **F12** | Go to definition |
| **Alt+F12** | Peek at definition (stay in place!) |
| **Ctrl+Shift+L** | Select all same words |
| **Alt+Click** | Multi-cursor everywhere |
| **Shift+Alt+Down** | Duplicate line |
| **Ctrl+D** | Select next occurrence |

## 🚀 Snippets (Type Faster)

Use these prefixes in VS Code:
- `litcomp` → TypeScript component
- `litpage` → Next.js page
- `litapi` → API route
- `litzod` → Zod schema
- `lithook` → React hook
- `litdiv` → Tailwind div

## ⚡ Terminal Aliases

```powershell
lb = pnpm build
lt = pnpm test
ld = pnpm dev
lc = pnpm terminal:dev
tc = npx tsc --noEmit
```

## 🧠 Memory-Smart Development (16GB RAM)

### Do This:
- Close Chrome tabs (biggest RAM eater)
- Use **Codespaces** for `/studio` builds
- Run **one task at a time**

### Don't Do This:
- Don't run both `pnpm dev` AND `pnpm terminal:dev`
- Don't keep multiple ports running
- Don't open huge directories in VS Code

## 🏎️ Build Speed Optimizations

```bash
# Fast incremental build
pnpm build --filter ./src

# Type check only changed files
npx tsc --noEmit --incremental

# Clean and rebuild
pnpm rebuild
```

## 🤖 LiTT-Specific Speed Hacks

- Test `/litt` endpoint: Use Codespace terminal
- Run `pnpm terminal:dev` on its own port
- Use SSE streaming already wired in `/api/agents/chat`
- Leverage the Agent Orchestrator for parallel tasks

## 🎯 Daily Workflow

1. **Morning**: `clean` → `ld` (fresh build)
2. **Edit**: Use snippets + multi-cursor
3. **Test**: `lt` after major changes
4. **Type check**: `tc` before commit
5. **Heavy work**: Switch to Codespaces

---

*God Mode = Knowing the shortcuts. Master them.*