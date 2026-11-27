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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPublicHttpDestination,
  assertPublicHttpUrl,
  startEgressProxy,
  type DnsResolver,
  type EgressProxy,
} from "./net-guard.js";

// Policy + DNS-resolution enforcement lives in ./net-guard.ts (shared
// with the enforcing egress proxy). Re-exported here so existing
// importers (tools.ts, tests) keep their paths.
export { assertPublicHttpDestination, assertPublicHttpUrl };
export type { DnsResolver };

export interface CdpBrowserOptions {
  /** Explicit browser binary. Auto-detected when omitted. */
  executablePath?: string;
  /** Launch headless (default true). Set false for a visible window. */
  headless?: boolean;
  /**
   * Persistent profile directory. When set (or LITT_BROWSER_PROFILE is
   * set), cookies/site data survive across browser sessions — this is
   * the session-restoration path. Default: throwaway temp profile that
   * is deleted on close (secure default — no credential residue).
   */
  profileDir?: string;
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

// Navigation/DNS egress policy (assertPublicHttpUrl,
// assertPublicHttpDestination, resolvePublicIp, startEgressProxy) lives
// in ./net-guard.ts — Chrome is launched through that enforcing proxy
// so every connection is validated and pinned at the network layer.
// LITT_BROWSER_ALLOW_PRIVATE=1 disables both the guards and the proxy.

export class CdpBrowser {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private events: Array<{ method: string; params: unknown }> = [];
  private eventWaiters: Array<{ method: string; predicate?: (p: unknown) => boolean; resolve: (p: unknown) => void }> = [];
  private sessionId = "";
  private profileDir = "";
  private persistentProfile = false;
  private egressProxy: EgressProxy | null = null;
  private closed = false;

