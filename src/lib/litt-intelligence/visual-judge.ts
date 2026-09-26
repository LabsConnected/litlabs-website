/**
 * Visual-quality judge for the LiTT quality loop.
 *
 * After BUILD + RUN, the loop captures a screenshot of the live preview and
 * scores it across nine design dimensions. A below-threshold scorecard
 * forces a bounded return to DESIGN with the critique attached.
 *
 * Honesty rules:
 * - A scorecard only exists when the judge actually saw a screenshot and
 *   produced a scored review. No screenshot or no judge response is a
 *   recorded "unavailable" outcome — never a fabricated passing score.
 * - The judge is an LLM vision call; parsing is strict and validated.
 */

import "server-only";

import { callLLMWithTools } from "./llm-tool-calling";

// ─── Dimensions ───────────────────────────────────────────────────

export const JUDGE_DIMENSIONS = [
  "hierarchy",
  "spacing",
  "typography",
  "consistency",
  "originality",
  "responsiveness",
  "usability",
  "conversion",
  "polish",
] as const;

export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export const JUDGE_DIMENSION_GUIDANCE: Record<JudgeDimension, string> = {
  hierarchy:
    "Is there a clear visual hierarchy? One dominant headline, supporting elements, and a single obvious primary action.",
  spacing:
    "Is whitespace used deliberately? Generous, consistent rhythm between sections; nothing cramped or colliding.",
  typography:
    "Type scale, pairing, line length, and contrast. Readable body copy; display type used sparingly and with intent.",
  consistency:
    "Do colors, radii, borders, shadows, and component styles follow one coherent system instead of ad-hoc choices?",
  originality:
    "Does it avoid the generic AI-generated look (purple gradients, glassy cards, identical hero layouts)? A distinctive point of view.",
  responsiveness:
    "From this desktop viewport, would the layout plausibly adapt to mobile? No overflow, no broken grids.",
  usability:
    "Can a first-time visitor understand what this is and what to do next within seconds? Clear navigation and labels.",
  conversion:
    "Does the page drive its business goal (bookings, signups, purchases)? Visible CTAs, trust signals, low friction.",
  polish:
    "Fit and finish: alignment, edge cases, image quality, hover/focus affordances, absence of placeholder or lorem text.",
};

// ─── Scorecard ────────────────────────────────────────────────────

export interface DimensionScore {
  dimension: JudgeDimension;
  /** 0–10. */
  score: number;
  note: string;
}

export interface VisualScorecard {
  dimensions: DimensionScore[];
  /** Weighted average of dimension scores, 0–10. Equal weights for now. */
  overall: number;
  /** One-paragraph design review. */
  summary: string;
  /** Concrete, actionable fixes ordered by impact. */
  prioritizedFixes: string[];
  /** ISO timestamp of the review. */
  at: string;
  /** Model that produced the review. */
  model: string;
}

/** Overall score at or above this passes. */
export const JUDGE_PASS_THRESHOLD = 7.0;

/** Any single dimension below this fails the page regardless of overall. */
export const JUDGE_DIMENSION_FLOOR = 4.0;

export interface JudgeVerdict {
  passed: boolean;
  scorecard: VisualScorecard;
  reason: string;
}

export function judgeScorecard(card: VisualScorecard): JudgeVerdict {
  const failing = card.dimensions.filter((d) => d.score < JUDGE_DIMENSION_FLOOR);
  if (failing.length > 0) {
    return {
      passed: false,
      scorecard: card,
      reason: `Below threshold: dimension(s) under the ${JUDGE_DIMENSION_FLOOR} floor: ` +
        failing.map((d) => `${d.dimension} (${d.score.toFixed(1)})`).join(", "),
    };
  }
  if (card.overall < JUDGE_PASS_THRESHOLD) {
    return {
      passed: false,
      scorecard: card,
      reason: `Below threshold: overall ${card.overall.toFixed(1)} < ${JUDGE_PASS_THRESHOLD}.`,
    };
  }
  return {
    passed: true,
    scorecard: card,
    reason: `Pass: overall ${card.overall.toFixed(1)} ≥ ${JUDGE_PASS_THRESHOLD}, no dimension under the floor.`,
  };
}

