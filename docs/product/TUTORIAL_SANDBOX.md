# Tutorial Sandbox

## What it is

An isolated workspace where users can learn and break things safely. No damage to real projects. No deployment risk.

## Workspace types

```ts
type WorkspaceType = "PROJECT" | "TUTORIAL_SANDBOX" | "PLAYGROUND";
```

| Type | Purpose | Deploy | Git | Reset | Promote |
|---|---|---|---|---|---|
| PROJECT | Real user project | ✓ | ✓ | ✗ | n/a |
| TUTORIAL_SANDBOX | Mission workspace | ✗ | ✗ | ✓ | → PROJECT |
| PLAYGROUND | LiTT Lab — break stuff | ✗ | ✗ | ✓ | → PROJECT |

## Sandbox features

```
Mission Workspace

first-html-site/
├ index.html
├ style.css
└ script.js

[ Preview ]  [ Reset Mission ]  [ Save as Project ]
```

- **Isolated files** — sandbox files are separate from real projects
- **Terminal** — full terminal access within sandbox
- **Preview** — live preview of sandbox files
- **Checkpoints** — auto-checkpoint before each step
- **Reset** — restore to initial state
- **LiTT access** — full chat, voice, tools within sandbox
- **No deployment** — sandboxes cannot be deployed

## Sandbox lifecycle

```
1. Mission starts → sandbox created from mission template
2. User works through steps → LiTT assists based on assistance level
3. Each step auto-checkpoints
4. User can reset at any time
5. Mission completes → option to "Save as Project"
6. If saved → sandbox promoted to PROJECT, files move to user's project space
7. If not saved → sandbox remains accessible but can be deleted
```

## Sandbox creation

When a mission starts:

```ts
POST /api/litt/sandbox/create
  Body: { missionId, userId }
  Returns: { sandboxId, projectId, files }
```

The sandbox is created from the mission's template files. It gets its own:

- Project ID (marked as `workspace_type: 'tutorial_sandbox'`)
- Conversation (linked to the mission)
- File storage
- Preview

## Reset

```
POST /api/litt/sandbox/:id/reset
  Returns: { restored: true }
```

Restores files to the mission's initial template. Clears terminal. Refreshes preview. Keeps conversation history (so the user can see what they tried).

## Save as Project (promotion)

```
POST /api/litt/sandbox/:id/promote
  Body: { projectName }
  Returns: { projectId }
```

- Changes `workspace_type` from `TUTORIAL_SANDBOX` to `PROJECT`
- Enables deployment, Git, and full Studio features
- Conversation continues
- Mission progress is marked as "saved"

## LiTT Lab (Playground)

A separate sandbox type for free experimentation:

```
🧪 LiTT Lab

Try:
HTML | CSS | JavaScript | React | APIs | AI | Images

[ Reset ]  [ Save as Project ]
```

No mission required. No structure. Just a safe place to experiment with LiTT.

## Database

Sandboxes use the same project table with `workspace_type` column:

```sql
ALTER TABLE studio_projects
  ADD COLUMN workspace_type TEXT NOT NULL DEFAULT 'project';
  -- 'project' | 'tutorial_sandbox' | 'playground'

ALTER TABLE studio_projects
  ADD COLUMN mission_id TEXT;
  -- links sandbox to mission if applicable
```

## What needs to be built

1. `workspace_type` column on projects table
2. Sandbox creation API
3. Reset API
4. Promote API
5. Mission template files (per-mission starter code)
6. LiTT Lab route (`/lab`)
7. Sandbox UI (preview + reset + save as project)
