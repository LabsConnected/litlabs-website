/**
 * P0 R7 — content/instruction separation (Execution Integrity
 * Contract §R7).
 *
 * The failure (Acceptance Run 1 restart, 2026-11-26): after a publish
 * failed, the user sent a repair message describing the failure. The
 * rebuild pasted that message's text VERBATIM into the generated
 * site's footer, and the run reported success — the customer's
 * internal repair instructions shipped as website content.
 *
 * The mechanism is the model copying instruction text into content,
 * unguarded: nothing compared the generated files against the run's
 * own instructions. This module is that comparison, at completion
 * time, following the requested-literal check's evidence rules
 * (requested-literal.ts):
 *
 *   - It reads back the HTML files the run actually mutated — never
 *     the model's narration.
 *   - A leak is a substantial verbatim chunk (≥40 normalized chars)
 *     of one of the run's instruction texts, or a known internal
 *     marker phrase the codebase itself emits into execution
 *     messages, found in a generated page.
 *   - Text the user QUOTED in their instruction is exempt from chunk
 *     matching: quoted text is content the user asked to see on the
 *     page (that is exactly what the F9 literal check enforces), not
 *     leakage. Internal markers are never exempt.
 *   - Absence of evidence is not a verdict: if the candidate set was
 *     truncated by the read budget and nothing was found, the check
 *     does not apply. A find always applies — positive evidence is
 *     conclusive at any budget.
 *   - Only HTML pages are judged: they are the generated website
 *     content. (A note file the user asked to contain their own
 *     words is documentation, not a leak.)
 */

import {
  contentContainsLiteral,
  normalizeLiteralText,
} from "./requested-literal";

/**
 * Phrases the execution system itself emits into model-facing
 * messages (approval cards, tool errors, repair prompts). They are
 * internal by construction — a generated website containing one has
 * copied execution content, whatever the user asked for. Each string
 * is copied from the code that emits it.
 */
export const INTERNAL_CONTENT_MARKERS: readonly string[] = [
  // user-deployment.ts — the deploy validator's missing-assets error.
  "missing file(s):",
  // agent-loop-v2.ts — the approval pause's closing text.
  "I need your approval to run",
  // agent-loop-v2.ts — the AUTO-mode tool refusal.
  "Approval required — this operation is not in the AUTO-approve safe set",
  // requested-literal.ts — the F9 mid-loop repair prompt.
  "Verification failed: the exact text the user asked for",
  // agent-loop-v2.ts — the gated-repeat breaker (§6.1) tail.
  "requested 3 times without a successful save; stopping instead of re-asking",
  // agent-loop-v2.ts — the duplicate-mutation replay summary.
  "skipped — already executed",
  // destructive-action.ts — the R6 gate refusal.
  "destructive action must name its exact target file",
];

/** A leak chunk must be at least this long (normalized) — shorter
 *  overlaps are ordinary shared phrasing, not copied instructions. */
export const MIN_LEAK_CHUNK_CHARS = 40;

/** Bounded read-back budget for one leakage check (mirrors F9). */
const MAX_CHECKED_FILES = 8;

export interface InstructionLeak {
  /** The mutated page the leaked text was found in. */
  path: string;
  /** The leaked chunk or marker, as matched (normalized excerpt). */
  excerpt: string;
}

export interface InstructionLeakageCheck {
  /** True when the evidence supports a verdict: at least one mutated
   *  page was read AND (a leak was found OR the candidate set was
   *  fully checked). A truncated set with no find is unknown. */
  applies: boolean;
  /** Every leak found in the checked pages. */
  leaked: InstructionLeak[];
  /** Pages actually read and checked. */
  checkedFiles: string[];
}

/**
 * Split an instruction into sentence-sized chunks worth matching.
 * Sentences and lines shorter than MIN_LEAK_CHUNK_CHARS are dropped —
 * they are too generic to prove copying.
 */
