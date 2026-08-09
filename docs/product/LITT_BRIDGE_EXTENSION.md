# LiTT Bridge — VS Code / Windsurf Extension

## What it is

A VS Code / Windsurf extension that brings the canonical LiTT brain into the editor. Not a second LiTT — a bridge to the real LiTT.

## Architecture

```
VS Code / Windsurf
      │
      │ LiTT Bridge
      ▼
LiTTree API
      │
      ▼
Canonical LiTT Core
      │
 ┌────┼────┐
 ▼    ▼    ▼
Memory  Project  Tools
```

When installed, the extension authenticates to LiTTree and binds:

```
LiTTree user
+ local workspace
+ LiTTree project
+ conversation
```

## Naming

**LiTT Bridge** — not "LiTT for VS Code." It's a bridge to the same LiTT.

## Sidebar

```
LiTT
────────────────
● Connected

Project
LiTTree Website

Conversation
Continue Studio Chat

Mode
ACT

[ Ask LiTT ]
```

## Commands

```
LiTT: Ask About Selection
LiTT: Fix Selection
LiTT: Explain File
LiTT: Add File to Context
LiTT: Run Project Check
LiTT: Open Project in Studio
LiTT: Continue Conversation
LiTT: Create Checkpoint
```

## Editor right-click

```
Ask LiTT
Explain
Fix
Refactor
Add Tests
```

## Selected code flows to the same brain

Highlight code → right-click → "Ask LiTT"

The extension sends:

```ts
{
  userId,
  projectId,
  conversationId,
  workspaceIdentity: {
    type: "vscode" | "windsurf",
    workspaceFolder: string,
  },
  file: {
    path: string,
    content: string,
  },
  selection: {
    startLine: number,
    endLine: number,
    content: string,
  },
  gitBranch: string,
}
```

The canonical LiTT brain responds. The response appears in the LiTT Bridge sidebar.

Then the user goes back to the browser:

> "What did we just change in Windsurf?"

And LiTT knows, because it's the same conversation.

## Authentication

Use the editor's encrypted secret storage. Do NOT store tokens in:

- `settings.json`
- `.env`
- workspace files

```
VS Code SecretStorage → LiTTree auth token
```

## Native vs Webview

Use native editor UI where possible. Reserve webviews for custom functionality.

### Native

- File selections
- Commands
- Diagnostics
- Status bar
- Tree views
- Context menus

### Webview only for

- LiTT conversation (rich chat UI)
- Artifact cards (images, diffs, receipts)
- Mission interface
- Image preview

## Publishing

Publish to both:

```
VS Code Marketplace
Open VSX (for Windsurf)
```

Architect around stable VS Code APIs. Test Windsurf compatibility — don't assume every VS Code behavior works identically.

## Missions in the editor

Missions can continue inside VS Code / Windsurf:

```
MISSION 04

Make the button react.

□ Find button
□ Add event listener
□ Change text on click

[ Ask LiTT ]  [ Hint ]  [ Check Work ]
```

The extension receives:

```ts
{
  missionId,
  workspaceId,
  progress,
  conversationId,
}
```

Opens the mission workspace. User completes steps. Progress syncs back to LiTTree.

## "Open With" everywhere

Project menu:

```
Open in

LiTTree Studio
Windsurf
VS Code
GitHub
```

LiTT context stays with the project regardless of which editor opens it.

## What needs to be built

1. VS Code extension scaffold (package.json, activation, commands)
2. Sidebar tree view (project, conversation, mode)
3. Webview for LiTT conversation
4. Authentication via SecretStorage
5. API client connecting to LiTTree API
6. Context menu integration (right-click → Ask/Explain/Fix)
7. Selection → API flow
8. Mission workspace support
9. Open VSX compatibility testing
10. Publishing to both marketplaces

## Tech notes

- Extension API: `vscode.window.createWebviewPanel`
- Secret storage: `context.secrets`
- Tree view: `vscode.window.createTreeView`
- Commands: `vscode.commands.registerCommand`
- Diagnostics: `vscode.languages.createDiagnosticCollection`

## Not in scope for P0

The extension is a **post-P0** item. The P0 focus is the web Studio experience. But the architecture should be designed so the extension is a natural extension of LITT CORE, not a separate system.
