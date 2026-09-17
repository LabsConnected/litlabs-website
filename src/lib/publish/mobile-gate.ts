/**
 * Mobile-viewport publish gate (launch program fix #8).
 *
 * The quality loop's visual judge screenshots once at build time on a DESKTOP
 * viewport and scores responsiveness by guessing. Nothing verifies mobile
 * before publish — verifyProductionUrl only checks HTTP 200. This gate closes
 * that gap: it loads the published/preview page at phone width (390x844),
 * measures the real rendered layout, and BLOCKS publish on genuine breakage
 * (horizontal overflow, untappable targets, clipped text) while WARNing —
 * never silently passing — when the check itself can't run.
 *
 * Registration: designed for `src/lib/publish/publish-gates.ts`'s
 * `runPublishGates` choke point (created in parallel by fix #5). See the
 * one-line snippet at the bottom of this file's docblock.
 *
 * Screenshot infra: reuses the existing browser-session-manager
 * (Browserbase/Stagehand remote browsers) — the same infra behind
 * visual-judge.ts's defaultScreenshotCapturer. No new infra introduced.
 *
 * Honesty rules (same spirit as visual-judge):
 * - No capture / no measurement is a recorded "warn" outcome — never a
 *   fabricated pass.
 * - Messages are non-technical: what is broken and where, in the user's
 *   language.
 */

// Registration snippet for publish-gates.ts (add next to the other gates):
//   import { runMobileLayoutGate } from "./mobile-gate";
//   ...
//   results.push(await runMobileLayoutGate({ url: publishedUrl }));

import "server-only";

// ─── Constants ────────────────────────────────────────────────────

/** Gate identifier, used by the publish-gates registry. */
export const MOBILE_GATE_ID = "mobile-layout" as const;

/** Phone viewport the gate renders at (iPhone 14 logical size). */
export const MOBILE_GATE_VIEWPORT = { width: 390, height: 844 } as const;

export interface MobileViewport {
  width: number;
  height: number;
}

// ─── Layout metrics (measured inside the page at mobile width) ────

export interface MobileOverflowElement {
  /** Plain-language kind, e.g. "menu bar", "image", "heading". */
  kind: string;
  /** Short human label, e.g. a text snippet or tag. */
  label: string;
  /** "near the top of the page" | "in the middle of the page" | "near the bottom of the page". */
  position: string;
  /** How many CSS px stick out past the phone screen edge. */
  overflowPx: number;
}

export interface MobileSmallTarget {
  kind: string;
  label: string;
  position: string;
  widthPx: number;
  heightPx: number;
}

export interface MobileClippedElement {
  kind: string;
  label: string;
  position: string;
  /** How many CSS px of text are hidden. */
  hiddenPx: number;
}

export interface MobileOverlap {
  kindA: string;
  kindB: string;
  labelA: string;
  labelB: string;
  position: string;
}

export interface MobileLayoutMetrics {
  viewport: { width: number; height: number };
  /** True when the page ships a mobile viewport meta tag. */
  hasViewportMeta: boolean;
  /** Max horizontal scroll extent of the document. */
  scrollWidth: number;
  overflowElements: MobileOverflowElement[];
  smallTargets: MobileSmallTarget[];
  clippedElements: MobileClippedElement[];
  overlaps: MobileOverlap[];
}

// ─── Capture ──────────────────────────────────────────────────────

export interface MobileCaptureResult {
  /** PNG data URL of the mobile-viewport screenshot (for humans/reporting). */
  screenshot: string | null;
  /** Null when the page loaded but could not be measured. */
  metrics: MobileLayoutMetrics | null;
  /** Set when the page itself failed to load (distinct from infra failure). */
  pageError?: string;
}

/**
 * Load `url` at `viewport` and return a screenshot + layout metrics.
 * Return null (or throw) when capture is unavailable — the gate turns that
 * into a WARN, never a silent pass.
 */
export type MobileCapture = (
  url: string,
  viewport: MobileViewport,
  timeoutMs: number,
) => Promise<MobileCaptureResult | null>;

// ─── In-page measurement script ───────────────────────────────────

/**
 * Runs INSIDE the captured page (via page.evaluate). Pure DOM — no Node APIs —
 * so it serializes cleanly into the remote browser. Exported (not just
 * inlined) so it stays type-checked and unit-testable.
 */
