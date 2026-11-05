/**
 * Pure patch-application helpers shared by the workspace transport.
 *
 * Extracted from workspace-transport.ts so the matching semantics are
 * testable without the server-only HTTP stack. A patch is applied only
 * when the search text matches the file bytes exactly, or when a unique
 * whitespace-tolerant match exists. Anything else throws an actionable
 * error that quotes the closest file region so the model can re-issue
 * the patch verbatim — the production golden follow-up failed because a
 * bare "not found" error gave the model nothing to repair against.
 */

export interface SearchReplacePatch {
  type?: "search_replace";
  search: string;
  replace: string;
}

const WS_RUN_RE = /\s+/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyPatchToContent(
  path: string,
  content: string,
  patch: SearchReplacePatch,
): string {
  if (content.includes(patch.search)) {
    return content.replace(patch.search, patch.replace);
  }
  if (WS_RUN_RE.test(patch.search)) {
    // Whitespace-tolerant match: models routinely re-type indentation.
    // The tolerant match must be unique — an ambiguous hit falls through
    // to the miss error rather than patching the wrong spot.
    const flexible = new RegExp(
      patch.search.trim().split(WS_RUN_RE).map(escapeRegExp).join("\\s+"),
      "g",
    );
    const matches = [...content.matchAll(flexible)];
    if (matches.length === 1) {
      const m = matches[0];
      return content.slice(0, m.index) + patch.replace + content.slice(m.index + m[0].length);
    }
  }
  throw new Error(patchMissError(path, content, patch.search));
}

export function applyPatchesToContent(
  path: string,
  content: string,
  patches: SearchReplacePatch[],
): { updated: string } {
  let updated = content;
  for (const patch of patches) updated = applyPatchToContent(path, updated, patch);
  return { updated };
}

function patchMissError(path: string, content: string, search: string): string {
  const preview = search.slice(0, 80);
  const words = search.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  // Longest run of consecutive search words present verbatim in the file.
  // For "c 2024 Ember Roast. All rights reserved" the anchor lands on the
  // footer text, letting the error quote "&copy; 2024 Ember Roast…" back.
  let best = "";
  for (let i = 0; i < words.length; i++) {
    let run = "";
    for (let j = i; j < words.length; j++) {
      const cand = run ? `${run} ${words[j]}` : words[j];
      if (!content.includes(cand)) break;
      run = cand;
    }
    if (run.length > best.length) best = run;
  }
  if (best.length >= 8) {
    const idx = content.indexOf(best);
    const start = content.lastIndexOf("\n", idx - 1) + 1;
    const nl = content.indexOf("\n", idx + best.length);
    const end = nl === -1 ? Math.min(content.length, idx + best.length + 160) : nl;
    const region = content.slice(start, end).trim().slice(0, 240);
    return (
      `Patch search string not found in ${path}: "${preview}...". ` +
      `The closest matching region is: "${region}" — resend the patch using the exact bytes from the file.`
    );
  }
  return `Patch search string not found in ${path}: "${preview}..."`;
}
