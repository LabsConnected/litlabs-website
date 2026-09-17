/**
 * Pre-approval validation for apply_patch tool inputs.
 *
 * The approval gate freezes tool inputs before the tool runs — so a patch
 * whose search string can never match (hallucinated file content,
 * unresolved template placeholders like `[PERSON_NAME]` or `{{brand}}`)
 * used to become an Approve/Reject card the user had to decline manually.
 * Validating before the pause turns a guaranteed failure into a
 * regeneration step: the loop feeds the error back to the model, which
 * re-reads the file and produces a patch that can actually apply.
 *
 * Kept deliberately narrow:
 *  - Placeholder detection only flags unambiguous templating tokens
 *    (moustaches and multi-word SCREAMING_SNAKE brackets) — never
 *    single-word brackets like [TODO], array syntax, or attribute names.
 *  - The search-vs-file check only flags strings that literally cannot
 *    match the current file — the same check applyPatch performs when it
 *    runs. A patch that can't apply is never a valid approval request.
 */

import type { WorkspaceTransport } from "./workspace-transport";
import { workspacePathError } from "./workspace-path";

/** `{{anything}}` — moustache/handlebars-style unresolved slots. */
const MOUSTACHE_TOKEN = /\{\{\s*[^}{]+\s*\}\}/;

/**
 * `[MULTI_WORD_SNAKE]` — bracketed all-caps tokens with at least one
 * underscore: [PERSON_NAME], [BRAND_NAME], [INSERT_HEADLINE_HERE].
 * Deliberately requires the underscore so [TODO], [OK], [WIP], [EOF] and
 * TypeScript tuple/index syntax stay legitimate.
 */
const SNAKE_BRACKET_TOKEN = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/;

/**
 * Single-word canonical redaction slots: [EMAIL], [PHONE], [ADDRESS].
 * These carry no underscore, so SNAKE_BRACKET_TOKEN cannot see them —
 * they are enumerated explicitly rather than widening the generic rule,
 * which keeps arbitrary single-word brackets ([TODO], [OK], [WIP],
 * array-style [A-Z] headers) legitimate.
 */
const SINGLE_WORD_REDACTION_TOKEN = /\[(?:EMAIL|PHONE|ADDRESS)\]/;

export function findPlaceholderToken(text: string): string | null {
  const moustache = text.match(MOUSTACHE_TOKEN);
  if (moustache) return moustache[0];
  const bracket = text.match(SNAKE_BRACKET_TOKEN);
  if (bracket) return bracket[0];
  const single = text.match(SINGLE_WORD_REDACTION_TOKEN);
  if (single) return single[0];
  return null;
}

/**
 * Enforcement-floor guard for mutation handlers. Returns an error string
 * when `value` carries an unresolved placeholder, else null. Handler-level
 * checks matter because the agent-loop gate is not the only path into a
 * mutation — /api/litt/tools/execute and resumed approvals reach the same
 * handlers without re-running the loop's pre-approval validation.
 */
export function placeholderViolation(value: unknown, field: string): string | null {
  if (typeof value !== "string") return null;
  const token = findPlaceholderToken(value);
  if (!token) return null;
  return `rejected: ${field} contains an unresolved placeholder ${JSON.stringify(token)}. ` +
    `Template slots never belong in mutations — use the literal text.`;
}

export interface ApplyPatchInputs {
  path?: unknown;
  patches?: unknown;
}

export interface FilesWriteInputs {
  path?: unknown;
  content?: unknown;
}

/**
 * Re-read the file after a rejected patch and give the model the exact
 * current content. This is an internal tool-result instruction, not chat
 * output. It prevents a blind second patch against stale or hallucinated
 * context and offers files.write as the safe full-file fallback.
 */