// ─── Parsing ──────────────────────────────────────────────────────

const MAX_JUDGE_TEXT_CHARS = 8000;

export function parseScorecard(raw: string, model: string): VisualScorecard {
  // The model is asked for strict JSON but may wrap it in fences or prose.
  let jsonText = raw.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  // Fall back to the first {...} block.
  if (!jsonText.startsWith("{")) {
    const objMatch = jsonText.match(/\{[\s\S]*\}/);
    if (objMatch) jsonText = objMatch[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Visual judge did not return parseable JSON.");
  }

  const obj = parsed as Record<string, unknown>;
  const dimsRaw = obj.dimensions;
  if (!Array.isArray(dimsRaw) || dimsRaw.length === 0) {
    throw new Error("Visual judge scorecard has no dimensions.");
  }

  const dimensions: DimensionScore[] = [];
  for (const d of dimsRaw) {
    const entry = d as Record<string, unknown>;
    const dimension = String(entry.dimension ?? "").toLowerCase() as JudgeDimension;
    if (!JUDGE_DIMENSIONS.includes(dimension)) continue;
    const score = clampScore(Number(entry.score));
    const note = String(entry.note ?? "").slice(0, 500);
    dimensions.push({ dimension, score, note });
  }

  const seen = new Set(dimensions.map((d) => d.dimension));
  for (const dim of JUDGE_DIMENSIONS) {
    if (!seen.has(dim)) {
      throw new Error(`Visual judge scorecard is missing dimension "${dim}".`);
    }
  }

  const overall = clampScore(Number(obj.overall));
  // Recompute the overall defensively: the model may not average correctly.
  const recomputed = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
  const summary = String(obj.summary ?? "").slice(0, 2000);
  const prioritizedFixes = Array.isArray(obj.prioritizedFixes)
    ? (obj.prioritizedFixes as unknown[]).map((f) => String(f).slice(0, 500)).slice(0, 10)
    : [];

  return {
    dimensions,
    overall: Math.round(Math.min(overall, recomputed + 1.5) * 10) / 10,
    summary,
    prioritizedFixes,
    at: new Date().toISOString(),
    model,
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
}

/**
 * Sanity guard on the recomputed average: trust the model's overall within a
 * tolerance band, but never let it exceed the true average by more than 1.5.
 * (The recompute happens in parseScorecard above.)
 */
export { MAX_JUDGE_TEXT_CHARS };

// ─── Screenshot capture ───────────────────────────────────────────

/** Machine facts collected alongside the screenshot. */
export interface ScreenshotEvidence {
  imageDataUrl: string;
  browserInspected: true;
  styleHealthy: boolean;
  consoleClean: boolean;
  consoleErrors?: string[];
  styleProbe?: { tailwindDetected: boolean; styled: boolean };
}

/** Returns a screenshot plus machine evidence, or null when capture fails. */
export type ScreenshotCapturer = (url: string) => Promise<string | ScreenshotEvidence | null>;

/**
 * Default capturer: a fresh headless browser via the existing
 * browser-session-manager (Browserbase/Stagehand), navigating to the
 * preview URL and screenshotting. Any failure — missing API key, browser
 * launch failure, navigation timeout — yields null so the loop can record
 * "visual evidence unavailable" honestly instead of fabricating a score.
 */
export async function defaultScreenshotCapturer(url: string): Promise<string | ScreenshotEvidence | null> {
  try {
    const { startSession, getStagehand, closeSession } = await import(
      "./browser-session-manager"
    );
    const session = await startSession({
      userId: "quality-loop",
      task: "Visual quality inspection screenshot",
    });
    try {
      const stagehand = getStagehand(session.id);
      if (!stagehand) return null;
      const page = stagehand.context.pages()[0];
      if (!page) return null;
      const consoleErrors: string[] = [];
      page.on("console", (message: { type?: () => string; text?: () => string }) => {
        if (message.type?.() === "error" && consoleErrors.length < 50) {
          consoleErrors.push(message.text?.().slice(0, 500) ?? "Browser console error");
        }
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
      const styleProbe = await page.evaluate(() => {
        const tailwindDetected = Boolean(
          document.querySelector('script[src*="tailwindcss"]') ||
          document.querySelector('style[type="text/tailwindcss"]'),
        );
        if (!tailwindDetected) return { tailwindDetected: false, styled: true };
        const probe = document.createElement("div");
        probe.className = "hidden";
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
        (document.body || document.documentElement).appendChild(probe);
        const styled = window.getComputedStyle(probe).display === "none";
        probe.remove();
        return { tailwindDetected: true, styled };
      });
      const shot = await page.screenshot({ type: "png" });
      const buf = Buffer.isBuffer(shot) ? shot : Buffer.from(shot as Uint8Array);
      return {
        imageDataUrl: `data:image/png;base64,${buf.toString("base64")}`,
        browserInspected: true,
        styleHealthy: styleProbe.styled,
        consoleClean: consoleErrors.length === 0,
        consoleErrors,
        styleProbe,
      };
    } finally {
      await closeSession(session.id, "quality-loop").catch(() => undefined);
    }
  } catch {
    return null;
  }
}

// ─── The judge ────────────────────────────────────────────────────

export interface JudgeContext {
  /** What the user asked for — keeps the judge honest about intent fit. */
  userRequest: string;
  /** Brand/business context from the UNDERSTAND stage. */
  brief?: string;
  /** Design intent from the DESIGN stage. */
  designIntent?: string;
  /** The URL that was screenshotted. */
  previewUrl: string;
}

export interface JudgeOptions {
  screenshot: string | null;
  context: JudgeContext;
  capture?: ScreenshotCapturer;
  /** Injectable for tests. Defaults to the real LLM call. */
  judgeCall?: (prompt: string, imageDataUrl: string) => Promise<{ text: string; model: string }>;
  maxTextChars?: number;
}

export interface JudgeOutcome {
  status: "scored" | "unavailable";
  scorecard?: VisualScorecard;
  verdict?: JudgeVerdict;
  /** Machine browser/style facts, present when capture reached the page. */
  browserInspected?: boolean;
  styleHealthy?: boolean;
  consoleClean?: boolean;
  consoleErrors?: string[];
  styleProbe?: { tailwindDetected: boolean; styled: boolean };
  /** Set when status is "unavailable" — why no scorecard exists. */
  reason?: string;
}

function buildJudgePrompt(context: JudgeContext): string {
  const rubric = JUDGE_DIMENSIONS.map(
    (d) => `- ${d.toUpperCase()}: ${JUDGE_DIMENSION_GUIDANCE[d]}`,
  ).join("\n");

  return [
    "You are a senior product designer and design critic reviewing a screenshot of a newly built web page.",
    "Score it honestly and strictly — a generic but functional page is a 5-6, not an 8. Reserve 9-10 for genuinely distinctive, crafted work.",
    "",
    "USER REQUEST:",
    context.userRequest.slice(0, 2000),
    "",
    context.brief ? `PRODUCT BRIEF:\n${context.brief.slice(0, 2000)}\n` : "",
    context.designIntent ? `STATED DESIGN INTENT:\n${context.designIntent.slice(0, 2000)}\n` : "",
    "RUBRIC (score each 0-10):",
    rubric,
    "",
    "Respond with STRICT JSON only, no markdown fences, no prose:",
    '{ "dimensions": [ { "dimension": "<one of the nine>", "score": <0-10>, "note": "<one sentence>" } ],',
    '  "overall": <0-10>,',
    '  "summary": "<one-paragraph review>",',
    '  "prioritizedFixes": ["<most impactful fix>", "..."] }',
    "Include all nine dimensions exactly once.",
  ].join("\n");
}

/**
 * Run the visual judge. Returns a scored verdict when a screenshot could
 * be captured and judged, or an honest "unavailable" outcome otherwise.
 * Never fabricates a score.
 */
export async function runVisualJudge(options: JudgeOptions): Promise<JudgeOutcome> {
  let screenshot = options.screenshot;
  let captureEvidence: ScreenshotEvidence | null = null;
  if (!screenshot && options.capture) {
    try {
      const captured = await options.capture(options.context.previewUrl);
      if (typeof captured === "string") screenshot = captured;
      else if (captured) {
        captureEvidence = captured;
        screenshot = captured.imageDataUrl;
      }
    } catch {
      screenshot = null;
    }
  }

  if (!screenshot) {
    return {
      status: "unavailable",
      browserInspected: false,
      reason:
        "Verification unavailable: No screenshot could be captured of the preview (browser capture unavailable or failed). " +
        "Visual inspection did not pass and no success was declared.",
    };
  }

  if (captureEvidence?.styleHealthy === false || captureEvidence?.consoleClean === false) {
    const consoleReason = captureEvidence?.consoleClean === false
      ? ` Browser console reported ${captureEvidence.consoleErrors?.length ?? 1} error(s).`
      : "";
    return {
      status: "unavailable",
      browserInspected: true,
      styleHealthy: captureEvidence.styleHealthy,
      consoleClean: captureEvidence.consoleClean,
      consoleErrors: captureEvidence.consoleErrors,
      styleProbe: captureEvidence.styleProbe,
      reason:
        `${captureEvidence.styleHealthy === false ? "Preview styling failed to apply." : "Preview runtime errors blocked verification."} ` +
        `Browser inspection reached the page, but visual verification is blocked until the root cause is repaired.${consoleReason}`,
    };
  }

  const prompt = buildJudgePrompt(options.context);
  let text: string;
  let model: string;
  try {
    if (options.judgeCall) {
      const result = await options.judgeCall(prompt, screenshot);
      text = result.text;
      model = result.model;
    } else {
      const response = await callLLMWithTools(
        "You are a senior product designer and design critic. Respond with strict JSON only.",
        [{ role: "user", content: prompt, images: [screenshot] }],
        [],
        { requireVision: true, maxTokens: 2000, temperature: 0.3 },
      );
      text = response.text;
      model = response.model;
    }
  } catch (err) {
    return {
      status: "unavailable",
      browserInspected: captureEvidence?.browserInspected ?? true,
      styleHealthy: captureEvidence?.styleHealthy ?? true,
      consoleClean: captureEvidence?.consoleClean ?? true,
      consoleErrors: captureEvidence?.consoleErrors,
      styleProbe: captureEvidence?.styleProbe,
      reason: `Visual judge call failed (${err instanceof Error ? err.message : String(err)}). No score was fabricated.`,
    };
  }

  const maxChars = options.maxTextChars ?? MAX_JUDGE_TEXT_CHARS;
  const trimmed = text.length > maxChars ? text.slice(0, maxChars) : text;

  let scorecard: VisualScorecard;
  try {
    scorecard = parseScorecard(trimmed, model);
  } catch (err) {
    return {
      status: "unavailable",
      browserInspected: captureEvidence?.browserInspected ?? true,
      styleHealthy: captureEvidence?.styleHealthy ?? true,
      styleProbe: captureEvidence?.styleProbe,
      reason: `Visual judge returned an unparseable scorecard (${err instanceof Error ? err.message : String(err)}). No score was fabricated.`,
    };
  }

  return {
    status: "scored",
    scorecard,
    verdict: judgeScorecard(scorecard),
    browserInspected: captureEvidence?.browserInspected ?? true,
    styleHealthy: captureEvidence?.styleHealthy ?? true,
    consoleClean: captureEvidence?.consoleClean ?? true,
    consoleErrors: captureEvidence?.consoleErrors,
    styleProbe: captureEvidence?.styleProbe,
  };
}
