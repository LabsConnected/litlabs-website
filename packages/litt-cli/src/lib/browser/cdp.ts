/**
 * Minimal CDP (Chrome DevTools Protocol) browser driver — zero dependencies.
 *
 * Launches an installed Chrome/Edge with --remote-debugging-port and drives
 * it over the built-in Node 22 WebSocket global. Supports the operations a
 * browsing agent needs: navigate, evaluate (inspection/extraction), real
 * input (click/type/scroll via Input domain), and screenshots.
 *
 * Security: the browser runs with a throwaway --user-data-dir under the OS
 * temp dir, --no-first-run, and no extension sync. It is killed on close().
 * The debug port binds 127.0.0.1 only (DevToolsActivePort file).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CdpBrowserOptions {
  /** Explicit browser binary. Auto-detected when omitted. */
  executablePath?: string;
  /** Launch headless (default true). Set false for a visible window. */
  headless?: boolean;
  /** Viewport for Emulation.setDeviceMetricsOverride. */
  width?: number;
  height?: number;
  /** Extra Chrome flags. */
  args?: string[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text content, whitespace-collapsed, capped. */
  text: string;
  /** Interactive elements: links, buttons, inputs with a stable selector hint. */
  elements: Array<{ tag: string; text: string; selector: string }>;
}

interface CdpTarget { targetId: string; type: string; url: string; title?: string }

const CHROME_CANDIDATES = [
  process.env.LITT_BROWSER_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : undefined,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p));

