/**
 * Site-quality floor — ACC-10 Defect 3 (static judge).
 *
 * Acceptance Run 1 on 4adcdd4c (2026-11-26): the build settled
 * "Complete" and published a page that was bare unstyled HTML — no
 * <style>, no stylesheet, no hero — with the contact email rendered
 * as literal raw markdown. The run had fallen back to a weaker model;
 * nothing anywhere judged the artifact's basic completeness, so a
 * generation-quality collapse passed as a finished site.
 *
 * This module mirrors rendered-layout.ts's shape (applies /
 * violations + failure-message builder) so it plugs into the agent
 * loop exactly where the layout judge does. It judges only POSITIVE
 * evidence of the two proven failure shapes:
 *  - a full page (real body text) carrying NO styling signal at all;
 *  - raw markdown link syntax left in the HTML.
 * Stubs, redirects and partial fragments are not judged: a candidate
 * must be a complete HTML document with substantial visible text
 * before either rule can fire, so a deliberately minimal page the
 * user asked for by name is the only false-positive shape left, and
 * the honest-failure message tells the user exactly what to ask for.
 */

import { detectMarkdownLeaks, detectStyling } from "@/lib/site-enrich/audit";

export interface SiteQualityViolation {
  /** Workspace-relative path of the HTML file. */
  path: string;
  kind: "unstyled" | "markdown_leak";
  /** For markdown_leak: the offending literal text. */
  detail?: string;
}

export interface SiteQualityCheck {
  /** True when at least one mutated HTML file could be read back and
   *  the evidence is complete (same rule as the layout judge). */
  applies: boolean;
  violations: SiteQualityViolation[];
  checkedFiles: string[];
}

const MAX_CHECKED_FILES = 8;
/** A page must carry at least this much visible text before the
 *  floor judges it — below it, the file is a stub/redirect/partial,
 *  not a finished page. */
const MIN_VISIBLE_TEXT_CHARS = 200;

function isHtmlFilePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/** Visible text: markup, scripts and styles stripped, whitespace
 *  collapsed. */
function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the document is a complete page (html + body) with
 *  substantial visible text — the only shape the floor judges. */
function isFullPage(html: string): boolean {
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) return false;
  return visibleText(html).length >= MIN_VISIBLE_TEXT_CHARS;
}

/**
 * Read back the run's mutated HTML files and judge each full page
 * for the unstyled / markdown-leak shapes. Mirrors
 * checkRenderedLayout's evidence rules: unreadable files are
 * skipped, and a candidate set truncated by the read-back cap makes
 * a clean result "unknown" rather than proven.
 */
export async function checkSiteQuality(opts: {
  candidatePaths: ReadonlyArray<string>;
  readFile: (path: string) => Promise<{ content: string }>;
}): Promise<SiteQualityCheck> {
  const allCandidates = [
    ...new Set(
      opts.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0 && isHtmlFilePath(p)),
    ),
  ];
  if (allCandidates.length === 0) {
    return { applies: false, violations: [], checkedFiles: [] };
  }
  const truncated = allCandidates.length > MAX_CHECKED_FILES;
  const candidates = allCandidates.slice(0, MAX_CHECKED_FILES);

  const checkedFiles: string[] = [];
  const violations: SiteQualityViolation[] = [];
  for (const path of candidates) {
    try {
      const { content } = await opts.readFile(path);
      if (typeof content !== "string") continue;
      if (!isFullPage(content)) continue;
      checkedFiles.push(path);
      if (!detectStyling(content)) {
        violations.push({ path, kind: "unstyled" });
      }
      for (const leak of detectMarkdownLeaks(content)) {
        violations.push({ path, kind: "markdown_leak", detail: leak });
      }
    } catch {
      // Not readable — not checked. Other candidates may still answer.
    }
  }

  return {
    applies: checkedFiles.length > 0 && (violations.length > 0 || !truncated),
    violations,
    checkedFiles,
  };
}

/** The honest user-facing sentence for a build whose page is bare
 *  unstyled HTML or carries raw markdown — it cannot settle as a
 *  finished site. */
export function siteQualityFailureMessage(violations: SiteQualityViolation[]): string {
  const unstyled = violations.find((v) => v.kind === "unstyled");
  const leak = violations.find((v) => v.kind === "markdown_leak");
  const parts: string[] = [];
  if (unstyled) {
    parts.push(
      `the page in ${unstyled.path} has no styling at all — no stylesheet, no style rules, ` +
        `nothing — so it would render as bare plain text instead of a designed site`,
    );
  }
  if (leak) {
    parts.push(
      `${leak.path} still contains raw markdown (${leak.detail}) that a browser shows ` +
        `literally instead of as a link`,
    );
  }
  if (parts.length === 0) {
    return "I wrote the page, but it did not meet the basic quality floor for a finished site, so I can't confirm this build landed as intended. Please try again.";
  }
  return (
    `I wrote the page, but it is not a finished site: ${parts.join("; and ")}. ` +
    `A page like that is not what you asked for, so I can't confirm this build landed as intended. ` +
    `Ask me to restyle it and I will rebuild the page with proper styling.`
  );
}
