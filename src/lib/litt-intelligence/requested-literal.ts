/**
 * ACC-01 F9 — requested-literal verification for edit runs.
 *
 * The failure (staging, 2026-11-23): the user asked "Change the tagline
 * under the bakery name to Fresh from the oven every morning"; the file
 * landed as "Fresh from1 the oven every morning." and the run reported
 * success, quoting the corrupted text back. The F1 read-back evidence
 * proves a file CHANGED; nothing checked the changed content against
 * what the user actually asked for.
 *
 * This module is the missing check, deliberately conservative:
 *
 *   - It only applies to edit-style instructions that specify a
 *     LITERAL target text (a quoted span, or the trailing span after
 *     " to " in a change/set/update/rename instruction). Paraphrased
 *     asks ("mention fresh pastries in the welcome paragraph") extract
 *     no literal and are never gated by it.
 *   - It only passes/fails on files the run actually mutated, read back
 *     from the workspace — never on the model's narration.
 *   - If nothing readable can be checked, the check does not apply:
 *     absence of evidence must not fail a run (that is the "unknown"
 *     rule the rest of the evidence system follows).
 */

/** Edit verbs that introduce a literal replacement target. */
const EDIT_VERB =
  /\b(change|set|update|rename|replace|edit|revise|correct|fix)\b/i;

/** File extensions whose content is text a literal can be checked in. */
const TEXT_FILE_EXTENSIONS = new Set([
  "html",
  "htm",
  "txt",
  "md",
  "markdown",
  "json",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "xml",
  "svg",
  "csv",
]);

export function isTextFilePath(path: string): boolean {
  const match = /\.([A-Za-z0-9]+)$/.exec(path.trim());
  return match ? TEXT_FILE_EXTENSIONS.has(match[1].toLowerCase()) : false;
}

/** Collapse every whitespace run to one space — the only normalization
 *  the containment check applies, so a re-wrapped line still matches
 *  while a corrupted word ("from1") never does. */
export function normalizeLiteralText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function contentContainsLiteral(content: string, literal: string): boolean {
  const needle = normalizeLiteralText(literal);
  if (needle.length === 0) return false;
  return normalizeLiteralText(content).includes(needle);
}

function cleanLiteral(raw: string): string | null {
  let literal = raw.trim();
  // A single trailing sentence period is punctuation of the REQUEST,
  // not necessarily of the target text; containment still matches when
  // the file keeps the period, because the file's text then contains
  // the literal as a prefix of the punctuated span.
  if (literal.endsWith(".")) literal = literal.slice(0, -1).trim();
  if (literal.length < 3) return null;
  if (literal.includes("?")) return null;
  return literal;
}

/**
 * Extract the literal target text an edit instruction specifies, or
 * null when it specifies none.
 *
 *   (a) A quoted span of ≥3 chars — when the instruction names the
 *       target after " to " ("change 'old' to 'new'"), that span wins;
 *       a lone quoted span is the target; with several, the last one
 *       is (replacement targets come last in natural phrasing).
 *       Quoted spans only count in edit-style instructions — a build
 *       brief quoting a name ("a bakery called 'Sunny Crust'") is not
 *       an edit and extracts nothing here.
 *   (b) Otherwise, for change/set/update/rename-style instructions,
 *       the trailing span after the LAST " to " (trailing sentence
 *       period trimmed).
 */