export function findBrowser(): string | null {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

export class CdpBrowser {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private events: Array<{ method: string; params: any }> = [];
  private eventWaiters: Array<{ method: string; predicate?: (p: any) => boolean; resolve: (p: any) => void }> = [];
  private sessionId = "";
  private profileDir = "";
  private closed = false;

  static async launch(opts: CdpBrowserOptions = {}): Promise<CdpBrowser> {
    const exe = opts.executablePath ?? findBrowser();
    if (!exe) throw new Error("No Chrome/Edge binary found — set LITT_BROWSER_PATH");
    const b = new CdpBrowser();
    b.profileDir = mkdtempSync(join(tmpdir(), "litt-browser-"));
    const portFile = join(b.profileDir, "DevToolsActivePort");
    const args = [
      "--remote-debugging-port=0",
      `--user-data-dir=${b.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-features=Translate",
      "--metrics-recording-only",
      "--mute-audio",
      ...(opts.headless === false ? [] : ["--headless=new"]),
      ...(opts.args ?? []),
      "about:blank",
    ];
    b.proc = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    b.proc.on("exit", () => { if (!b.closed) b.failAll(new Error("browser process exited")); });
    // Never orphan Chrome: kill synchronously on process exit (SIGINT path
    // exits via process.exit(), which skips async cleanup).
    process.once("exit", () => { try { if (b.proc && !b.proc.killed) b.proc.kill(); } catch { /* ignore */ } });
    // DevToolsActivePort appears once the devtools endpoint is up.
    const deadline = Date.now() + 15_000;
    let port = 0;
    while (Date.now() < deadline) {
      if (existsSync(portFile)) {
        port = parseInt(readFileSync(portFile, "utf8").split("\n")[0].trim(), 10);
        if (port > 0) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!port) {
      b.close();
      throw new Error("browser did not open a DevTools endpoint within 15s");
    }
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
    await b.connect(version.webSocketDebuggerUrl);
    // Create a page target and attach with flattened session.
    const { targetId } = await b.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    b.sessionId = sessionId;
    await b.send("Page.enable", {}, sessionId);
    await b.send("Runtime.enable", {}, sessionId);
    if (opts.width && opts.height) {
      await b.send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    }
    return b;
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("CDP websocket connect timeout")), 10_000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP websocket error")); };
      ws.onmessage = (ev) => this.onMessage(String(ev.data));
      ws.onclose = () => { if (!this.closed) this.failAll(new Error("CDP websocket closed")); };
    });
  }

  private onMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message ?? "CDP error"} (${msg.error.code})`));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method) {
      this.events.push({ method: msg.method, params: msg.params });
      for (let i = this.eventWaiters.length - 1; i >= 0; i--) {
        const w = this.eventWaiters[i];
        if (w.method === msg.method && (!w.predicate || w.predicate(msg.params))) {
          this.eventWaiters.splice(i, 1);
          w.resolve(msg.params);
        }
      }
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  send<T = any>(method: string, params: any = {}, sessionId?: string): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("browser not connected"));
    }
    const id = ++this.msgId;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  private waitEvent(method: string, timeoutMs = 15_000, predicate?: (p: any) => boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.eventWaiters.push({
        method,
        predicate,
        resolve: (p) => { clearTimeout(timer); resolve(p); },
      });
      // Reject path: leave waiter; timeout covers it.
      void timer;
    });
  }

  async navigate(url: string, timeoutMs = 20_000): Promise<{ url: string; title: string }> {
    const loaded = this.waitEvent("Page.loadEventFired", timeoutMs).catch(() => null);
    await this.send("Page.navigate", { url }, this.sessionId);
    await loaded;
    // Give SPA routers a beat beyond loadEventFired.
    await new Promise((r) => setTimeout(r, 400));
    return this.evaluate<{ url: string; title: string }>("({url: location.href, title: document.title})");
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value?: T }; exceptionDetails?: any }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const detail = d.exception?.description ?? d.exception?.value ?? d.text ?? "evaluation failed";
      throw new Error(`page JS error: ${String(detail).split("\n")[0]}`);
    }
    return res.result.value as T;
  }

  /** Structured page inspection: url, title, visible text, interactive elements. */
  async snapshot(maxText = 4000, maxElements = 60): Promise<PageSnapshot> {
    return this.evaluate<PageSnapshot>(`(() => {
      const sel = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let n = el;
        while (n && n !== document.body && parts.length < 4) {
          let p = n.tagName.toLowerCase();
          const sibs = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
          if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
          parts.unshift(p);
          n = n.parentElement;
        }
        return parts.join(' > ');
      };
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const text = (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, ${maxText});
      const els = [];
      for (const el of document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link]')) {
        if (!vis(el) || els.length >= ${maxElements}) continue;
        els.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
          selector: sel(el),
        });
      }
      return { url: location.href, title: document.title, text, elements: els };
    })()`);
  }

  /** Click an element resolved from snapshot().elements[].selector via real mouse events. */
  async click(selector: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`click target not found: ${selector}`);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, this.sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await new Promise((r) => setTimeout(r, 300));
  }

  /** Type text into the currently focused element via real key events. */
  async type(text: string): Promise<void> {
    await this.send("Input.insertText", { text }, this.sessionId);
  }

  /** Focus a field by selector, then type into it. */
  async fill(selector: string, text: string): Promise<void> {
    const ok = await this.evaluate<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.select) try { el.select(); } catch {}
      return document.activeElement === el;
    })()`);
    if (!ok) throw new Error(`fill target not found or not focusable: ${selector}`);
    await this.type(text);
  }

  async scroll(deltaY: number): Promise<void> {
    await this.evaluate(`window.scrollBy(0, ${deltaY})`);
    await new Promise((r) => setTimeout(r, 200));
  }

  /** Capture a PNG screenshot; returns raw bytes. */
  async screenshot(): Promise<Buffer> {
    const res = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, this.sessionId);
    return Buffer.from(res.data, "base64");
  }

  async saveScreenshot(path: string): Promise<string> {
    const png = await this.screenshot();
    writeFileSync(path, png);
    return path;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.failAll(new Error("browser closed"));
    const proc = this.proc;
    this.proc = null;
    if (proc && !proc.killed) {
      try { proc.kill(); } catch { /* ignore */ }
      // Give Chrome a moment to flush the profile dir, then remove it.
      setTimeout(() => { try { rmSync(this.profileDir, { recursive: true, force: true }); } catch { /* ignore */ } }, 500).unref();
    } else {
      try { rmSync(this.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
