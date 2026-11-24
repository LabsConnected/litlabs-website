/**
 * ACC-03 item 1 — deploy-only intent: a deploy is transport, not a build.
 *
 * The failure (staging Acceptance Run 1 on release 055ae851,
 * 2026-11-24): the user pressed the Deploy surface's "Redeploy with
 * LiTT" hand-off, which prefilled the chat with "Deploy this project
 * to production" — and the run answered by REGENERATING index.html
 * through five sequential approved file writes: menu items, prices
 * and opening hours changed, and the theme flipped from dark to
 * light. The deploy then published the rewritten page. A deploy
 * instruction carries no content intent at all; the model treated
 * "deploy" as a fresh build with a deploy at the end.
 *
 * This module classifies that shape deterministically (pure, no I/O,
 * in the capability-planner mold): the instruction asks to deploy /
 * publish / ship AND asks for no content work. For such a run the
 * agent loop
 *   - never OFFERS the content-mutation tools,
 *   - REFUSES a content-mutation call if the model emits one anyway
 *     (no checkpoint, no approval card, no execution — the refusal
 *     is fed back as a tool result so the model proceeds to
 *     project.deploy), and
 *   - appends DEPLOY_ONLY_PROMPT_NOTE to the system prompt.
 *
 * The classifier is deliberately narrow: any content verb in the
 * instruction (build, change, fix, add, …) makes it NOT deploy-only,
 * so a mixed request ("fix the header, then deploy") keeps the full
 * tool set and behaves exactly as before. A missed deploy-only
 * classification costs nothing but the status quo; a false one would
 * block a build the user actually asked for — hence the wide
 * content-verb net.
 */

/** Tool ids that create or rewrite project content. In a deploy-only
 *  run these are neither offered nor executed. (Deploy itself —
 *  project.deploy — is transport and stays available.) */
export const CONTENT_MUTATION_TOOL_IDS: ReadonlySet<string> = new Set([
  "files.write",
  "apply_patch",
  "site.compose",
  "site.patch",
  "project.insert_asset",
]);

const DEPLOY_PATTERNS = [
  /\bdeploy(?:s|ed|ing|ment)?\b/i,
  /\bredeploy\b/i,
  /\bpublish(?:es|ed|ing)?\b/i,
  /\brepublish\b/i,
  /\bship it\b/i,
  /\bgo live\b/i,
  /\bput (?:it|this|the site|the project) live\b/i,
  /\bmake (?:it|this|the site|the project) live\b/i,
];

/** Any of these in the instruction means the user asked for content
 *  work, so the run is not deploy-only — even alongside a deploy ask. */
const CONTENT_CHANGE_PATTERNS = [
  /\bbuild(?:s|ing)?\b/i,
  /\bcreate(?:s|d)?\b/i,
  /\bchanges?\b/i,
  /\bupdate(?:s|d)?\b/i,
  /\bedit(?:s|ed|ing)?\b/i,
  /\bfix(?:es|ed|ing)?\b/i,
  /\bwrite(?:s)?\b/i,
  /\bredesign\b/i,
  /\bgenerate(?:s|d)?\b/i,
  /\badd(?:s|ed|ing)?\b/i,
  /\bremove(?:s|d)?\b/i,
  /\bdelete(?:s|d)?\b/i,
  /\breplace(?:s|d)?\b/i,
  /\bmodif(?:y|ies|ied)\b/i,
  /\brebuild\b/i,
  /\bredo\b/i,
  /\bbefore (?:you )?(?:deploy|publish|ship)/i,
];

/**
 * True when the instruction asks ONLY to deploy/publish the project
 * as it stands — no content creation or modification requested.
 */
export function isDeployOnlyInstruction(instruction: string): boolean {
  const text = (instruction ?? "").trim();
  if (!text) return false;
  if (!DEPLOY_PATTERNS.some((p) => p.test(text))) return false;
  if (CONTENT_CHANGE_PATTERNS.some((p) => p.test(text))) return false;
  return true;
}

/** The tool-result error fed back when a deploy-only run's model
 *  emits a content-mutation call anyway. */
export function deployOnlyRefusalError(toolId: string): string {
  return (
    `${toolId} refused: this is a deploy-only request — the user asked to publish the project ` +
    `exactly as it is, so this run must not create, rewrite, or patch any file. ` +
    `Call project.deploy to publish the current workspace unchanged. ` +
    `If the user wants content changes, they will ask for them separately.`
  );
}

/** System-prompt note appended for deploy-only runs. */
export const DEPLOY_ONLY_PROMPT_NOTE =
  "DEPLOY-ONLY REQUEST: the user asked to publish/deploy the project exactly as it exists. " +
  "Do NOT write, patch, compose, or regenerate any file in this run — the content tools are disabled. " +
  "Call project.deploy to publish the current workspace unchanged, then report the stable project URL it returns.";