export async function buildPatchRecoveryMessage(
  inputs: ApplyPatchInputs,
  transport: WorkspaceTransport,
  validationError: string,
  attempt: number,
): Promise<string> {
  const path = typeof inputs.path === "string" ? inputs.path : "the requested file";
  try {
    const { content } = await transport.readFile(path);
    const bounded = content.length > 16_000
      ? `${content.slice(0, 16_000)}\n[content truncated; use files.read before retrying]`
      : content;
    return (
      `${validationError}\n\n` +
      `SAFE PATCH RECOVERY ATTEMPT ${attempt}: The file was re-read from disk. ` +
      `Do not repeat the rejected patch. Either use files.write with the complete ` +
      `literal contents, or use apply_patch with search text copied exactly from ` +
      `CURRENT FILE CONTENT below.\n\n` +
      `CURRENT FILE CONTENT (${path}):\n${bounded}`
    );
  } catch (readError) {
    return (
      `${validationError}\n\n` +
      `SAFE PATCH RECOVERY ATTEMPT ${attempt}: A fresh read of ${path} failed ` +
      `(${readError instanceof Error ? readError.message : String(readError)}). ` +
      `Do not guess or repeat the patch; no mutation was executed.`
    );
  }
}

/**
 * Validate apply_patch inputs before they reach the approval gate.
 *
 * Returns a model-facing error message when the patch is provably
 * invalid — the caller feeds it back as a tool result so the model
 * regenerates instead of pausing. Returns null when the patch can apply.
 */
export async function validateApplyPatchInputs(
  inputs: ApplyPatchInputs,
  transport: WorkspaceTransport,
): Promise<string | null> {
  const path = typeof inputs.path === "string" ? inputs.path : null;
  const patches = Array.isArray(inputs.patches)
    ? (inputs.patches as Array<{ search?: unknown; replace?: unknown }>)
    : null;

  if (!path || !patches || patches.length === 0) {
    return "apply_patch requires a target path and a non-empty patches[] array — re-read the file and generate a concrete patch.";
  }

  const pathError = workspacePathError(path);
  if (pathError) return `apply_patch rejected: ${pathError}.`;

  // 1. Lexical placeholder scan — covers both search and replace so a
  //    patch can't smuggle template slots into the file either direction.
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    for (const field of ["search", "replace"] as const) {
      const value = patch?.[field];
      if (typeof value !== "string") continue;
      const token = findPlaceholderToken(value);
      if (token) {
        return (
          `apply_patch rejected: patch ${i + 1} ${field} contains an unresolved placeholder ${JSON.stringify(token)}. ` +
          `Placeholders can never match real file content. Re-read ${path} and generate the patch with the literal text.`
        );
      }
    }
  }

  // 2. Search-vs-file check — every search string must exist verbatim in
  //    the target file, which is exactly what the patch executor requires.
  let content: string;
  try {
    ({ content } = await transport.readFile(path));
  } catch {
    return `apply_patch rejected: could not read ${path} to validate the patch. Re-read the file with read_file, then generate a patch against its real content.`;
  }

  for (let i = 0; i < patches.length; i++) {
    const search = patches[i]?.search;
    if (typeof search !== "string" || search.length === 0) {
      return `apply_patch rejected: patch ${i + 1} is missing a non-empty search string. Re-read ${path} and generate a concrete patch.`;
    }
    if (!content.includes(search)) {
      return (
        `apply_patch rejected: the search text in patch ${i + 1} does not appear in ${path} ` +
        `(starts with ${JSON.stringify(search.slice(0, 80))}). The patch cannot apply as written — ` +
        `re-read ${path} to get the exact current content, then retry with the literal text.`
      );
    }
  }

  return null;
}

/**
 * Validate files.write inputs before they reach the approval gate.
 *
 * A full-file write has no search string to verify — the only provable
 * defect is an unresolved template placeholder embedded in the content
 * itself. Production evidence: a rewrite of index.html shipped
 * `<title>[PERSON_NAME] — Premium Coffee Roasters</title>` because the
 * model substituted a template slot for the literal brand name, and the
 * apply_patch-only guard never saw it. The approval gate freezes inputs,
 * so a placeholder write can only persist the token verbatim.
 */
export function validateFilesWriteInputs(inputs: FilesWriteInputs): string | null {
  const path = typeof inputs.path === "string" ? inputs.path : null;
  const content = typeof inputs.content === "string" ? inputs.content : null;

  if (!path || content === null) {
    return "files.write requires a target path and string content — re-read the file and generate the full content.";
  }

  const pathError = workspacePathError(path);
  if (pathError) return `files.write rejected: ${pathError}.`;

  const token = findPlaceholderToken(content);
  if (token) {
    return (
      `files.write rejected: content for ${path} contains an unresolved placeholder ${JSON.stringify(token)}. ` +
      `Template slots never belong in produced file content — write the literal text for ${path}.`
    );
  }

  return null;
}
