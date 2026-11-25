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
 *   - never OFFERS the mutation tools,
 *   - REFUSES a mutation call if the model emits one anyway
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

/** The one mutation-marked tool a deploy-only run exists to use:
 *  project.deploy publishes the workspace exactly as it stands — it
 *  is the transport itself, and it neither creates, rewrites, moves
 *  nor deletes project content. (deploy.execute is NOT transport
 *  here: it redeploys the LiTT app service itself, and stays
 *  blocked like every other mutation.) */
export const DEPLOY_TRANSPORT_TOOL_IDS: ReadonlySet<string> = new Set([
  "project.deploy",
]);

/**
 * True when a tool must be withheld and refused in a deploy-only
 * run. Derived from the registry's own metadata — every tool the
 * registry marks as mutating (`readOnly: false`, which is also how
 * station actions advertise `mutating`) is blocked, except the
 * deploy transport itself. Deriving the set, rather than listing
 * content tools by hand, is the guarantee: a hand-picked list
 * silently left files.delete / files.rename / files.patch /
 * terminal.execute executable in a "deploy" (Greptile, PR #1108),
 * and the next tool added to the registry would slip through the
 * same way. The registry-enumeration test in deploy-intent.test.ts
 * pins this against the live registry.
 */
export function isBlockedInDeployOnlyRun(tool: {
  id: string;
  readOnly: boolean;
}): boolean {
  return !tool.readOnly && !DEPLOY_TRANSPORT_TOOL_IDS.has(tool.id);
}

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
 *  work, so the run is not deploy-only — even alongside a deploy ask.
 *  The net is deliberately wide and keeps widening toward the safe
 *  side: a false deploy-only both blocks the user's edit AND
 *  publishes the unchanged page, while a missed deploy-only just
 *  behaves like a normal run. Greptile (PR #1108) caught "Make the
 *  header blue and deploy" and "Translate the page and publish"
 *  slipping through as deploy-only — hence the translation verbs,
 *  the appearance verbs, and the make-<color/comparative> shapes
 *  below, on top of the plain edit verbs. */
const CONTENT_CHANGE_PATTERNS = [
  /\bbuild(?:s|ing)?\b/i,
  /\bcreate(?:s|d)?\b/i,
  /\bchanges?\b/i,
  /\bupdate(?:s|d)?\b/i,
  /\bedit(?:s|ed|ing)?\b/i,
  /\bfix(?:es|ed|ing)?\b/i,
  /\bwrite(?:s)?\b/i,
  /\brewrite(?:s|n)?\b/i,
  /\brewriting\b/i,
  /\bredesign\b/i,
  /\bgenerate(?:s|d)?\b/i,
  /\badd(?:s|ed|ing)?\b/i,
  /\bremove(?:s|d)?\b/i,
  /\bdelete(?:s|d)?\b/i,
  /\breplace(?:s|d)?\b/i,
  /\bmodif(?:y|ies|ied)\b/i,
  /\brebuild\b/i,
  /\bredo\b/i,
  /\brename(?:s|d|ing)?\b/i,
  /\binsert(?:s|ed|ing)?\b/i,
  /\bupload(?:s|ed|ing)?\b/i,
  /\bswap(?:s|ped|ping)?\b/i,
  /\bmove(?:s|d)?\b/i,
  /\bresiz(?:e|es|ed|ing)\b/i,
  /\bhide(?:s|ing)?\b/i,
  /\bcenter(?:s|ed|ing)?\b/i,
  /\balign(?:s|ed|ing|ment)?\b/i,
  /\b(?:in|de)creas(?:e|es|ed|ing)\b/i,
  /\b(?:darken|lighten|brighten)(?:s|ed|ing)?\b/i,
  /\btweak(?:s|ed|ing)?\b/i,
  /\badjust(?:s|ed|ing|ment|ments)?\b/i,
  /\bpolish(?:es|ed|ing)?\b/i,
  /\bimprov(?:e|es|ed|ing|ement|ements)\b/i,
  /\benhanc(?:e|es|ed|ing)\b/i,
  /\brefin(?:e|es|ed|ing)\b/i,
  /\bstyle(?:s|d)?\b/i,
  /\btheme\b/i,
  /\bcolou?r(?:s|ed|ing)?\b/i,
  // Translation and language work is content work.
  /\btranslate(?:s|d|ing)?\b/i,
  /\btranslation\b/i,
  /\blocali[sz]\w*\b/i,
  /\breword(?:s|ed|ing)?\b/i,
  /\bparaphras(?:e|es|ed|ing)\b/i,
  /\bconvert(?:s|ed|ing)?\b/i,
  // "Set the price to $5", "set the title to …": a set with a
  // direct object names content. (Bare "set up" is not matched.)
  /\bset\s+(?:the|it|this|my)\b/i,
  // "Turn the menu into a grid", "turn it into a blog".
  /\bturn\s+(?:it|the|this)\s+\w+\s+into\b/i,
  // Appearance edits phrased as "make …": "make the header blue",
  // "make it darker", "make the text bigger". The object must be
  // named (it/this/the <word>/my <word>) and the result must be a
  // color or comparative — "make it live" and "make the site live"
  // are deploy phrasings and stay deploy-only (asserted in tests).
  /\bmake\s+(?:it|this|the\s+\w+|my\s+\w+)\s+(?:\w+\s+)?(?:blue|red|green|yellow|orange|purple|pink|violet|teal|cyan|magenta|brown|gold|silver|black|white|gray|grey|dark|light|darker|lighter|bigger|smaller|taller|shorter|wider|narrower|brighter|bolder|bold)\b/i,
  /\bbefore (?:you )?(?:deploy|publish|ship)/i,
];

/**
 * The turn resolver (turn-resolver.ts) appends conversation context to
 * short messages in three machine-generated shapes: a leading
 * "[Context: …] " and the trailing " — referring to: …" /
 * " — in the context of: …" segments. That context is not instruction:
 * Acceptance Run 1 on 8935b2a9 watched the Deploy… draft ("Deploy this
 * project to a live public URL") arrive here wearing the previous EDIT
 * request as its appended topic — the topic's verbs tripped the
 * content net, the run kept the full tool set, and it rewrote the
 * page (with stale content) before deploying. The resolver now leaves
 * deploy-only instructions unexpanded at the source; this strip is
 * the second line of defense for any already-expanded string (a
 * paused run's stored user message is re-classified on resume).
 * Only the machine-appended segments are removed — the user's own
 * words, including their own content verbs, are judged whole.
 */
export function stripResolverContext(instruction: string): string {
  let text = (instruction ?? "").trim();
  text = text.replace(/^\[Context:[^\]]*\]\s*/i, "");
  text = text.replace(/\s+—\s+(?:referring to|in the context of):[\s\S]*$/i, "");
  return text.trim();
}

