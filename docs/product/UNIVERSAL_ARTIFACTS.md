# Universal Artifact System

## The problem

Messages are currently `content: string`. If LiTT generates an image, it's a URL in a markdown string. If LiTT edits code, it's a text description. There's no structured way to render rich results, attach actions, or track artifacts across the conversation.

## The solution: Message Parts

Messages support structured parts. A single message can contain multiple parts.

```ts
type MessagePart =
  | TextPart
  | ImagePart
  | AudioPart
  | VideoPart
  | FilePart
  | CodePart
  | DiffPart
  | PreviewPart
  | CanvasPart
  | ToolResultPart
  | VerificationPart
  | ActionChipsPart;
```

### Part definitions

```ts
interface TextPart {
  type: "text";
  text: string;
}

interface ImagePart {
  type: "image";
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  metadata?: {
    prompt: string;
    model: string;
    seed?: number;
    steps?: number;
    cfgScale?: number;
  };
  actions?: ArtifactAction[];
}

interface AudioPart {
  type: "audio";
  url: string;
  duration?: number;
  metadata?: {
    prompt: string;
    model: string;
  };
  actions?: ArtifactAction[];
}

interface VideoPart {
  type: "video";
  url: string;
  duration?: number;
  thumbnail?: string;
  metadata?: {
    prompt: string;
    model: string;
  };
  actions?: ArtifactAction[];
}

interface FilePart {
  type: "file";
  filename: string;
  url: string;
  mimeType: string;
  size?: number;
  actions?: ArtifactAction[];
}

interface CodePart {
  type: "code";
  language: string;
  code: string;
  filename?: string;
}

interface DiffPart {
  type: "diff";
  filename: string;
  before: string;
  after: string;
  language?: string;
  actions?: ArtifactAction[];
}

interface PreviewPart {
  type: "preview";
  url: string;
  label?: string;
  viewport?: "mobile" | "tablet" | "desktop";
}

interface CanvasPart {
  type: "canvas";
  nodeId: string;
  label: string;
  change: "created" | "modified" | "deleted";
}

interface ToolResultPart {
  type: "tool_result";
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "success" | "error" | "pending";
}

interface VerificationPart {
  type: "verification";
  task: string;
  checks: VerificationCheck[];
  checkpointId?: string;
  actions?: ArtifactAction[];
}

interface ActionChipsPart {
  type: "action_chips";
  actions: Array<{
    label: string;
    command: string;
    icon?: string;
  }>;
}

interface ArtifactAction {
  label: string;
  action: string;        // e.g. "edit", "variation", "upscale", "add_to_project", "open_in_studio", "use_on_canvas"
  payload?: Record<string, unknown>;
}
```

### Verification check

```ts
interface VerificationCheck {
  name: string;          // "TypeScript", "Tests", "Build", "Preview", "Mobile 390px"
  status: "verified" | "observed" | "inferred" | "unknown" | "failed";
  detail?: string;       // "141 passed", "0 errors", "loaded in 1.2s"
  source: "workspace" | "github" | "terminal" | "preview" | "database" | "deployment";
  timestamp: string;
}
```

## Database schema change

Current `studio_conversation_messages` has `content TEXT` and `tool_activity JSONB`.

Add:

```sql
ALTER TABLE studio_conversation_messages
  ADD COLUMN parts JSONB DEFAULT NULL;
```

`parts` stores the array of `MessagePart` objects. `content` remains for backward compatibility (plain text fallback / search / voice TTS).

When `parts` is present, the UI renders structured parts. When absent, falls back to `content` as a single `TextPart`.

## Rendering rules

### Chat transcript

Parts render top-to-bottom in order:

```
[TextPart]  I made three directions for your hero.
[ImagePart] Cyber Glass    [Edit] [Use]
[ImagePart] Dark Future    [Edit] [Use]
[ImagePart] Minimal Neon   [Edit] [Use]
[TextPart]  Which direction do you prefer?
```

### Voice

Only `TextPart` is spoken. Other parts are summarized:

```
"I made three image directions for your hero. Which do you prefer?"
```

### Canvas

`CanvasPart` highlights the changed node. `DiffPart` shows the code change. `PreviewPart` refreshes the preview.

## In-chat generation — the universal front door

Users should never have to leave Chat to create something.

```
User: "Make me a logo"

LiTT:
  [ImagePart] logo_v1.png
  [Actions: Edit] [Variation] [Upscale] [Add to Project] [Open in Image Studio]
```

```
User: "Make background music for this landing page"

LiTT:
  [AudioPart] ambient_bg.mp3
  [Actions: Edit] [Add to Project] [Open in Music Studio]
```

```
User: "Turn this into a PDF"

LiTT:
  [FilePart] proposal.pdf
  [Actions: Download] [Add to Project]
```

### Tool routing

The intent classifier detects:

| User says | Intent | Tool | Result part |
|---|---|---|---|
| "Make me a logo" | image_generation | image.generate | ImagePart |
| "Make background music" | music_generation | music.generate | AudioPart |
| "Make a hero video" | video_generation | video.generate | VideoPart |
| "Fix the mobile navbar" | code_edit | code.edit + preview.refresh | DiffPart + VerificationPart |
| "Make the logo bigger" | canvas_edit | canvas.update_node | CanvasPart + PreviewPart |
| "Explain this file" | code_explain | code.read + llm.explain | TextPart |
| "Turn this into a PDF" | document_generate | document.generate | FilePart |

### Deeper editing still exists

Image Studio, Music Studio, Video Studio still exist for deep controls. The in-chat artifact is the quick path. "Open in Image Studio" is the deep path.

## Existing codebase mapping

| Concept | Current |
|---|---|
| Message content | `ConversationMessage.content: string` |
| Tool activity | `ConversationMessage.toolActivity: JSONB` |
| Action chips | `ActionChips` component, `parseJarvisActions` |
| Image generation | `ImageStudio` component, fal.ai integration |
| Code diffs | Not structured — described in text |
| Verification | `useConnectionSummary` (partial) |

### What needs to change

1. Add `parts` column to `studio_conversation_messages`
2. Update `ConversationMessage` type to include `parts?: MessagePart[]`
3. Update `StudioTranscript` to render parts
4. Update `runLiTTTurn` (or the messages route) to structure tool results as parts
5. Add intent classifier for tool routing
6. Update voice pipeline to summarize non-text parts
