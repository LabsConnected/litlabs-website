# Truth Layer — Evidence Ledger & Verification Receipts

## The problem

AI builders make claims they can't back up:

> "Your website is fixed."
> "Your terminal is connected."
> "Production is working."

These are often unverified, inferred, or outright wrong. Users lose trust. LiTTree's differentiator is that **LiTT never claims something it can't prove.**

## The solution: Evidence Ledger

Every agent run collects evidence from canonical sources. Every claim has a verification status.

### Verification statuses

```
VERIFIED    — LiTT checked this directly and confirmed it
OBSERVED    — LiTT saw evidence but didn't run a full check
INFERRED    — LiTT deduced this from context but didn't verify
UNKNOWN     — LiTT doesn't have enough information
FAILED      — LiTT checked and it's broken
```

### Evidence sources

```
workspace   — local file system, build output
github      — repository state, CI status
terminal    — command execution results
preview     — rendered preview, viewport checks
database    — database queries, migrations
deployment  — production URL, deploy status
```

### Evidence record

```ts
interface Evidence {
  source: "workspace" | "github" | "terminal" | "preview" | "database" | "deployment";
  claim: string;
  status: "verified" | "observed" | "inferred" | "unknown" | "failed";
  detail?: string;
  timestamp: string;
  runId: string;
}
```

## Anti-hallucination at the architecture level

Don't solve hallucinations with a bigger system prompt. Solve them structurally.

### Every LiTT statement about the project comes from canonical state

```
Project DB → file tree, framework, dependencies
GitHub → repo state, branch, CI status
Workspace → build output, type errors, test results
Terminal → command output, exit codes
Preview → rendered DOM, viewport, console errors
Tests → pass/fail counts
Deployment → URL status, response code
```

### Bad

> "Your terminal is connected."

### Good

> "Workspace execution is available. The visible terminal panel has not established a PTY session."

### Bad

> "Production is working."

### Good

> "Build passed locally. Preview loaded. Production has not been checked."

## Build Receipts

Every meaningful agent run ends with a receipt:

```
LiTT BUILD RECEIPT
────────────────────────

Task
Fix mobile navigation

Changes
3 files
• src/app/page.tsx
• src/components/Nav.tsx
• src/app/globals.css

Verification
TypeScript       ✓ VERIFIED     0 errors
Tests            ✓ VERIFIED     141 passed
Build            ✓ VERIFIED     exit 0
Preview          ✓ VERIFIED     loaded in 1.2s
Mobile 390px     ✓ VERIFIED     no overflow
Production       ○ NOT CHECKED

Checkpoint
#183

[ View Changes ]  [ Rollback ]  [ Deploy ]
```

### Receipt structure

```ts
interface BuildReceipt {
  task: string;
  changes: Array<{
    filename: string;
    type: "created" | "modified" | "deleted";
  }>;
  checks: VerificationCheck[];
  checkpointId?: string;
  runId: string;
  timestamp: string;
}
```

This is a `VerificationPart` in the universal artifact system (see `UNIVERSAL_ARTIFACTS.md`).

## "Why did LiTT do that?"

Every AI change can include an explanation:

```
Changed:
Navbar.tsx

Why:
Mobile navigation overflowed below 768px.

What LiTT changed:
Switched the navigation into a collapsible menu.

[ Explain Code ]  [ View Diff ]
```

This teaches while maintaining trust.

## Checkpoints / Rollback

Every meaningful run creates a checkpoint:

```ts
interface Checkpoint {
  id: string;
  projectId: string;
  conversationId: string;
  runId: string;
  timestamp: string;
  description: string;       // "Before fixing mobile nav"
  files: Record<string, string>;  // snapshot of changed files
  gitCommit?: string;        // if repo connected
}
```

### Rollback flow

```
User: "Undo that."

LiTT:
  Restoring to checkpoint #182.
  
  [ View Changes ]  [ Redo ]
```

Checkpoints are stored in the database and optionally as git commits when a repo is connected.

## Implementation plan

### Phase 1: Evidence collection

After every `runLiTTTurn`, collect evidence:

1. Run `tsc --noEmit` → TypeScript check
2. Run `next build` or project build command → Build check
3. Run tests if configured → Test check
4. Refresh preview → Preview check
5. Check mobile viewport → Mobile check

Each check produces a `VerificationCheck` with status and detail.

### Phase 2: Receipt rendering

Attach `VerificationPart` to the assistant message. Render in transcript as a receipt card.

### Phase 3: Checkpoint system

Before each agent run that modifies files, snapshot changed files. Store in `studio_checkpoints` table. Add rollback command.

### Phase 4: "Why did LiTT do that?"

Store the agent's reasoning (already captured in `reasoning` field) and surface it as an explanation card alongside diffs.

## Database schema

```sql
CREATE TABLE studio_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  run_id TEXT,
  description TEXT,
  files JSONB NOT NULL,        -- { "src/app/page.tsx": "<content>", ... }
  git_commit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkpoints_project ON studio_checkpoints(project_id);
CREATE INDEX idx_checkpoints_conversation ON studio_checkpoints(conversation_id);
```

## Existing codebase mapping

| Concept | Current |
|---|---|
| Connection summary | `useConnectionSummary` — partial truth |
| Provider health | `useStudioModelStore.providerHealth` |
| Terminal status | `useTerminalStore.isUsable()` |
| Reasoning | `ConversationMessage.reasoning` |
| Tool activity | `ConversationMessage.toolActivity` |

### What needs to change

1. Add `studio_checkpoints` table + migration
2. Add evidence collection step to `runLiTTTurn` / messages route
3. Add `VerificationPart` rendering to `StudioTranscript`
4. Add checkpoint creation before file mutations
5. Add rollback API endpoint
6. Add "Why did LiTT do that?" explanation card
