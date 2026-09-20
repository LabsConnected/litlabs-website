/**
 * Browser Tool Handlers
 *
 * Implements the 16 browser tools for LiTT Browser Agent Mode.
 * Each handler receives the active session ID, user ID, and tool inputs,
 * then executes against the persistent Stagehand/Browserbase session
 * via the BrowserSessionManager.
 *
 * Selector priority (per architecture spec):
 *   1. DOM / accessibility selector
 *   2. Stable element attributes (data-testid, role, aria-label)
 *   3. Text matching
 *   4. Coordinates / vision (fallback only)
 *
 * Every action returns the updated browser state (URL, title, snapshot)
 * so LiTT can verify the action succeeded before continuing.
 */

import "server-only";
import {
  executeBrowserAction,
  closeSession,
  getStagehand,
  takeScreenshot,
  logBlockedBrowserNavigation,
  type BrowserActionResult,
} from "./browser-session-manager";
import { normalizeBrowserUrl, checkBrowserUrlPolicy } from "./browser-url-policy";

// Playwright-compatible page interface (Stagehand's Page type is narrower)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

// ─── Types ───────────────────────────────────────────────────────

export interface BrowserToolContext {
  sessionId: string;
  userId: string;
}

export interface BrowserState {
  url: string;
  title: string;
  screenshot?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

async function getBrowserState(sessionId: string): Promise<BrowserState | null> {
  const stagehand = getStagehand(sessionId);
  if (!stagehand) return null;

  try {
    const page = stagehand.context.pages()[0];
    if (!page) return null;
    const url = page.url();
    const title = await page.title();
    return { url, title };
  } catch {
    return null;
  }
}

async function getBrowserStateWithScreenshot(
  sessionId: string,
  userId: string,
): Promise<BrowserState | null> {
  const state = await getBrowserState(sessionId);
  if (!state) return null;
  // Phase 6 — owner-gated screenshot (the registry's getSession check in
  // executeBrowserAction already proved ownership; this is the pixel-level
  // second layer).
  const screenshot = await takeScreenshot(sessionId, userId);
  return { ...state, screenshot: screenshot ?? undefined };
}

/**
 * Current page URL for a session (Phase 3: names the site on in-chat
 * approval cards, e.g. `Click "Buy now" on example.com`). Null when the
 * session has no live page in this process — callers treat a null as
 * "site unknown", never as a failure.
 */
export async function getBrowserPageUrl(
  sessionId: string,
): Promise<string | null> {
  const state = await getBrowserState(sessionId);
  return state?.url ?? null;
}

/**
 * Resolve a selector using the priority chain:
 * 1. CSS/DOM selector (if provided)
 * 2. Accessibility attributes (role, aria-label, data-testid)
 * 3. Text content
 * 4. Coordinates (fallback)
 */
function resolveSelector(inputs: {
  selector?: string;
  role?: string;
  ariaLabel?: string;
  testId?: string;
  text?: string;
  x?: number;
  y?: number;
}): string {
  // 1. Direct CSS selector
  if (inputs.selector) return inputs.selector;

  // 2. Accessibility attributes
  if (inputs.testId) return `[data-testid="${inputs.testId}"]`;
  if (inputs.role && inputs.ariaLabel) {
    return `[role="${inputs.role}"][aria-label="${inputs.ariaLabel}"]`;
  }
  if (inputs.role) return `[role="${inputs.role}"]`;
  if (inputs.ariaLabel) return `[aria-label="${inputs.ariaLabel}"]`;

  // 3. Text matching (Stagehand's act() handles natural language)
  if (inputs.text) return `text=${inputs.text}`;

  // 4. Coordinates fallback — handled by caller via page.mouse.click()
  return "";
}

// ─── Tool Handlers ───────────────────────────────────────────────

/**
 * browser.navigate — Navigate to a URL
 *
 * Navigate-time URL policy (§5.3) applies BEFORE the browser is touched:
 * loopback/link-local/metadata IPs, non-http(s) schemes, and phishing
 * patterns are blocked and the attempt is logged to the audit trail.
 * The blocked navigation never reaches the page.
 */
export async function browserNavigate(
  ctx: BrowserToolContext,
  inputs: { url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" },
): Promise<BrowserActionResult> {
  const raw = typeof inputs.url === "string" ? inputs.url : "";
  const normalized = normalizeBrowserUrl(raw);
  if (!normalized) {
    await logBlockedBrowserNavigation(
      ctx.sessionId,
      ctx.userId,
      raw,
      `"${raw}" is not a valid web address`,
    );
    return {
      success: false,
      error: `Navigation blocked: "${raw}" is not a valid web address.`,
      durationMs: 0,
    };
  }

  const policy = checkBrowserUrlPolicy(normalized);
  if (!policy.allowed) {
    await logBlockedBrowserNavigation(
      ctx.sessionId,
      ctx.userId,
      normalized,
      policy.reason ?? "blocked by URL policy",
    );
    return {
      success: false,
      error: `Navigation blocked: ${policy.reason}.`,
      durationMs: 0,
    };
  }

  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.navigate",
    { ...inputs, url: normalized },
    async (stagehand) => {
      const page = stagehand.context.pages()[0];
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      await page.goto(normalized, {
        waitUntil: inputs.waitUntil ?? "domcontentloaded",
      });
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.snapshot — Capture accessibility tree / DOM snapshot
 */
export async function browserSnapshot(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.snapshot",
    _inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      // Get accessibility snapshot
      const accessibilitySnapshot = await page
        .accessibility()
        .snapshot()
        .catch(() => null);

      // Get visible text content (truncated for LLM context)
      const textContent = await page.evaluate(() => {
        const body = document.body;
        if (!body) return "";
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") {
              return NodeFilter.FILTER_REJECT;
            }
            const text = node.textContent?.trim();
            if (!text) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const texts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          texts.push(node.textContent?.trim() ?? "");
        }
        return texts.join("\n").slice(0, 10000);
      });

      const state = await getBrowserState(ctx.sessionId);

      return {
        success: true,
        data: {
          ...state,
          accessibility: accessibilitySnapshot,
          textContent,
        },
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.screenshot — Capture a screenshot
 */
export async function browserScreenshot(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.screenshot",
    _inputs,
    async () => {
      const screenshot = await takeScreenshot(ctx.sessionId, ctx.userId);
      if (!screenshot) {
        return { success: false, error: "Failed to capture screenshot", durationMs: 0 };
      }
      const state = await getBrowserState(ctx.sessionId);
      return {
        success: true,
        data: { ...state, screenshot },
        screenshotUrl: screenshot,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.click — Click an element using selector priority chain
 */
export async function browserClick(
  ctx: BrowserToolContext,
  inputs: {
    selector?: string;
    role?: string;
    ariaLabel?: string;
    testId?: string;
    text?: string;
    x?: number;
    y?: number;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.click",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      let modelCalls = 0;
      // Coordinate fallback
      if (inputs.x !== undefined && inputs.y !== undefined) {
        await page.mouse.click(inputs.x, inputs.y);
      } else {
        const selector = resolveSelector(inputs);
        if (!selector) {
          return {
            success: false,
            error: "No selector, text, or coordinates provided",
            durationMs: 0,
          };
        }

        if (selector.startsWith("text=")) {
          // Use Stagehand's act() for text-based interaction — this is a
          // MODEL call (Phase 4: accrues the per-action model surcharge).
          const text = selector.slice(5);
          await stagehand.act(`Click the element with text "${text}"`);
          modelCalls = 1;
        } else {
          await page.click(selector, { timeout: 10000 as number });
        }
      }

      // Wait for potential navigation/render
      await page.waitForTimeout(500).catch(() => {});
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        modelCalls,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.type — Type text into an input field
 */
export async function browserType(
  ctx: BrowserToolContext,
  inputs: {
    selector?: string;
    role?: string;
    ariaLabel?: string;
    testId?: string;
    text?: string;
    value: string;
    clear?: boolean;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.type",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      let modelCalls = 0;
      const selector = resolveSelector(inputs);
      if (!selector) {
        return {
          success: false,
          error: "No selector provided to locate input field",
          durationMs: 0,
        };
      }

      if (selector.startsWith("text=")) {
        // Stagehand act() = model call (Phase 4 surcharge).
        const text = selector.slice(5);
        await stagehand.act(`Find the input field near "${text}" and type "${inputs.value}"`);
        modelCalls = 1;
      } else {
        if (inputs.clear !== false) {
          await page.fill(selector, "").catch(() => {});
        }
        await page.fill(selector, inputs.value, { timeout: 10000 as number });
      }

      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        modelCalls,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.select — Select an option from a <select> element
 */
export async function browserSelect(
  ctx: BrowserToolContext,
  inputs: {
    selector?: string;
    testId?: string;
    ariaLabel?: string;
    value: string;
    label?: string;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.select",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      let modelCalls = 0;
      const selector = resolveSelector(inputs);
      if (!selector) {
        return {
          success: false,
          error: "No selector provided to locate select element",
          durationMs: 0,
        };
      }

      if (selector.startsWith("text=")) {
        // Stagehand act() = model call (Phase 4 surcharge).
        const text = selector.slice(5);
        await stagehand.act(`Find the select dropdown near "${text}" and select "${inputs.label ?? inputs.value}"`);
        modelCalls = 1;
      } else {
        await page.selectOption(selector, inputs.value, { timeout: 10000 as number });
      }

      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        modelCalls,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.scroll — Scroll the page or a specific element
 */
export async function browserScroll(
  ctx: BrowserToolContext,
  inputs: {
    direction?: "up" | "down" | "left" | "right";
    amount?: number;
    selector?: string;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.scroll",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      const direction = inputs.direction ?? "down";
      const amount = inputs.amount ?? 500;

      if (inputs.selector) {
        const element = await page.$(inputs.selector);
        if (element) {
          await element.scrollIntoViewIfNeeded().catch(() => {});
        }
      } else {
        const deltas: Record<string, [number, number]> = {
          up: [0, -amount],
          down: [0, amount],
          left: [-amount, 0],
          right: [amount, 0],
        };
        const [dx, dy] = deltas[direction] ?? deltas.down;
        await page.mouse.wheel(dx, dy);
      }

      await page.waitForTimeout(300).catch(() => {});
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.press — Press a keyboard key
 */
export async function browserPress(
  ctx: BrowserToolContext,
  inputs: { key: string },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.press",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      await page.keyboard.press(inputs.key);
      await page.waitForTimeout(300).catch(() => {});

      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.wait — Wait for a condition (selector, timeout, or navigation)
 */
export async function browserWait(
  ctx: BrowserToolContext,
  inputs: {
    selector?: string;
    timeoutMs?: number;
    waitFor?: "selector" | "navigation" | "timeout";
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.wait",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      const timeout = inputs.timeoutMs ?? 5000;

      if (inputs.waitFor === "navigation" || !inputs.waitFor) {
        await page.waitForLoadState("domcontentloaded", { timeout: timeout as number }).catch(() => {});
      }

      if (inputs.selector && inputs.waitFor !== "timeout") {
        await page.waitForSelector(inputs.selector, { timeout }).catch(() => {});
      }

      if (inputs.waitFor === "timeout") {
        await page.waitForTimeout(timeout).catch(() => {});
      }

      const state = await getBrowserState(ctx.sessionId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.extract — Extract structured data from the page
 */
export async function browserExtract(
  ctx: BrowserToolContext,
  inputs: {
    instruction: string;
    schema?: Record<string, unknown>;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.extract",
    inputs,
    async (stagehand) => {
      const result = await (stagehand as unknown as { extract: (opts: unknown) => Promise<unknown> }).extract({
        instruction: inputs.instruction,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: inputs.schema as any,
      });

      const state = await getBrowserState(ctx.sessionId);

      return {
        success: true,
        // stagehand.extract() is model-driven (Phase 4 surcharge).
        modelCalls: 1,
        data: { ...state, extracted: result },
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.upload — Upload a file to a file input
 */
export async function browserUpload(
  ctx: BrowserToolContext,
  inputs: {
    selector?: string;
    testId?: string;
    ariaLabel?: string;
    filePath: string;
  },
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.upload",
    inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      const selector = resolveSelector(inputs);
      if (!selector || selector.startsWith("text=")) {
        return {
          success: false,
          error: "A CSS selector, testId, or ariaLabel is required for file upload",
          durationMs: 0,
        };
      }

      const fileInput = await page.$(selector);
      if (!fileInput) {
        return {
          success: false,
          error: `File input not found: ${selector}`,
          durationMs: 0,
        };
      }

      await fileInput.setInputFiles(inputs.filePath);

      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.back — Navigate back in browser history
 */
export async function browserBack(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.back",
    _inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0];
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.forward — Navigate forward in browser history
 */
export async function browserForward(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.forward",
    _inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0];
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.reload — Reload the current page
 */
export async function browserReload(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  return executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.reload",
    _inputs,
    async (stagehand) => {
      const page = stagehand.context.pages()[0];
      if (!page) return { success: false, error: "No page available", durationMs: 0 };

      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      const state = await getBrowserStateWithScreenshot(ctx.sessionId, ctx.userId);

      return {
        success: true,
        data: state,
        durationMs: 0,
      };
    },
  );
}

/**
 * browser.close — Close the browser session
 *
 * Phase 5: closing goes through the full lifecycle. The action itself
 * runs via executeBrowserAction (multi-instance re-attach + audit
 * trail), then closeSession closes the DB row and settles BITS
 * immediately. A raw stagehand.close() alone left the row active-like
 * and never settled the meter — the Phase 4 gap this closes. Settle is
 * idempotent via `browser:settle:<sessionId>`, so this can never
 * double-charge, even if the agent closes twice.
 */
export async function browserClose(
  ctx: BrowserToolContext,
  _inputs: Record<string, unknown>,
): Promise<BrowserActionResult> {
  const result = await executeBrowserAction(
    ctx.sessionId,
    ctx.userId,
    "browser.close",
    _inputs,
    async (stagehand) => {
      await stagehand.close().catch(() => {});
      return {
        success: true,
        data: { closed: true },
        durationMs: 0,
      };
    },
  );
  // Close the row + settle even when the action couldn't attach (the
  // provider session may already be gone) — settle is a no-op replay
  // when this process already settled it.
  await closeSession(ctx.sessionId, ctx.userId).catch(() => {});
  return result;
}

// ─── Tool handler registry ───────────────────────────────────────

export type BrowserToolHandler = (
  ctx: BrowserToolContext,
  inputs: Record<string, unknown>,
) => Promise<BrowserActionResult>;

export const browserToolHandlers: Record<string, BrowserToolHandler> = {
  "browser.navigate": (ctx, inputs) =>
    browserNavigate(ctx, inputs as { url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" }),
  "browser.snapshot": (ctx, inputs) => browserSnapshot(ctx, inputs),
  "browser.screenshot": (ctx, inputs) => browserScreenshot(ctx, inputs),
  "browser.click": (ctx, inputs) =>
    browserClick(
      ctx,
      inputs as {
        selector?: string;
        role?: string;
        ariaLabel?: string;
        testId?: string;
        text?: string;
        x?: number;
        y?: number;
      },
    ),
  "browser.type": (ctx, inputs) =>
    browserType(
      ctx,
      inputs as {
        selector?: string;
        role?: string;
        ariaLabel?: string;
        testId?: string;
        text?: string;
        value: string;
        clear?: boolean;
      },
    ),
  "browser.select": (ctx, inputs) =>
    browserSelect(
      ctx,
      inputs as {
        selector?: string;
        testId?: string;
        ariaLabel?: string;
        value: string;
        label?: string;
      },
    ),
  "browser.scroll": (ctx, inputs) =>
    browserScroll(
      ctx,
      inputs as {
        direction?: "up" | "down" | "left" | "right";
        amount?: number;
        selector?: string;
      },
    ),
  "browser.press": (ctx, inputs) => browserPress(ctx, inputs as { key: string }),
  "browser.wait": (ctx, inputs) =>
    browserWait(
      ctx,
      inputs as {
        selector?: string;
        timeoutMs?: number;
        waitFor?: "selector" | "navigation" | "timeout";
      },
    ),
  "browser.extract": (ctx, inputs) =>
    browserExtract(
      ctx,
      inputs as { instruction: string; schema?: Record<string, unknown> },
    ),
  "browser.upload": (ctx, inputs) =>
    browserUpload(
      ctx,
      inputs as {
        selector?: string;
        testId?: string;
        ariaLabel?: string;
        filePath: string;
      },
    ),
  "browser.back": (ctx, inputs) => browserBack(ctx, inputs),
  "browser.forward": (ctx, inputs) => browserForward(ctx, inputs),
  "browser.reload": (ctx, inputs) => browserReload(ctx, inputs),
  "browser.close": (ctx, inputs) => browserClose(ctx, inputs),
};
