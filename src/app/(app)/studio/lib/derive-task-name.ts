/**
 * derive-task-name — auto-naming for worktab tasks from the first
 * meaningful user prompt.
 *
 * A task created via "+" starts life as "Untitled N". The first user
 * prompt gives it a real name so rows of meaningless "Untitled 3/4/5"
 * tabs never become the normal state.
 *
 * Rules:
 *   - collapse all whitespace to single spaces
 *   - strip a leading slash-command token ("/build …" → "…")
 *   - strip trailing punctuation
 *   - truncate to ~48 chars at a word boundary with an ellipsis
 *   - return null when nothing meaningful remains (caller keeps the
 *     Untitled title)
 */

export const UNTITLED_TASK_PATTERN = /^untitled \d+$/i;

const MAX_NAME_LENGTH = 48;

export function deriveTaskName(prompt: string, maxLength: number = MAX_NAME_LENGTH): string | null {
  let text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Strip a leading slash-command token ("/build", "/clear", …).
  if (text.startsWith("/")) {
    const withoutCommand = text.replace(/^\/\S+\s*/, "");
    if (withoutCommand.trim()) text = withoutCommand;
  }

  text = text.trim().replace(/[.…,\/#!?;:\-–—]+$/, "").trim();
  if (!text) return null;

  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const atWord = cut.replace(/\s+\S*$/, "");
    text = `${(atWord || cut).trim()}…`;
  }
  return text || null;
}
