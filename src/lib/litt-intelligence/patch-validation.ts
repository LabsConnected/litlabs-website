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

/** `{{anything}}` — moustache/handlebars-style unresolved slots. */
const MOUSTACHE_TOKEN = /\{\{\s*[^}{]+\s*\}\}/;

/**
 * `[MULTI_WORD_SNAKE]` — bracketed all-caps tokens with at least one
 * underscore: [PERSON_NAME], [BRAND_NAME], [INSERT_HEADLINE_HERE].
 * Deliberately requires the underscore so [TODO], [OK], [WIP], [EOF] and
 * TypeScript tuple/index syntax stay legitimate.
 */
const SNAKE_BRACKET_TOKEN = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/;

function findPlaceholderToken(text: string): string | null {
  const moustache = text.match(MOUSTACHE_TOKEN);
  if (moustache) return moustache[0];
  const bracket = text.match(SNAKE_BRACKET_TOKEN);
  if (bracket) return bracket[0];
  return null;
}

export interface ApplyPatchInputs {
  path?: unknown;
  patches?: unknown;
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
