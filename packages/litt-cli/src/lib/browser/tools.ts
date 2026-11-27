/**
 * browser.* agent tools — genuine autonomous browsing via local Chrome CDP.
 *
 * One browser session per CLI process, created lazily on first use and
 * always closed on process exit. Read tools (navigate/snapshot/screenshot/
 * scroll/evaluate-read) are readOnly; input tools (click/type/fill) are
 * mutating so the permission layer gates them behind approval.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolContext, ToolDefinition, ToolEntry, ToolResult } from "@litt/agent-core";
import { CdpBrowser, findBrowser } from "./cdp.js";

const ok = (message: string, data: Record<string, unknown> = {}): ToolResult =>
  ({ status: "success", success: true, message, data });
const fail = (message: string, data: Record<string, unknown> = {}): ToolResult =>
  ({ status: "failed", success: false, message, data });

let browser: CdpBrowser | null = null;
let browserStarting: Promise<CdpBrowser> | null = null;

async function getBrowser(ctx: ToolContext): Promise<CdpBrowser> {
  if (browser) return browser;
  if (!browserStarting) {
    browserStarting = (async () => {
      if (!findBrowser()) throw new Error("no Chrome/Edge binary found — set LITT_BROWSER_PATH");
      const b = await CdpBrowser.launch({ width: 1280, height: 800 });
      browser = b;
      return b;
    })();
    browserStarting.catch(() => { browserStarting = null; });
  }
  return browserStarting;
}

/** Close the shared browser — called on session teardown / process exit. */
export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  browserStarting = null;
  if (b) await b.close().catch(() => {});
}

function shotPath(ctx: ToolContext, name: string): string {
  const dir = join(ctx.cwd, ".litt", "browser");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

const NAV_DEF: ToolDefinition = {
  id: "browser.navigate",
  name: "browser_navigate",
  description: "Open a URL in the local browser and return the final URL + page title. Use for any task that requires viewing a web page.",
  inputSchema: { type: "object", properties: { url: { type: "string", description: "http(s) URL to open" } }, required: ["url"] },
  readOnly: true,
};
const SNAP_DEF: ToolDefinition = {
  id: "browser.snapshot",
  name: "browser_snapshot",
  description: "Inspect the current page: URL, title, visible text, and a list of interactive elements (links/buttons/inputs) with CSS selectors usable by browser.click/browser.fill.",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};
const SHOT_DEF: ToolDefinition = {
  id: "browser.screenshot",
  name: "browser_screenshot",
  description: "Capture a PNG screenshot of the current page, saved under .litt/browser/ in the workspace. Returns the file path.",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "Optional file name (default shot-<ts>.png)" } } },
  readOnly: true,
};
const CLICK_DEF: ToolDefinition = {
  id: "browser.click",
  name: "browser_click",
  description: "Click an element on the current page using a CSS selector from browser.snapshot (e.g. 'a:nth-of-type(2)', '#submit', 'button.primary').",
  inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
  readOnly: false,
};
const TYPE_DEF: ToolDefinition = {
  id: "browser.type",
  name: "browser_type",
  description: "Type text into the currently focused element, or into a field selected by CSS selector. Refuses password/credit-card fields.",
  inputSchema: { type: "object", properties: { text: { type: "string" }, selector: { type: "string", description: "Optional CSS selector to focus first" } }, required: ["text"] },
  readOnly: false,
};
const SCROLL_DEF: ToolDefinition = {
  id: "browser.scroll",
  name: "browser_scroll",
  description: "Scroll the page vertically (positive = down, negative = up).",
  inputSchema: { type: "object", properties: { deltaY: { type: "number" } } },
  readOnly: true,
};
const EXTRACT_DEF: ToolDefinition = {
  id: "browser.extract",
  name: "browser_extract",
  description: "Run a JavaScript expression in the page and return its JSON value. Use for structured extraction (e.g. table rows, prices).",
  inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  readOnly: true,
};
const CLOSE_DEF: ToolDefinition = {
  id: "browser.close",
  name: "browser_close",
  description: "Close the shared browser session and release the browser process.",
  inputSchema: { type: "object", properties: {} },
  readOnly: false,
};

const READ_ONLY_META = { projectScoped: false, mutating: false, readOnly: true } as const;
const MUTATING_META = { projectScoped: false, mutating: true, readOnly: false } as const;

const SENSITIVE_INPUT_GUARD = `(() => {
  const el = document.querySelector(SEL);
  if (!el) return 'missing';
  const t = (el.type || '').toLowerCase();
  const ac = (el.autocomplete || '').toLowerCase();
  const nm = (el.name || '').toLowerCase();
  if (t === 'password' || ac.includes('cc-') || /card|cvv|cvc|ssn/.test(nm)) return 'sensitive';
  return 'ok';
})()`;