export function collectMobileLayoutMetrics(): MobileLayoutMetrics {
  const docEl = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pageHeight = Math.max(docEl.scrollHeight, vh);

  const PLAIN_KINDS: Record<string, string> = {
    nav: "menu bar",
    header: "page header",
    footer: "page footer",
    img: "image",
    video: "video",
    button: "button",
    a: "link",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    p: "paragraph",
    form: "form",
    input: "form field",
    table: "table",
    iframe: "embedded frame",
    canvas: "canvas",
  };

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function describe(el: Element): { kind: string; label: string; position: string } {
    const tag = el.tagName.toLowerCase();
    const kind = PLAIN_KINDS[tag] ?? tag;
    const rawText = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const label = rawText || (el.id ? `#${el.id}` : kind);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const position =
      top < vh
        ? "near the top of the page"
        : top > pageHeight - vh
          ? "near the bottom of the page"
          : "in the middle of the page";
    return { kind, label, position };
  }

  const meta = document.querySelector('meta[name="viewport"]');
  const hasViewportMeta =
    !!meta && /width\s*=\s*device-width/i.test(meta.getAttribute("content") || "");

  // 1. Horizontal overflow: elements sticking out past the phone screen.
  const overflowElements: MobileOverflowElement[] = [];
  const reported = new Set<Element>();
  const all = docEl.querySelectorAll("body *");
  const SCAN_LIMIT = 4000;
  for (let i = 0; i < all.length && i < SCAN_LIMIT; i++) {
    const el = all[i];
    // Skip descendants of an already-reported element to avoid dupes.
    let ancestor: Element | null = el.parentElement;
    let nested = false;
    while (ancestor && ancestor !== docEl) {
      if (reported.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const overflowPx = Math.max(r.right - vw, -r.left, 0);
    if (overflowPx > 2) {
      const d = describe(el);
      overflowElements.push({ ...d, overflowPx: Math.round(overflowPx) });
      reported.add(el);
    }
  }
  overflowElements.sort((a, b) => b.overflowPx - a.overflowPx);

  // 2. Small tap targets.
  const TARGET_SELECTOR =
    'a, button, input, select, textarea, summary, [role="button"], [onclick]';
  const smallTargets: MobileSmallTarget[] = [];
  const targets = docEl.querySelectorAll(TARGET_SELECTOR);
  for (let i = 0; i < targets.length && i < SCAN_LIMIT; i++) {
    const el = targets[i];
    if (el.tagName.toLowerCase() === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") continue;
    }
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (Math.min(w, h) < 44) {
      const d = describe(el);
      smallTargets.push({ ...d, widthPx: w, heightPx: h });
    }
  }
  smallTargets.sort(
    (a, b) => Math.min(a.widthPx, a.heightPx) - Math.min(b.widthPx, b.heightPx),
  );

  // 3. Clipped text: overflow hidden/clip hiding scrolled content.
  const clippedElements: MobileClippedElement[] = [];
  for (let i = 0; i < all.length && i < SCAN_LIMIT; i++) {
    const el = all[i] as HTMLElement;
    const style = window.getComputedStyle(el);
    const ox = style.overflowX;
    const oy = style.overflowY;
    if (ox !== "hidden" && ox !== "clip" && oy !== "hidden" && oy !== "clip") continue;
    if (!isVisible(el)) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 8) continue;
    const hiddenX = el.scrollWidth - el.clientWidth;
    const hiddenY = el.scrollHeight - el.clientHeight;
    const hiddenPx = Math.round(Math.max(hiddenX, hiddenY));
    if (hiddenPx > 4) {
      const d = describe(el);
      clippedElements.push({ ...d, hiddenPx });
    }
  }
  clippedElements.sort((a, b) => b.hiddenPx - a.hiddenPx);

  // 4. Overlapping text blocks (heuristic, advisory-only — can false-positive).
  const overlaps: MobileOverlap[] = [];
  const textEls: { el: Element; r: DOMRect }[] = [];
  for (let i = 0; i < all.length && i < 600 && overlaps.length < 6; i++) {
    const el = all[i];
    const text = (el.textContent || "").trim();
    if (text.length < 12) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 8) continue;
    textEls.push({ el, r });
  }
  outer: for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      const a = textEls[i];
      const b = textEls[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.max(
        0,
        Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left),
      );
      const iy = Math.max(
        0,
        Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top),
      );
      if (ix <= 0 || iy <= 0) continue;
      const smallerArea =
        Math.min(a.r.width * a.r.height, b.r.width * b.r.height) || 1;
      if ((ix * iy) / smallerArea > 0.3) {
        const da = describe(a.el);
        const db = describe(b.el);
        overlaps.push({
          kindA: da.kind,
          kindB: db.kind,
          labelA: da.label,
          labelB: db.label,
          position: da.position,
        });
        if (overlaps.length >= 6) break outer;
      }
    }
  }

  return {
    viewport: { width: vw, height: vh },
    hasViewportMeta,
    scrollWidth: docEl.scrollWidth,
    overflowElements: overflowElements.slice(0, 8),
    smallTargets: smallTargets.slice(0, 12),
    clippedElements: clippedElements.slice(0, 8),
    overlaps,
  };
}

