/**
 * Studio shell — meaningful task names.
 *
 * Phase 1 of the Figma-like shell kills the Untitled-tab explosion: tasks
 * are auto-named from the user's first message ("Homepage hero refresh"),
 * can be renamed inline, and NEVER receive "Untitled N". The server still
 * defaults to "New task" (task-service.ts), which this module treats as a
 * placeholder eligible for auto-naming.
 */

const MAX_TITLE_LENGTH = 48;

/**
 * Derive a human task title from the user's first message.
 * Collapses whitespace, truncates at a word boundary, strips trailing
 * punctuation, and capitalizes the first letter. Never returns an
 * "Untitled…" title — falls back to "New task" for empty input.
 */
export function deriveTaskTitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "New task";
  let title = clean;
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).replace(/\s+\S*$/, "");
  }
  title = title.replace(/[.,;:!?…\-–—]+$/, "").trim();
  if (!title) return "New task";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * True for titles that are placeholders rather than real names:
 * the server default "New task" and any legacy "Untitled…"/"Untitled N".
 * Only placeholder-titled tasks are eligible for first-message auto-naming.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (title == null) return true;
  const t = title.trim();
  return (
    t === "" ||
    t === "New task" ||
    t === "Untitled" ||
    /^Untitled \d+$/.test(t)
  );
}

/**
 * Map a persisted `lastOpenedSurface` value to a shell workspace id.
 * Unknown / missing values fall back to the Design workspace.
 */
export function surfaceToWorkspace(
  surface: string | null | undefined,
): "design" | "browser" | "images" | "code" | "files" | "assets" | "deploy" | "activity" {
  switch ((surface ?? "").toLowerCase()) {
    case "browser":
      return "browser";
    case "image":
    case "images":
    case "media":
      return "images";
    case "code":
      return "code";
    case "files":
      return "files";
    case "assets":
      return "assets";
    case "deploy":
      return "deploy";
    case "activity":
      return "activity";
    case "preview":
    case "design":
    case "studio":
    default:
      return "design";
  }
}