export const BROWSER_TOOL_ENTRIES: Record<string, ToolEntry> = {
  "browser.navigate": {
    definition: NAV_DEF,
    metadata: READ_ONLY_META,
    handler: async (ctx, args) => {
      const url = typeof args.url === "string" ? args.url : "";
      if (!/^https?:\/\//i.test(url)) return fail("browser.navigate requires an http(s) URL");
      try {
        const b = await getBrowser(ctx);
        const r = await b.navigate(url);
        return ok(`navigated to ${r.url} — "${r.title}"`, { url: r.url, title: r.title });
      } catch (e) { return fail(`browser navigate failed: ${(e as Error).message}`); }
    },
  },
  "browser.snapshot": {
    definition: SNAP_DEF,
    metadata: READ_ONLY_META,
    handler: async (ctx) => {
      try {
        const b = await getBrowser(ctx);
        const s = await b.snapshot();
        return ok(`page "${s.title}" — ${s.elements.length} interactive elements`, {
          url: s.url, title: s.title, text: s.text, elements: s.elements,
        });
      } catch (e) { return fail(`browser snapshot failed: ${(e as Error).message}`); }
    },
  },
  "browser.screenshot": {
    definition: SHOT_DEF,
    metadata: READ_ONLY_META,
    handler: async (ctx, args) => {
      try {
        const b = await getBrowser(ctx);
        const name = typeof args.name === "string" && /^[\w.-]+$/.test(args.name) ? args.name : `shot-${Date.now()}.png`;
        const path = shotPath(ctx, name.endsWith(".png") ? name : `${name}.png`);
        await b.saveScreenshot(path);
        return ok(`screenshot saved to ${path}`, { path });
      } catch (e) { return fail(`browser screenshot failed: ${(e as Error).message}`); }
    },
  },
  "browser.click": {
    definition: CLICK_DEF,
    metadata: MUTATING_META,
    handler: async (ctx, args) => {
      const selector = typeof args.selector === "string" ? args.selector : "";
      if (!selector) return fail("browser.click requires a selector");
      try {
        const b = await getBrowser(ctx);
        await b.click(selector);
        const r = await b.evaluate<{ url: string; title: string }>("({url: location.href, title: document.title})");
        return ok(`clicked ${selector} — now at ${r.url}`, { url: r.url, title: r.title });
      } catch (e) { return fail(`browser click failed: ${(e as Error).message}`); }
    },
  },
  "browser.type": {
    definition: TYPE_DEF,
    metadata: MUTATING_META,
    handler: async (ctx, args) => {
      const text = typeof args.text === "string" ? args.text : "";
      const selector = typeof args.selector === "string" ? args.selector : "";
      try {
        const b = await getBrowser(ctx);
        if (selector) {
          const guard = await b.evaluate<string>(SENSITIVE_INPUT_GUARD.replace("SEL", JSON.stringify(selector)));
          if (guard === "sensitive") return fail("refused: target field holds passwords/payment data — sensitive input is not typed by the agent");
          if (guard === "missing") return fail(`type target not found: ${selector}`);
          await b.fill(selector, text);
        } else {
          await b.type(text);
        }
        return ok(`typed ${text.length} chars${selector ? ` into ${selector}` : ""}`);
      } catch (e) { return fail(`browser type failed: ${(e as Error).message}`); }
    },
  },
  "browser.scroll": {
    definition: SCROLL_DEF,
    metadata: READ_ONLY_META,
    handler: async (ctx, args) => {
      try {
        const b = await getBrowser(ctx);
        const dy = typeof args.deltaY === "number" ? args.deltaY : 600;
        await b.scroll(dy);
        return ok(`scrolled ${dy > 0 ? "down" : "up"} ${Math.abs(dy)}px`);
      } catch (e) { return fail(`browser scroll failed: ${(e as Error).message}`); }
    },
  },
  "browser.extract": {
    definition: EXTRACT_DEF,
    metadata: READ_ONLY_META,
    handler: async (ctx, args) => {
      const expression = typeof args.expression === "string" ? args.expression : "";
      if (!expression) return fail("browser.extract requires a JS expression");
      try {
        const b = await getBrowser(ctx);
        const value = await b.evaluate(expression);
        return ok("extracted page data", { value });
      } catch (e) { return fail(`browser extract failed: ${(e as Error).message}`); }
    },
  },
  "browser.close": {
    definition: CLOSE_DEF,
    metadata: MUTATING_META,
    handler: async () => {
      await closeBrowser();
      return ok("browser session closed");
    },
  },
};
