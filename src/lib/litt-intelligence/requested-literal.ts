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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The literal as an HTML file would store it: text content is
 *  entity-escaped, so "Coffee & pastries" lands as
 *  "Coffee &amp; pastries". */
export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function contentContainsLiteral(content: string, literal: string): boolean {
  const needle = normalizeLiteralText(literal);
  if (needle.length === 0) return false;
  const haystack = normalizeLiteralText(content);
  if (haystack.includes(needle)) return true;
  // The requested text may be present in its HTML-escaped stored
  // form — equally correct, and a check that cannot see it can never
  // pass no matter how often the model retries (Greptile, PR #1106).
  const escapedNeedle = normalizeLiteralText(escapeHtmlText(literal));
  return escapedNeedle !== needle && haystack.includes(escapedNeedle);
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

/** Content-introducing verbs: in "make it read/say X", X is the new
 *  content even without a " to "/" with " separator. */
const CONTENT_INTRODUCING_VERB = /\b(set|read|reads|say|says|be|become|becomes)\b/;

/**
 * Style properties: when the thing being changed IS one of these, an
 * unquoted tail after " to " is a style VALUE ("dark blue", "red"),
 * not file text — valid code may express it as a hex color or a
 * keyword that never appears verbatim (Greptile, PR #1106).
 */
const STYLE_SUBJECT =
  /\b(background|bg|colou?r|font|font size|text size|size|width|height|margin|padding|border|opacity|theme|alignment|align|style|styling|shade|hue)\b/;

/**
 * Extract the literal target text an edit instruction specifies, or
 * null when it specifies none. Conservative by design (Greptile,
 * PR #1106): a literal is enforced ONLY when the request clearly
 * names replacement text, and a skipped check is always better than
 * a wrong one.
 *
 *   (a) A quoted span of ≥3 chars in REPLACEMENT position: after the
 *       last " to " or " with " separator ("change 'old' to 'new'",
 *       "replace 'old' with 'new'"). Separator words INSIDE a quoted
 *       span are part of that span's text, never separators — in
 *       'Change the heading to "Welcome to our bakery"' the real
 *       separator precedes the quote, and the " to " inside the
 *       replacement must not hide it (Greptile, PR #1106 round 2).
 *       A quoted span BEFORE the separator is the text being
 *       replaced and must NEVER become the expected literal; when
 *       every quoted span sits before the separator the replacement
 *       is unquoted and ambiguous → null.
 *       With no separator at all, a quoted span counts only when a
 *       content-introducing verb (set/read/say/be) presents it as the
 *       new content. Quoted spans only count in edit-style
 *       instructions — a build brief quoting a name ("a bakery
 *       called 'Sunny Crust'") is not an edit and extracts nothing.
 *   (b) Otherwise, for change/set/update/rename-style instructions,
 *       the trailing span after the LAST " to " (trailing sentence
 *       period trimmed) — unless the subject being changed is a style
 *       property, which makes the tail a style value, not content.
 */
export function extractExpectedLiteral(instruction: string): string | null {
  if (typeof instruction !== "string") return null;
  const text = instruction.trim();
  if (!text || !EDIT_VERB.test(text)) return null;

  const quoted: Array<{ value: string; index: number; end: number }> = [];
  const quoteRe = /"([^"]{3,})"|'([^']{3,})'/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(text)) !== null) {
    quoted.push({
      value: match[1] ?? match[2],
      index: match.index,
      end: match.index + match[0].length,
    });
  }

  const lower = text.toLowerCase();
  // The replacement separator: whatever is named AFTER the last
  // " to " / " with " is the replacement; quoted text named before
  // it is the source being replaced. Occurrences that fall inside a
  // quoted span are that span's own words, not separators — a
  // separator cannot straddle a quote character, so testing the
  // occurrence's start position is exact.
  const insideQuotedSpan = (index: number) =>
    quoted.some((q) => index >= q.index && index < q.end);
  const lastSeparatorOutsideQuotes = (needle: string): number => {
    let idx = lower.lastIndexOf(needle);
    while (idx >= 0 && insideQuotedSpan(idx)) {
      idx = lower.lastIndexOf(needle, idx - 1);
    }
    return idx;
  };
  const sepIndex = Math.max(
    lastSeparatorOutsideQuotes(" to "),
    lastSeparatorOutsideQuotes(" with "),
  );

  if (quoted.length > 0) {
    if (sepIndex >= 0) {
      const afterSep = quoted.filter((q) => q.index > sepIndex);
      if (afterSep.length === 0) return null;
      return cleanLiteral(afterSep[afterSep.length - 1].value);
    }
    const last = quoted[quoted.length - 1];
    if (!CONTENT_INTRODUCING_VERB.test(lower.slice(0, last.index))) return null;
    return cleanLiteral(last.value);
  }

  const toIndex = lower.lastIndexOf(" to ");
  if (toIndex < 0) return null;
  // Changing a style property to an unquoted value names a style
  // descriptor, not literal file text ("change the background to
  // dark blue" — the CSS may legitimately say #00008b).
  if (STYLE_SUBJECT.test(lower.slice(0, toIndex))) return null;
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

/** Bounded read-back budget for one literal check. */
const MAX_CHECKED_FILES = 8;

export interface RequestedLiteralCheck {
  /** True when a literal was specified AND at least one mutated text
   *  file could be read back and checked AND the evidence is complete:
   *  when the candidate cap truncated the set and the literal was not
   *  found, the outcome is unknown and this is false — absence of
   *  evidence never fails a run. */
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

  const allCandidates = [
    ...new Set(
      opts.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0 && isTextFilePath(p)),
    ),
  ];
  if (allCandidates.length === 0) {
    return { applies: false, literal, found: false, checkedFiles: [] };
  }
  // Files the instruction itself names are checked first — they are
  // where the requested text was directed, and the cap below must
  // not push them out of the evidence set.
  const instructionText = opts.instruction ?? "";
  const prioritized = [...allCandidates].sort((a, b) => {
    const aNamed = instructionText.includes(a) ? 0 : 1;
    const bNamed = instructionText.includes(b) ? 0 : 1;
    return aNamed - bNamed;
  });
  // The read-back budget is bounded, but a truncated candidate set is
  // INCOMPLETE evidence: if the literal is not found in the files
  // that were checked, the verdict is "unknown" (the check does not
  // apply), never a confirmed miss (Greptile, PR #1106).
  const truncated = prioritized.length > MAX_CHECKED_FILES;
  const candidates = prioritized.slice(0, MAX_CHECKED_FILES);

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
    applies: checkedFiles.length > 0 && (found || !truncated),
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
