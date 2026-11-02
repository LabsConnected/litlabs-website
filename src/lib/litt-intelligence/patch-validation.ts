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
 * Matches <style> blocks that feed the Tailwind CSS v4 browser build
 * (<style type="text/tailwindcss">), tolerating attribute order, quoting
 * style, and case variations.
 */
const TAILWIND_STYLE_BLOCK_RE =
  /<style\b[^>]*\btype\s*=\s*(?:"text\/tailwindcss"|'text\/tailwindcss'|text\/tailwindcss(?=[\s>]))[^>]*>([\s\S]*?)<\/style\s*>/gi;

/**
 * The Tailwind v4 browser-build @import trap.
 *
 * The Tailwind CSS v4 browser build decides whether to auto-inject its core
 * import with a naive substring check over <style type="text/tailwindcss">
 * blocks: when the block contains ANY "@import" line, the default
 * `@import "tailwindcss"` is NOT prepended. A page whose block carries a
 * Google Fonts @import (or any other import) without also importing
 * tailwindcss gets a build that silently compiles ZERO utilities — all
 * content renders, completely unstyled, with no error anywhere.
 * Production evidence: the 2026-09-23 North Shore acceptance run.
 *
 * This mirrors the build's own check exactly: the build tests
 * `t.includes("@import")` (case-sensitive), so the lint flags a block whose
 * text contains "@import" but not "tailwindcss" (an explicit
 * `@import "tailwindcss";` in the block is the legitimate escape hatch).
 * Returns the offending @import line (truncated) for the remediation
 * message, or null when the content is clean.
 */
export function findTailwindImportTrap(content: string): string | null {
  if (typeof content !== "string") return null;
  TAILWIND_STYLE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAILWIND_STYLE_BLOCK_RE.exec(content)) !== null) {
    const block = m[1] ?? "";
    if (block.includes("@import") && !block.toLowerCase().includes("tailwindcss")) {
      const line =
        block
          .split("\n")
          .find((l) => l.includes("@import"))
          ?.trim() ?? "@import";
      return line.slice(0, 160);
    }
  }
  return null;
}

/**
 * Model-facing remediation for the Tailwind @import trap. Shared by the
 * files.write and apply_patch validators so the builder gets the exact
 * fix either way the trap is introduced.
 */
export function tailwindImportTrapMessage(trap: string, path: string): string {
  return (
    `rejected: ${path} contains a <style type="text/tailwindcss"> block with ${JSON.stringify(trap)} ` +
    `but no @import "tailwindcss". The Tailwind v4 browser build silently compiles ZERO utilities when it ` +
    `sees any @import without tailwindcss — the page would render completely unstyled with no error. ` +
    `Load fonts with <link> tags in <head> (never @import inside the Tailwind block), or add ` +
    `@import "tailwindcss"; as the first line of the block, then rewrite the content.`
  );
}

/**
 * The Tailwind v3-theme-in-v4 trap (companion to the @import trap).
 *
 * @theme in the v4 browser build takes CSS custom properties
 * (`--color-primary: #a8ff2f;`), NOT the v3 config object
 * (`colors: { primary: '#a8ff2f' }, extend: { fontFamily: … }`). A block
 * containing v3-style keys throws CssSyntaxError ("Invalid declaration")
 * in the browser compiler and produces ZERO utilities — the same
 * fully-unstyled page as the @import trap. Production evidence: the
 * 2026-10-30 Grand Haven Roofing preview run.
 *
 * Detection: v3 config keys followed by `{`/`[` (object/array literal), or
 * a quoted/array value line whose key does not start with `--` (v3 writes
 * `primary: '#a8ff2f'` / `sans: ['Inter', 'sans-serif']`; v4 keys are all
 * `--*` custom properties). @-rules (@media, @keyframes) are ignored —
 * their lines never match the key shape.
 */

/** v3 theme/config keys that are invalid inside @theme when they open an
    object or array literal. */
