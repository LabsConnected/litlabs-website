/**
 * Text layout helpers — wrapping, truncation, and model label shortening.
 *
 * Pure functions so the shell's typography rules are unit-testable in the
 * CLI's `node` test env without a React renderer.
 */

/** Reading measure — the comfortable content width for conversation. */
export const CONTENT_MEASURE = 88;

/**
 * Word-wrap text to a width, preserving existing newlines. Long words
 * (URLs, paths) are broken to avoid overflow. Returns wrapped lines.
 */
export function wrapText(text: string, width: number): string[] {
  const safe = Math.max(8, Math.floor(width));
  if (text.length === 0) return [];
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) {
      lines.push("");
      continue;
    }
    let rest = raw;
    while (rest.length > 0) {
      if (rest.length <= safe) {
        lines.push(rest);
        break;
      }
      // Find the last space within the width; if none, break the word.
      const slice = rest.slice(0, safe);
      const spaceIdx = slice.lastIndexOf(" ");
      if (spaceIdx > 0) {
        lines.push(slice.slice(0, spaceIdx));
        rest = rest.slice(spaceIdx + 1);
      } else {
        lines.push(slice);
        rest = rest.slice(safe);
      }
    }
  }
  return lines;
}

/** Truncate a string, preserving the tail (most meaningful part). */
export function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return "…" + text.slice(text.length - (max - 1));
}

/** Truncate a string, preserving the head. */
export function truncateHead(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return text.slice(0, max - 1) + "…";
}

/** Collapse newlines + whitespace to one line (for single-line echo). */
export function singleLine(text: string): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Shorten a model id to a friendly label:
 *   "anthropic/claude-sonnet-4.6" → "Claude Sonnet 4.6"
 *   "openai/gpt-5.6-luna"         → "GPT 5.6 Luna"
 * Display labels ("GPT-5.6 Luna") pass through untouched.
 */
export function shortModelName(model: string | null | undefined): string {
  if (!model) return "";
  // Already a display label (contains a space) → pass through.
  if (model.includes(" ")) return model;
  const withoutProvider = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const cleaned = withoutProvider
    .replace(/^claude-/i, "Claude ")
    .replace(/^gpt-/i, "GPT-")
    .replace(/^gemini-/i, "Gemini ")
    .replace(/^o1-/i, "o1 ")
    .replace(/^o3-/i, "o3 ")
    .replace(/-/g, " ");
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}