/**
 * True when the instruction asks ONLY to deploy/publish the project
 * as it stands — no content creation or modification requested.
 */
export function isDeployOnlyInstruction(instruction: string): boolean {
  const text = stripResolverContext(instruction ?? "");
  if (!text) return false;
  if (!DEPLOY_PATTERNS.some((p) => p.test(text))) return false;
  if (CONTENT_CHANGE_PATTERNS.some((p) => p.test(text))) return false;
  return true;
}

/** The tool-result error fed back when a deploy-only run's model
 *  emits a mutation call anyway. */
export function deployOnlyRefusalError(toolId: string): string {
  return (
    `${toolId} refused: this is a deploy-only request — the user asked to publish the project ` +
    `exactly as it is, so this run must not create, rewrite, patch, move, delete, or otherwise ` +
    `modify any project content. ` +
    `Call project.deploy to publish the current workspace unchanged. ` +
    `If the user wants content changes, they will ask for them separately.`
  );
}

/** System-prompt note appended for deploy-only runs. */
export const DEPLOY_ONLY_PROMPT_NOTE =
  "DEPLOY-ONLY REQUEST: the user asked to publish/deploy the project exactly as it exists. " +
  "Do NOT write, patch, compose, regenerate, move, or delete any file in this run — every " +
  "mutation tool is disabled. " +
  "Call project.deploy to publish the current workspace unchanged, then report the stable project URL it returns.";