const TAILWIND_V3_THEME_KEY_RE =
  /(?:^|[\s{,])(colors|extend|fontFamily|fontWeight|fontSize|lineHeight|letterSpacing|screens|spacing|borderRadius|borderWidth|boxShadow|keyframes|animation|backgroundImage|backgroundSize|gridTemplateColumns|gridTemplateRows|zIndex|transitionDuration|transitionTimingFunction|container|flexGrow|flexShrink|maxWidth|minWidth|maxHeight|minHeight)\s*:\s*[{[]/i;

/** v3-style property line: `key: 'value'` or `key: [...]` inside @theme
    where v4 only allows `--*` keys and @-rules. */
const TAILWIND_V3_THEME_PROP_RE = /^\s*[a-zA-Z][\w-]*\s*:\s*['"[]/m;

/**
 * Extract @theme blocks' inner text with brace matching, so nested rules
 * (@media, @keyframes) stay intact for depth-aware scanning.
 */
function themeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const re = /@theme\b[^{]*\{/g;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
    }
    blocks.push(content.slice(start, i - 1));
    re.lastIndex = i;
  }
  return blocks;
}

/**
 * Returns the offending v3-syntax fragment (truncated) when a
 * <style type="text/tailwindcss"> block contains an @theme written as a
 * v3 config object, else null.
 *
 * Lines are scanned with brace depth: v3 config keys are invalid at ANY
 * depth, but the quoted-value property check only applies at the block's
 * top level (depth 0) — declarations inside nested @keyframes/@media
 * bodies are legitimate CSS and must not false-positive.
 */
export function findTailwindThemeV3Config(content: string): string | null {
  if (typeof content !== "string") return null;
  TAILWIND_STYLE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAILWIND_STYLE_BLOCK_RE.exec(content)) !== null) {
    for (const block of themeBlocks(m[1] ?? "")) {
      let depth = 0;
      for (const line of block.split("\n")) {
        const keyMatch = line.match(TAILWIND_V3_THEME_KEY_RE);
        if (keyMatch) return (keyMatch[0].trim()).slice(0, 120);
        if (depth === 0) {
          const propMatch = line.match(TAILWIND_V3_THEME_PROP_RE);
          if (propMatch) return (propMatch[0].trim()).slice(0, 120);
        }
        for (const ch of line) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      }
    }
  }
  return null;
}

/** Model-facing remediation for the v3-theme trap. */
export function tailwindThemeConfigMessage(offender: string, path: string): string {
  return (
    `rejected: ${path} contains a <style type="text/tailwindcss"> block whose @theme uses v3 config ` +
    `syntax (${JSON.stringify(offender)}). The Tailwind v4 browser build takes CSS custom properties inside ` +
    `@theme, not a config object — it throws CssSyntaxError and compiles ZERO utilities, so the page renders ` +
    `completely unstyled. Write tokens as variables, e.g. @theme { --color-primary: #a8ff2f; ` +
    `--font-sans: "Inter", sans-serif; }, then use them via utilities (bg-primary, font-sans). ` +
    `Never use colors/extend/fontFamily objects inside @theme.`
  );
}

/**
 * Enforcement-floor guard for the two Tailwind v4 browser-build traps.
 * Returns the model-facing error for the first trap found (import trap
 * takes precedence — it suppresses the whole build including @theme),
 * else null. Handler-level checks matter because the agent-loop gate is
 * not the only path into a mutation — /api/litt/tools/execute and resumed
 * approvals reach the same handlers without re-running the loop's
 * pre-approval validation.
 */
export function tailwindViolation(value: unknown, label: string): string | null {
  if (typeof value !== "string") return null;
  const trap = findTailwindImportTrap(value);
  if (trap) return tailwindImportTrapMessage(trap, label);
  const v3Theme = findTailwindThemeV3Config(value);
  if (v3Theme) return tailwindThemeConfigMessage(v3Theme, label);
  return null;
}

/**
 * Simulated applyPatch result — applies each search/replace to
 * already-read content with the executor's semantics (ordered,
 * first-match `String.replace`, every search must match the text left
 * by the previous patch). Returns the resulting file text, or null when
 * a search can't match — the executor throws before writing anything in
 * that case, so there is no resulting file to check.
 *
 * Needed because tailwindViolation scans for complete
 * <style type="text/tailwindcss"> blocks: a partial replace inside an
 * EXISTING block never carries the block in its own text, so the
 * per-replace scan can't see v3 syntax smuggled into @theme — only the
 * post-patch file reveals it.
 */
export function simulatePatchResult(
  content: string,
  patches: Array<{ search?: unknown; replace?: unknown }>,
): string | null {
  let updated = content;
  for (const patch of patches) {
    const search = patch?.search;
    const replace = patch?.replace;
    if (typeof search !== "string" || typeof replace !== "string") return null;
    if (!updated.includes(search)) return null;
    updated = updated.replace(search, replace);
  }
  return updated;
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
  // 1b. Tailwind @import trap — a patch can introduce the trap just as
  //     easily as a full write, so replace text gets the same check.
  for (let i = 0; i < patches.length; i++) {
    const tailwind = tailwindViolation(patches[i]?.replace, path);
    if (tailwind) {
      return `apply_patch ${tailwind} (introduced by patch ${i + 1}).`;
    }
  }
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

  // 3. Resulting-file Tailwind check — the per-replace scan above only
  //    sees complete <style type="text/tailwindcss"> blocks inside the
  //    patch text, so a partial edit inside an EXISTING block (e.g.
  //    replacing `--color-primary: …` with `colors: { primary: … }`)
  //    would slip v3 config syntax into @theme and leave the page
  //    unstyled. Validate the file as it will exist after the patch.
  const resulting = simulatePatchResult(content, patches);
  if (resulting !== null) {
    const tailwind = tailwindViolation(resulting, path);
    if (tailwind) {
      return `apply_patch ${tailwind}`;
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

  const tailwind = tailwindViolation(content, path);
  if (tailwind) {
    return `files.write ${tailwind}`;
  }

  return null;
}