  static async launch(opts: CdpBrowserOptions = {}): Promise<CdpBrowser> {
    const exe = opts.executablePath ?? findBrowser();
    if (!exe) throw new Error("No Chrome/Edge binary found — set LITT_BROWSER_PATH");
    const b = new CdpBrowser();
    // Enforcing egress proxy: every connection Chrome makes (documents,
    // redirects, subresources, workers, WebSockets) is validated against
    // the public-destination policy and pinned to the resolved IP, so
    // Chrome never performs its own DNS resolution — the rebinding /
    // validation-to-connect race is closed at the network layer. If the
    // proxy cannot start we cannot guarantee destination policy, so
    // launch fails closed. LITT_BROWSER_ALLOW_PRIVATE=1 opts out for
    // trusted local development (e.g. browsing localhost).
    const allowPrivate = process.env.LITT_BROWSER_ALLOW_PRIVATE === "1";
    if (!allowPrivate) {
      b.egressProxy = await startEgressProxy();
    }
    const persistent = opts.profileDir ?? process.env.LITT_BROWSER_PROFILE;
    if (persistent) {
      b.profileDir = persistent;
      b.persistentProfile = true;
      mkdirSync(b.profileDir, { recursive: true });
    } else {
      b.profileDir = mkdtempSync(join(tmpdir(), "litt-browser-"));
    }
    const portFile = join(b.profileDir, "DevToolsActivePort");
    // CI containers routinely deny user namespaces (Chrome's sandbox
    // needs them) and ship a tiny /dev/shm that crashes the renderer.
    // --no-sandbox stays opt-in outside CI: LITT_BROWSER_NO_SANDBOX=1 or
    // a real CI environment (CI === "true" exactly — "false"/"0" must not
    // trip it). --disable-dev-shm-usage is harmless everywhere.
    const noSandbox = process.env.LITT_BROWSER_NO_SANDBOX === "1" || process.env.CI === "true";
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
      "--disable-dev-shm-usage",
      "--metrics-recording-only",
      "--mute-audio",
      // All egress through the enforcing proxy. "<-loopback>" removes
      // Chrome's implicit localhost bypass so loopback targets are
      // forced through policy too. --disable-quic keeps everything on
      // TCP through the proxy (QUIC/UDP cannot be proxied).
      ...(b.egressProxy
        ? [
            `--proxy-server=http://127.0.0.1:${b.egressProxy.port}`,
            "--proxy-bypass-list=<-loopback>",
            "--disable-quic",
          ]
        : []),
      ...(noSandbox ? ["--no-sandbox"] : []),
      ...(opts.headless === false ? [] : ["--headless=new"]),
      ...(opts.args ?? []),
      "about:blank",
    ];
    b.proc = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    // Keep the stderr tail for diagnostics — Chrome's real failure reason
    // (missing libs, sandbox denial) otherwise vanishes with the pipe.
    // Chrome also announces "DevTools listening on ws://…" here; on some
    // platforms (CI containers) it never writes DevToolsActivePort, so
    // the stderr endpoint is the authoritative fallback.
    let stderrTail = "";
    let stderrWsUrl: string | null = null;
    b.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrTail = (stderrTail + text).slice(-4096);
      // Match against the accumulated tail — the line can split across chunks.
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderrTail);
      if (m) stderrWsUrl = m[1];
    });
    b.proc.on("exit", () => { if (!b.closed) b.failAll(new Error("browser process exited")); });
    // Never orphan Chrome: kill synchronously on process exit (SIGINT path
    // exits via process.exit(), which skips async cleanup).
    process.once("exit", () => { try { if (b.proc && !b.proc.killed) b.proc.kill(); } catch { /* ignore */ } });
    // DevToolsActivePort appears once the devtools endpoint is up. With a
    // persistent profile the file can be STALE from a previous session
    // (pointing at a dead port) or briefly held by a Chrome still shutting
    // down — so don't trust the file alone: poll it and verify the
    // endpoint actually answers /json/version before connecting.
    const deadline = Date.now() + 15_000;
    let version: { webSocketDebuggerUrl?: string } | null = null;
    while (Date.now() < deadline) {
      if (stderrWsUrl) {
        version = { webSocketDebuggerUrl: stderrWsUrl };
        break;
      }
      if (existsSync(portFile)) {
        try {
          // Chrome holds DevToolsActivePort open on Windows — a read can
          // race it (EBUSY). Treat any read/parse failure as "keep polling".
          const port = parseInt(readFileSync(portFile, "utf8").split("\n")[0].trim(), 10);
          if (port > 0) {
            version = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json()) as { webSocketDebuggerUrl?: string } | null;
            if (version?.webSocketDebuggerUrl) break;
          }
        } catch { /* locked/stale/starting — keep polling */ }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!version?.webSocketDebuggerUrl) {
      const tail = stderrTail.trim();
      await b.close();
      throw new Error(
        `browser did not open a DevTools endpoint within 15s${tail ? ` — ${tail.split("\n").slice(-3).join(" | ")}` : ""}`,
      );
    }
    try {
      await b.connect(version.webSocketDebuggerUrl);
    } catch (e) {
      await b.close();
      throw e;
    }
    // Browser-level Network domain — required for Network.getAllCookies
    // (session save/restore). Page/Runtime are enabled on the page
    // session below; this one is on the browser target itself.
    try {
      await b.send("Network.enable").catch(() => {});
      // Create a page target and attach with flattened session.
      const { targetId } = await b.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await b.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      b.sessionId = sessionId;
      await b.send("Page.enable", {}, sessionId);
      await b.send("Runtime.enable", {}, sessionId);
      // Destination policy is enforced at the network layer by the egress
      // proxy started in launch() — every request, redirect, subresource,
      // worker and WebSocket is validated and IP-pinned there, which also
      // covers targets Fetch-domain interception would miss. No
      // Fetch.enable: it would only add a per-request pause/validate
      // round-trip on top of the authoritative proxy check.
      // Deny all downloads — a page must not silently write files to disk.
      // Browser.setDownloadBehavior covers the default browser context;
      // failure is non-fatal on Chrome builds that moved the behavior.
      try {
        await b.send("Browser.setDownloadBehavior", { behavior: "deny" });
      } catch { /* older/newer Chrome may not support it — clicks still gated by approval */ }
      if (opts.width && opts.height) {
        await b.send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false }, sessionId);
      }
    } catch (e) {
      await b.close();
      throw e;
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
    let msg: {
      id?: number; method?: string; params?: unknown; result?: unknown;
      sessionId?: string;
      error?: { message?: string; code?: number };
    };
    try { msg = JSON.parse(raw) as typeof msg; } catch { return; }
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

  send<T = unknown>(method: string, params: unknown = {}, sessionId?: string): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("browser not connected"));
    }
    const id = ++this.msgId;
    const payload: { id: number; method: string; params: unknown; sessionId?: string } = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  private waitEvent(method: string, timeoutMs = 15_000, predicate?: (p: unknown) => boolean): Promise<unknown> {
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
    const final = await this.evaluate<{ url: string; title: string }>("({url: location.href, title: document.title})");
    // A redirect may land somewhere the entry guard would have refused
    // (e.g. public URL → http://169.254.169.254/). Re-check the final
    // URL and retreat to about:blank rather than leaving the agent
    // sitting on a blocked destination.
    try {
      await assertPublicHttpDestination(final.url);
    } catch {
      await this.send("Page.navigate", { url: "about:blank" }, this.sessionId).catch(() => {});
      throw new Error(`browser.navigate refused: redirect landed on blocked URL ${final.url.slice(0, 120)}`);
    }
    return final;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string; value?: string }; text?: string };
    }>(
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

  /**
   * Click an element resolved from snapshot().elements[].selector via real
   * mouse events. Small local models frequently guess semantic selectors
   * ("#submit", ".login-btn") that don't exist; when the CSS lookup
   * misses, fall back to matching the selector text against element
   * labels (innerText / aria-label / placeholder / value) so a guessed
   * name still lands on the intended control.
   */
  async click(selector: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      let el = document.querySelector(${JSON.stringify(selector)});
      if (!el) {
        const want = ${JSON.stringify(selector)}.replace(/^[#.]/, '').toLowerCase();
        const candidates = document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link]');
        el = [...candidates].find((c) => {
          const label = ((c.innerText || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute('aria-label') || '') + ' ' + (c.getAttribute('placeholder') || '')).toLowerCase();
          return label.includes(want);
        }) || null;
      }
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`click target not found: ${selector}${await this.availableHint()}`);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, this.sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await new Promise((r) => setTimeout(r, 300));
  }

  /** Type text into the currently focused element via real key events. */
  async type(text: string): Promise<void> {
    await this.send("Input.insertText", { text }, this.sessionId);
  }

  /** Focus a field by selector, then type into it. Same label fallback as click(). */
  async fill(selector: string, text: string): Promise<void> {
    const ok = await this.evaluate<boolean>(`(() => {
      let el = document.querySelector(${JSON.stringify(selector)});
      if (!el) {
        const want = ${JSON.stringify(selector)}.replace(/^[#.]/, '').toLowerCase();
        const fields = document.querySelectorAll('input,textarea,select,[contenteditable=true]');
        el = [...fields].find((c) => {
          const label = ((c.innerText || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute('aria-label') || '') + ' ' + (c.getAttribute('placeholder') || '') + ' ' + (c.name || '') + ' ' + (c.id || '')).toLowerCase();
          return label.includes(want);
        }) || null;
      }
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.select) try { el.select(); } catch {}
      return document.activeElement === el;
    })()`);
    if (!ok) throw new Error(`fill target not found or not focusable: ${selector}${await this.availableHint()}`);
    await this.type(text);
  }

  /** Short list of live selectors, appended to not-found errors so the model can self-correct in one retry. */
  private async availableHint(): Promise<string> {
    try {
      const sels = await this.evaluate<string[]>(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.id) { out.push('#' + CSS.escape(el.id)); continue; }
          const t = (el.tagName || '').toLowerCase();
          const label = ((el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 40);
          out.push(label ? t + '["' + label + '"]' : t);
          if (out.length >= 12) break;
        }
        return out;
      })()`);
      return sels.length ? `. Available on page: ${sels.join(", ")}` : "";
    } catch {
      return "";
    }
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

  /**
   * All cookies in the browser context (browser-level CDP call — works
   * across every origin the session visited). Used for explicit session
   * save/restore: Chrome's profile flush is not guaranteed to commit
   * before shutdown, so cookie state is exported/imported as data.
   */
  async getAllCookies(): Promise<Array<Record<string, unknown>>> {
    const res = await this.send<{ cookies: Array<Record<string, unknown>> }>("Storage.getCookies");
    return res.cookies ?? [];
  }

  /** Restore cookies previously exported by getAllCookies(). */
  async setCookies(cookies: Array<Record<string, unknown>>): Promise<void> {
    if (!cookies.length) return;
    const params = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: c.sameSite,
    }));
    await this.send("Storage.setCookies", { cookies: params }).catch(async () => {
      // Fallback for Chrome builds without Storage domain: set per-cookie
      // via the page session's Network domain.
      for (const c of params) {
        await this.send("Network.setCookie", {
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly,
        }, this.sessionId).catch(() => {});
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const proxy = this.egressProxy;
    this.egressProxy = null;
    const proc = this.proc;
    this.proc = null;
    // Shut the proxy down first so no in-flight page request can still
    // egress while Chrome is closing.
    if (proxy) await proxy.close().catch(() => {});
    // Graceful shutdown FIRST: Browser.close lets Chrome flush cookies and
    // the profile store to disk. proc.kill() (TerminateProcess) would
    // discard pending writes — which is exactly what broke session
    // restoration. Fall back to kill if the browser doesn't exit.
    if (proc && !proc.killed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const exited = new Promise<void>((res) => proc.once("exit", () => res()));
        this.send("Browser.close").catch(() => {});
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      } catch { /* fall through to kill */ }
    }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.failAll(new Error("browser closed"));
    const removeProfile = () => {
      // Persistent profiles (LITT_BROWSER_PROFILE / opts.profileDir) are
      // kept — they are the session-restoration store. Temp profiles are
      // always deleted so no credential/page residue survives.
      if (this.persistentProfile) return;
      try { rmSync(this.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    };
    if (proc && !proc.killed) {
      try { proc.kill(); } catch { /* ignore */ }
      // Give Chrome a moment to flush the profile dir, then remove it.
      setTimeout(removeProfile, 500).unref();
    } else {
      removeProfile();
    }
  }
}