export function extractInstructionChunks(instruction: string): string[] {
  const chunks: string[] = [];
  for (const line of instruction.split(/\r?\n/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const normalized = normalizeLiteralText(sentence);
      if (normalized.length >= MIN_LEAK_CHUNK_CHARS) chunks.push(normalized);
    }
  }
  return [...new Set(chunks)];
}

/** Quoted spans of an instruction — text the user presented as
 *  content (the F9 literal position), exempt from chunk matching. */
function quotedSpans(instruction: string): string[] {
  const spans: string[] = [];
  const re = /"([^"]{3,})"|'([^']{3,})'|`([^`]{3,})`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(instruction)) !== null) {
    const span = normalizeLiteralText(m[1] ?? m[2] ?? m[3] ?? "");
    if (span.length > 0) spans.push(span);
  }
  return spans;
}

/** A chunk is exempt when it is (mostly) text the user quoted as
 *  desired page content. */
function isQuotedContent(chunk: string, spans: readonly string[]): boolean {
  for (const span of spans) {
    if (span.includes(chunk)) return true;
    if (span.length >= MIN_LEAK_CHUNK_CHARS && chunk.includes(span) && span.length >= chunk.length * 0.8) {
      return true;
    }
  }
  return false;
}

function isHtmlPagePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/**
 * Read back the run's mutated HTML pages and look for the run's own
 * instruction text and internal markers in them.
 */
export async function checkInstructionLeakage(opts: {
  instructions: ReadonlyArray<string | null | undefined>;
  candidatePaths: ReadonlyArray<string>;
  readFile: (path: string) => Promise<{ content: string }>;
}): Promise<InstructionLeakageCheck> {
  const instructions = opts.instructions.filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );

  const chunks: string[] = [];
  for (const instruction of instructions) {
    const spans = quotedSpans(instruction);
    for (const chunk of extractInstructionChunks(instruction)) {
      if (!isQuotedContent(chunk, spans)) chunks.push(chunk);
    }
  }
  const needles = [...new Set([...chunks, ...INTERNAL_CONTENT_MARKERS])];
  if (needles.length === 0) {
    return { applies: false, leaked: [], checkedFiles: [] };
  }

  const allCandidates = [
    ...new Set(
      opts.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\//, "").replace(/^\.\//, ""))
        .filter((p) => p.length > 0 && isHtmlPagePath(p)),
    ),
  ];
  if (allCandidates.length === 0) {
    return { applies: false, leaked: [], checkedFiles: [] };
  }
  const truncated = allCandidates.length > MAX_CHECKED_FILES;
  const candidates = allCandidates.slice(0, MAX_CHECKED_FILES);

  const checkedFiles: string[] = [];
  const leaked: InstructionLeak[] = [];
  for (const path of candidates) {
    try {
      const { content } = await opts.readFile(path);
      if (typeof content !== "string") continue;
      checkedFiles.push(path);
      for (const needle of needles) {
        if (contentContainsLiteral(content, needle)) {
          leaked.push({ path, excerpt: needle });
          break; // one proven leak per page is enough for the verdict
        }
      }
    } catch {
      // Not readable — not checked. Other candidates may still answer.
    }
  }

  return {
    applies: checkedFiles.length > 0 && (leaked.length > 0 || !truncated),
    leaked,
    checkedFiles,
  };
}

/** The honest user-facing sentence for a run whose generated page
 *  contains the run's own internal text. */
export function instructionLeakageFailureMessage(leaked: InstructionLeak[]): string {
  const first = leaked[0];
  const where = first ? ` in ${first.path}` : "";
  const more = leaked.length > 1 ? ` (and ${leaked.length - 1} more page${leaked.length > 2 ? "s" : ""})` : "";
  return (
    `The generated page${where}${more} contains text from this run's own instructions ` +
    `instead of website content, so it is not finished and was not reported as a success. ` +
    `Internal instructions must never appear in a generated site — please try again.`
  );
}