// ─── Default capturer (reuses browser-session-manager) ─────────────

const DEFAULT_CAPTURE_TIMEOUT_MS = 45_000;
const SETTLE_WAIT_MS = 1500;

/**
 * Default capture: a fresh headless browser via the existing
 * browser-session-manager (Browserbase/Stagehand) — the same infra
 * visual-judge.ts's defaultScreenshotCapturer uses — navigated at phone
 * width, measuring real layout via collectMobileLayoutMetrics.
 *
 * Any failure (missing API key, launch failure, navigation timeout) yields
 * null so the gate can record "mobile check unavailable" honestly instead
 * of fabricating a pass.
 */
export async function defaultMobileCapture(
  url: string,
  viewport: MobileViewport = MOBILE_GATE_VIEWPORT,
  timeoutMs: number = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<MobileCaptureResult | null> {
  try {
    const { startSession, getStagehand, closeSession } = await import(
      "../litt-intelligence/browser-session-manager"
    );
    const session = await startSession({
      userId: "publish-gate",
      task: "Mobile-viewport publish gate capture",
    });
    try {
      const stagehand = getStagehand(session.id);
      if (!stagehand) return null;
      const page = stagehand.context.pages()[0];
      if (!page) return null;
      await page.setViewportSize(viewport.width, viewport.height);
      await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs });
      await page.waitForTimeout(SETTLE_WAIT_MS);
      let metrics: MobileLayoutMetrics | null = null;
      try {
        metrics = (await page.evaluate(
          collectMobileLayoutMetrics,
        )) as MobileLayoutMetrics | null;
      } catch (evalErr) {
        console.warn(
          `[mobile-gate] layout measurement failed for ${url}: ` +
            (evalErr instanceof Error ? evalErr.message : String(evalErr)),
        );
      }
      const shot = await page.screenshot({ type: "png" });
      const buf = Buffer.isBuffer(shot) ? shot : Buffer.from(shot as Uint8Array);
      return {
        screenshot: `data:image/png;base64,${buf.toString("base64")}`,
        metrics,
        pageError: metrics
          ? undefined
          : "The page loaded but its layout could not be measured at phone width.",
      };
    } finally {
      await closeSession(session.id, "publish-gate").catch(() => undefined);
    }
  } catch (err) {
    // Infra failure (no key, launch error, navigation timeout): log it loudly
    // and return null so the gate warns instead of silently passing.
    console.warn(
      `[mobile-gate] mobile capture unavailable for ${url}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

// ─── Analysis (pure: metrics -> findings) ──────────────────────────

export type MobileFindingKind =
  | "overflow"
  | "tap-target"
  | "clipping"
  | "overlap"
  | "viewport-meta";

export interface MobileGateFinding {
  kind: MobileFindingKind;
  /** Blocking findings fail the gate; advisory ones only inform. */
  blocking: boolean;
  /** Number of affected elements. */
  count: number;
  /** Non-technical message: what is broken and where. */
  message: string;
}

export interface MobileGateThresholds {
  /** Horizontal overflow beyond this many px blocks publish. */
  maxOverflowPx: number;
  /** Interactive targets with min dimension below this block publish. */
  minTapTargetBlockPx: number;
  /** Interactive targets below this (but >= block) are advisory only. */
  minTapTargetWarnPx: number;
  /** Hidden-text clipping beyond this many px blocks publish. */
  maxClippedPx: number;
  /** Max findings reported per kind. */
  maxFindingsPerKind: number;
}

export const DEFAULT_MOBILE_GATE_THRESHOLDS: MobileGateThresholds = {
  maxOverflowPx: 8,
  minTapTargetBlockPx: 24,
  minTapTargetWarnPx: 44,
  maxClippedPx: 4,
  maxFindingsPerKind: 5,
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Turn measured mobile layout metrics into findings. Pure function —
 * fully unit-testable with fixture metrics.
 */
export function analyzeMobileLayout(
  metrics: MobileLayoutMetrics,
  thresholds: MobileGateThresholds = DEFAULT_MOBILE_GATE_THRESHOLDS,
): MobileGateFinding[] {
  const findings: MobileGateFinding[] = [];
  const vw = metrics.viewport.width;

  if (!metrics.hasViewportMeta) {
    findings.push({
      kind: "viewport-meta",
      blocking: true,
      count: 1,
      message:
        "The page doesn't tell phones to use a mobile layout, so on a phone it will look zoomed-out and tiny.",
    });
  }

  const docOverflowPx = metrics.scrollWidth - vw;
  if (docOverflowPx > thresholds.maxOverflowPx) {
    const worst = metrics.overflowElements[0];
    const where = worst
      ? `The ${worst.kind} ${worst.position} ("${worst.label.slice(0, 40)}") sticks out the furthest`
      : "Something on the page is wider than the phone screen";
    const extra = metrics.overflowElements.length - 1;
    findings.push({
      kind: "overflow",
      blocking: true,
      count: metrics.overflowElements.length,
      message:
        `On a phone, this page is wider than the screen — visitors would have to scroll sideways to see everything. ` +
        `${where}${extra > 0 ? `, plus ${extra} more ${plural(extra, "element", "elements")} sticking out` : ""}.`,
    });
  }

  const tiny = metrics.smallTargets.filter(
    (t) => Math.min(t.widthPx, t.heightPx) < thresholds.minTapTargetBlockPx,
  );
  if (tiny.length > 0) {
    const first = tiny[0];
    findings.push({
      kind: "tap-target",
      blocking: true,
      count: tiny.length,
      message:
        `${tiny.length} ${plural(tiny.length, "button or link is", "buttons or links are")} too small to tap reliably on a phone — ` +
        `including the ${first.kind} ${first.position} ("${first.label.slice(0, 40)}", about ${Math.min(first.widthPx, first.heightPx)}px across; phones need roughly 44px).`,
    });
  } else {
    const snug = metrics.smallTargets.filter(
      (t) => Math.min(t.widthPx, t.heightPx) < thresholds.minTapTargetWarnPx,
    );
    if (snug.length > 0) {
      findings.push({
        kind: "tap-target",
        blocking: false,
        count: snug.length,
        message:
          `${snug.length} ${plural(snug.length, "button or link is", "buttons or links are")} a bit small on a phone (under ~44px) — usable, but could be easier to tap.`,
      });
    }
  }

  const clipped = metrics.clippedElements.filter(
    (c) => c.hiddenPx > thresholds.maxClippedPx,
  );
  if (clipped.length > 0) {
    const first = clipped[0];
    findings.push({
      kind: "clipping",
      blocking: true,
      count: clipped.length,
      message:
        `Some text is cut off on a phone — ${clipped.length} ${plural(clipped.length, "spot hides", "spots hide")} text that doesn't fit, ` +
        `including the ${first.kind} ${first.position} ("${first.label.slice(0, 40)}").`,
    });
  }

  if (metrics.overlaps.length > 0) {
    const first = metrics.overlaps[0];
    findings.push({
      kind: "overlap",
      // Advisory only: overlap detection is heuristic and can false-positive.
      blocking: false,
      count: metrics.overlaps.length,
      message:
        `Some text may be overlapping on a phone — ${metrics.overlaps.length} crowded ${plural(metrics.overlaps.length, "spot", "spots")} ` +
        `(e.g. the ${first.kindA} and ${first.kindB} ${first.position}). Worth a quick look, but not blocking publish.`,
    });
  }

  return findings.slice(0, thresholds.maxFindingsPerKind * 5);
}

