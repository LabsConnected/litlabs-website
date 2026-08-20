/**
 * Minimal terminal-safe markdown renderer (dogfood P1).
 *
 * The transcript must not show raw `**feat/litt-final-integration**`
 * syntax. This renders a SMALL, safe subset of markdown as styled
 * segments for Ink's <Text>:
 *
 *   **bold**         → bold
 *   `inline code`    → dim (monospace already)
 *   # ## headers     → bold
 *   ``` fences       → dim code block (stateful across lines)
 *   - / * / 1. lists → preserved as plain text
 *   > blockquote     → dim
 *
 * Everything else passes through untouched. Pure + per-line so it is
 * testable in the node env and streaming-safe (each line re-renders
 * from its own text). Fenced code state is threaded in/out explicitly.
 */

export interface MarkdownSegment {
  text: string;
  bold?: boolean;
  dim?: boolean;
}

export interface MarkdownLineResult {
  segments: MarkdownSegment[];
  /** Code-fence state AFTER this line (true when inside a fence). */
  inCode: boolean;
}

const HEADER_RE = /^#{1,6}[ \t]+(.*)$/;
const FENCE_RE = /^\s*```/;

/** Tokenize a plain line for **bold** and `inline code` spans. */
export function inlineSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    const token = m[1];
    if (token.startsWith("**")) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else {
      segments.push({ text: token.slice(1, -1), dim: true });
    }
    last = m.index + token.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length > 0 ? segments : [{ text }];
}

/**
 * Render one line of markdown. Pass the code-fence state in; the
 * returned state is what to pass for the NEXT line.
 */
export function markdownLine(line: string, inCode: boolean): MarkdownLineResult {
  // Code fences — toggle on ``` and hide the fence line itself.
  if (FENCE_RE.test(line)) {
    return { segments: [], inCode: !inCode };
  }
  if (inCode) {
    return { segments: [{ text: line, dim: true }], inCode: true };
  }

  const trimmed = line.trimStart();

  // Headers → bold.
  const header = trimmed.match(HEADER_RE);
  if (header) {
    return { segments: [{ text: header[1], bold: true }], inCode: false };
  }

  // Blockquotes → dim.
  if (trimmed.startsWith(">")) {
    return { segments: [{ text: line, dim: true }], inCode: false };
  }

  // Bold + inline code.
  return { segments: inlineSegments(line), inCode: false };
}