export function extractExpectedLiteral(instruction: string): string | null {
  if (typeof instruction !== "string") return null;
  const text = instruction.trim();
  if (!text || !EDIT_VERB.test(text)) return null;

  const quoted: Array<{ value: string; index: number }> = [];
  const quoteRe = /"([^"]{3,})"|'([^']{3,})'/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(text)) !== null) {
    quoted.push({ value: match[1] ?? match[2], index: match.index });
  }
  if (quoted.length > 0) {
    // Prefer a quoted span that follows a " to " (the replacement
    // target); otherwise the last quoted span.
    const toIndex = text.toLowerCase().lastIndexOf(" to ");
    const afterTo = toIndex >= 0 ? quoted.filter((q) => q.index > toIndex) : [];
    const chosen = (afterTo.length > 0 ? afterTo : quoted)[(afterTo.length > 0 ? afterTo : quoted).length - 1];
    return cleanLiteral(chosen.value);
  }

  const toIndex = text.toLowerCase().lastIndexOf(" to ");
  if (toIndex < 0) return null;
  const tail = text.slice(toIndex + 4);
  if (tail.length > 240) return null;
  const literal = cleanLiteral(tail);
  if (!literal) return null;
  // A tail that opens with an instruction verb is a paraphrase, not
  // content: "update the footer to include the verification marker"
  // asks for content in the model's own words — gating on it would
  // fail honest edits. The F9 shape ("…to Fresh from the oven every
  // morning") opens with the content itself.
  const firstWord = literal.split(/\s+/, 1)[0].toLowerCase();
  if (INSTRUCTION_VERBS.has(firstWord)) return null;
  return literal;
}

/** Verbs that open an instruction phrase rather than literal content. */
const INSTRUCTION_VERBS = new Set([
  "include", "add", "mention", "say", "show", "display", "put",
  "make", "use", "have", "feature", "describe", "list", "write",
  "create", "remove", "delete", "keep", "ensure", "contain",
  "highlight", "emphasize", "link", "point", "refer",
]);

export interface RequestedLiteralCheck {
  /** True when a literal was specified AND at least one mutated text
   *  file could be read back and checked. */
  applies: boolean;
  /** The extracted literal, when one was specified. */
  literal: string | null;
  /** True when any checked file contains the literal. */
  found: boolean;
  /** Files actually read and checked. */
  checkedFiles: string[];
}

/**
 * Read back the run's mutated text files and look for the requested
 * literal. `candidatePaths` should be the paths the run's successful
 * mutations declared (the same paths the completion evidence uses).
 * Unreadable files are skipped; if none can be read, the check does
 * not apply.
 */
export async function checkRequestedLiteral(opts: {
  instruction: string | null | undefined;
  candidatePaths: ReadonlyArray<string>;
  readFile: (path: string) => Promise<{ content: string }>;
}): Promise<RequestedLiteralCheck> {
  const literal = opts.instruction ? extractExpectedLiteral(opts.instruction) : null;
  if (!literal) return { applies: false, literal: null, found: false, checkedFiles: [] };

  const candidates = [
    ...new Set(
      opts.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0 && isTextFilePath(p)),
    ),
  ].slice(0, 8);
  if (candidates.length === 0) {
    return { applies: false, literal, found: false, checkedFiles: [] };
  }

  const checkedFiles: string[] = [];
  let found = false;
  for (const path of candidates) {
    try {
      const { content } = await opts.readFile(path);
      if (typeof content !== "string") continue;
      checkedFiles.push(path);
      if (contentContainsLiteral(content, literal)) {
        found = true;
        break;
      }
    } catch {
      // Not readable — not checked. Other candidates may still answer.
    }
  }

  return {
    applies: checkedFiles.length > 0,
    literal,
    found,
    checkedFiles,
  };
}

/** The honest user-facing sentence for a literal that never landed. */
export function requestedLiteralFailureMessage(literal: string): string {
  return (
    `I changed the file, but the exact text you asked for — "${literal}" — ` +
    `is not in it, so I can't confirm the edit landed as requested. ` +
    `Please try again.`
  );
}

/** The mid-loop feedback fed back for the ONE automatic repair attempt. */
export function requestedLiteralRepairPrompt(literal: string, checkedFiles: string[]): string {
  const where = checkedFiles.length > 0 ? ` in ${checkedFiles.join(", ")}` : "";
  return (
    `Verification failed: the exact text the user asked for — "${literal}" — ` +
    `was not found${where} after your edit. The edit did not land as requested ` +
    `(this class of failure includes near-miss corruptions like a stray character ` +
    `or a dropped space). Fix the file now so it contains that exact text, then finish.`
  );
}