// ─── The gate ─────────────────────────────────────────────────────

export type MobileGateSeverity = "pass" | "warn" | "block";

export interface MobileGateContext {
  /** Published or preview URL to check at phone width. */
  url: string;
  /** Optional human label for the page (used in messages). */
  pageLabel?: string;
  /** Injectable capture; defaults to defaultMobileCapture. */
  capture?: MobileCapture;
  /** Threshold overrides for tuning/tests. */
  thresholds?: Partial<MobileGateThresholds>;
  /** Capture timeout. */
  timeoutMs?: number;
}

export interface MobileGateResult {
  gateId: typeof MOBILE_GATE_ID;
  severity: MobileGateSeverity;
  findings: MobileGateFinding[];
  /** One-line summary for the publish flow UI. */
  message: string;
  /** Mobile-viewport screenshot data URL when captured. */
  screenshot: string | null;
  checkedAt: string;
}

function warnResult(
  reason: string,
  screenshot: string | null = null,
): MobileGateResult {
  return {
    gateId: MOBILE_GATE_ID,
    severity: "warn",
    findings: [],
    message: reason,
    screenshot,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run the mobile-viewport publish gate against a URL.
 *
 * - "block": real breakage detected — do not publish; message says what and where.
 * - "pass": page measured clean at phone width.
 * - "warn": the check could not run or was inconclusive — do not block, but
 *   say so explicitly. Never a silent pass on infra errors.
 */
export async function runMobileLayoutGate(
  ctx: MobileGateContext,
): Promise<MobileGateResult> {
  const capture = ctx.capture ?? defaultMobileCapture;
  const thresholds: MobileGateThresholds = {
    ...DEFAULT_MOBILE_GATE_THRESHOLDS,
    ...ctx.thresholds,
  };
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const label = ctx.pageLabel ? ` for "${ctx.pageLabel}"` : "";

  let captured: MobileCaptureResult | null = null;
  try {
    captured = await capture(ctx.url, MOBILE_GATE_VIEWPORT, timeoutMs);
  } catch (err) {
    console.warn(
      `[mobile-gate] capture threw${label} (${ctx.url}): ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  if (!captured) {
    return warnResult(
      `We couldn't check how this page looks on a phone (the mobile screenshot check didn't run), so it's publishing without a mobile check. ` +
        `If the layout looks broken on your phone, tell LiTT and it will fix it.`,
    );
  }

  if (captured.pageError || !captured.metrics) {
    console.warn(
      `[mobile-gate] inconclusive${label} (${ctx.url}): ${captured.pageError ?? "no layout metrics"}`,
    );
    return warnResult(
      `We couldn't load the page for the mobile check${label} (${captured.pageError ?? "no layout data"}), so it's publishing without one. ` +
        `Worth opening it on your phone after publish.`,
      captured.screenshot,
    );
  }

  const findings = analyzeMobileLayout(captured.metrics, thresholds);
  const blocking = findings.filter((f) => f.blocking);
  const checkedAt = new Date().toISOString();

  if (blocking.length > 0) {
    return {
      gateId: MOBILE_GATE_ID,
      severity: "block",
      findings,
      message:
        `Hold on — this page looks broken on a phone, so it won't publish yet: ${blocking[0].message}` +
        (blocking.length > 1
          ? ` There ${blocking.length - 1 === 1 ? "is" : "are"} ${blocking.length - 1} more mobile ${plural(blocking.length - 1, "issue", "issues")} to fix.`
          : "") +
        ` Ask LiTT to fix the mobile layout and try publishing again.`,
      screenshot: captured.screenshot,
      checkedAt,
    };
  }

  const advisory = findings.filter((f) => !f.blocking);
  return {
    gateId: MOBILE_GATE_ID,
    severity: "pass",
    findings,
    message:
      advisory.length > 0
        ? `Looks good on a phone — publishing. (Minor note: ${advisory[0].message})`
        : "Looks good on a phone — no broken layout detected.",
    screenshot: captured.screenshot,
    checkedAt,
  };
}
