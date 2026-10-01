import "server-only";

/**
 * LiTT Reference-Match Workflow — Part H of the Tool Orchestrator fix.
 *
 * When the user says "make mine look like this" / "match this quality" /
 * "rebuild what I showed you", LiTT must recognize a REFERENCE-MATCH task
 * and follow the reference workflow instead of building a generic site in
 * the same category.
 *
 * This is the exact class of failure the orchestrator fixes: the user
 * supplies a richer reference, LiTT builds something generic, and the
 * result "does not look the same at all".
 */

// ─── Detection ────────────────────────────────────────────────────

const REFERENCE_MATCH_PATTERNS = [
  /make (mine|it) look like/i,
  /rebuild what i (showed|sent|gave) you/i,
  /\bmatch this\b/i,
  /same (quality|design|look|style) as/i,
  /like this (reference|site|design|screenshot)/i,
  /use this (screenshot|reference|design|image|site)/i,
  /\brecreate (this|that)\b/i,
  /copy (the|this) (design|layout|style)/i,
  /build (it|one) like/i,
  /inspired by/i,
];

const REFERENCE_ARTIFACT_PATTERNS = [
  /https?:\/\/\S+/i, // a URL was pasted
  /screenshot/i,
  /attached/i,
  /see (the |this )?image/i,
  /look at/i,
];

/** True when the message asks LiTT to match a supplied reference. */
export function isReferenceMatchRequest(message: string): boolean {
  return REFERENCE_MATCH_PATTERNS.some((p) => p.test(message));
}

/** True when the message appears to carry a reference artifact. */
export function hasReferenceArtifact(message: string): boolean {
  return REFERENCE_ARTIFACT_PATTERNS.some((p) => p.test(message));
}

// ─── Visual-language extraction checklist ─────────────────────────
// What LiTT must pull out of the reference before implementing.

export const REFERENCE_EXTRACTION_CHECKLIST = [
  "layout — page skeleton, section order, grid structure",
  "typography — font families, scale, weights, heading treatment",
  "colors — palette, background/foreground pairs, accent usage",
  "spacing — rhythm, section padding, component density",
  "visual hierarchy — what the eye hits first, second, third",
  "imagery style — photography vs illustration, tone, placement",
  "section structure — hero, trust signals, services, process, areas, reviews, CTA, footer",
  "conversion flow — primary CTA, secondary CTA, form fields, phone placement",
] as const;

// ─── Workflow prompt ──────────────────────────────────────────────

/**
 * The reference-match workflow, injected into the operator prompt when
 * a reference-match task is detected. Reuses existing tools — no new
 * tool system.
 */
export const REFERENCE_MATCH_WORKFLOW = `REFERENCE-MATCH WORKFLOW (follow in order — do not skip steps):

1. INSPECT THE REFERENCE. If a URL was supplied, fetch it (web.fetch) and read its structure. If a screenshot/image was supplied, study it carefully.
2. EXTRACT THE VISUAL LANGUAGE. Write down, explicitly:
${REFERENCE_EXTRACTION_CHECKLIST.map((c) => `   - ${c}`).join("\n")}
3. INSPECT THE TARGET PROJECT. Read the existing files before writing anything — do not guess the structure.
4. RESEARCH MISSING CONTEXT (only if useful). If the reference is a local-business site, a quick web.search for real local context (service areas, local details) grounds the copy.
5. SOURCE OR GENERATE IMAGERY. If the reference's quality comes from strong visuals, use image.generate for custom assets (hero, gallery, section imagery) — do not settle for text-only placeholders when the reference has rich imagery. Save generated assets into the project via project.insert_asset and reference the sitePath in HTML.
6. IMPLEMENT toward the reference's visual language — not a generic template in the same category.
7. PREVIEW the result.
8. VISUALLY COMPARE: open the rendered preview in the browser (screenshot), put it side-by-side with the reference, and list concrete differences (spacing, typography, color, imagery, section order, hierarchy).
9. ITERATE: fix the differences, re-preview, re-compare. Bound to 3 comparison passes.
10. REPORT what differs from the reference and why (e.g. "reference uses custom photography; generated equivalent imagery" or "reference has 6 gallery images; built 4 — placeholder slots marked").

Do NOT interpret "match this quality" as "make a generic site in the same category." The user will compare the two side by side.`;

/**
 * Extract candidate reference URLs from a message.
 */
export function extractReferenceUrls(message: string): string[] {
  const matches = message.match(/https?:\/\/[^\s)"']+/gi) ?? [];
  // De-dupe while preserving order.
  return [...new Set(matches)];
}
