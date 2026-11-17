/**
 * Parse a `path[:line[:column]]` file reference out of free-form tool
 * output (check errors, compiler output, stack traces).
 *
 * Ported from the Kimi build's opsShared `parseFileRef` (Kimi wiring
 * plan item 4) and adapted to this codebase's path rules:
 *  - the path must carry a known source extension;
 *  - a path with no directory separator only counts when it also
 *    carries a line number — bare dotted words in prose ("Node.js 20",
 *    "example.com") are not file references;
 *  - route-group parentheses `(app)` are valid path characters here.
 * Returns null when the text carries no plausible reference, so
 * callers render nothing rather than a guessed link.
 */

export interface FileRef {
  path: string;
  line?: number;
  column?: number;
}

const SOURCE_EXTENSION = /\.(tsx?|jsx?|mjs|cjs|css|scss|json|md|html?|py|sh|ya?ml|toml)$/i;
// path with an optional :line[:column] or (line[,column]) suffix —
// anchored to token boundaries so prose like "error: something" never
// matches.
const FILE_REF_PATTERN =
  /(?:^|[\s("'\[])((?:\.{0,2}\/)?[\w@][\w@./()-]*\.[A-Za-z]{1,8})(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?(?=$|[\s"'\],;]|:\s)/gm;

export function parseFileRef(text: string | null | undefined): FileRef | null {
  if (!text) return null;
  FILE_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_REF_PATTERN.exec(text)) !== null) {
    const path = match[1];
    if (!path) continue;
    if (!SOURCE_EXTENSION.test(path)) continue;
    if (path.includes("://")) continue;
    const lineRaw = match[2] ?? match[4];
    const columnRaw = match[3] ?? match[5];
    const line = lineRaw ? Number.parseInt(lineRaw, 10) : undefined;
    const column = columnRaw ? Number.parseInt(columnRaw, 10) : undefined;
    const hasLine = line !== undefined && Number.isFinite(line) && line > 0;
    if (!path.includes("/") && !hasLine) continue;
    return {
      path,
      ...(hasLine ? { line } : {}),
      ...(column !== undefined && Number.isFinite(column) && column > 0 ? { column } : {}),
    };
  }
  return null;
}
