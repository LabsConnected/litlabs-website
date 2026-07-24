# Productivity Optimization for Devin Windsurf
# =========================================

## God Mode Coding Shortcuts (VS Code)
- Ctrl+. = Quick Fix (magic bullet for errors)
- F2 = Rename Symbol everywhere
- F12 = Go to Definition
- Alt+F12 = Peek Definition
- Ctrl+Shift+L = Select all occurrences
- Alt+Click = Multi-cursor (chaos mode)
- Shift+Alt+Down = Duplicate line

## Windsurf Terminal Commands
```bash
# Fast builds (targeted)
pnpm build --filter ./src

# Type check in background
npx tsc --noEmit &

# Hot reload only on changes
pnpm dev --port 3000
```

## Memory-Smart Development (16GB RAM)
1. Close Chrome tabs - biggest RAM consumer
2. Use Codespaces for /studio heavy builds
3. Run one task at a time: pnpm dev OR pnpm terminal:dev (not both)
4. Disable extensions: Python, Docker, GitLens when not needed

## Speed Writing Tips (Literally, type faster)
- Enable sticky keys if you're a fast typer
- Use `;` key binding for terminal commands
- Master multi-cursor for batch edits
- Use `/fix` or `/refactor` commands in Windsurf

## LiTT-Specific Speed Boosts
```powershell
# Quick agent command testing
# In terminal: pnpm terminal:dev (runs on its own port)

# Fast type checking
# Use: npx tsc --noEmit --incremental
```

## Devin Environment Optimization
- Code in Codespaces (remote Linux, better for Node.js)
- Local: Only small edits, testing /litt, emergency fixes
- Heavy builds: Always Codespaces

## Custom Snippet: Fast Component Creation
```tsx
// Save this as tsx.json snippet in VS Code
{
  "Quick Component": {
    "prefix": "litcomp",
    "body": [
      "interface ${1:ComponentName}Props {",
      "  $2",
      "}",
      "",
      "export function $1({}: $1Props) {",
      "  return (",
      "    <div className=\"$3\">",
      "      $0",
      "    </div>",
      "  )",
      "}"
    ]
  }
}