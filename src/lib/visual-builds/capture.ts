import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import WebSocket from "ws";
import type { PreviewViewport } from "./types";

export interface BrowserCaptureInput {
  url: string;
  viewport: PreviewViewport;
  width: number;
  height: number;
  timeoutMs?: number;
}

export interface BrowserCaptureResult {
  viewport: PreviewViewport;
  width: number;
  height: number;
  screenshot: Buffer;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  horizontalOverflow: boolean;
  documentWidth: number | null;
  viewportWidth: number | null;
  brokenImages: number;
  missingFonts: number;
  layoutShifts: Array<{ value: number; hadRecentInput: boolean }>;
}

function resolveBrowserExecutable(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to allocate a free port")));
      }
    });
  });
}

function waitForProcessExit(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("close", () => resolve());
  });
}

function createCdpClient(wsUrl: string) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Array<(params: unknown) => void>>();
  let nextId = 1;

  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });

  socket.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    const message = JSON.parse(text) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown;
    };

    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message || "CDP command failed"));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      const handlers = listeners.get(message.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.params);
        }
      }
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  const on = (event: string, handler: (params: unknown) => void) => {
    const handlers = listeners.get(event) ?? [];
    handlers.push(handler);
    listeners.set(event, handlers);
  };

  const close = async () => {
    socket.close();
    await new Promise((resolve) => socket.once("close", resolve));
  };

  return { ready, send, on, close };
}

async function waitForPageTarget(port: number, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (response?.ok) {
      const targets = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for Chrome debugger target");
}

function resolveLayoutShiftValue(params: unknown): Array<{ value: number; hadRecentInput: boolean }> {
  const entries = params && typeof params === "object" && "value" in params ? params : null;
  if (!entries) return [];
  const value = (entries as { value?: unknown }).value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { value?: unknown; hadRecentInput?: unknown };
    return [{ value: typeof record.value === "number" ? record.value : 0, hadRecentInput: record.hadRecentInput === true }];
  });
}

export async function capturePreviewWithChrome(input: BrowserCaptureInput): Promise<BrowserCaptureResult> {
  const browser = resolveBrowserExecutable();
  if (!browser) {
    throw new Error("Chrome or Edge executable not found for preview capture");
  }

  const port = await getFreePort();
  const userDataDir = mkdtempSync(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "littree-chrome-"));
  const proc = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    input.url,
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  const timeoutMs = input.timeoutMs ?? 45_000;

  try {
    const wsUrl = await waitForPageTarget(port, timeoutMs);
    const cdp = createCdpClient(wsUrl);
    await cdp.ready;

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    let layoutShifts: Array<{ value: number; hadRecentInput: boolean }> = [];

    cdp.on("Runtime.consoleAPICalled", (params) => {
      const payload = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      if (payload.type !== "error") return;
      const text = payload.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") || "Console error";
      consoleErrors.push(text);
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      const payload = params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
      pageErrors.push(payload.exceptionDetails?.exception?.description || payload.exceptionDetails?.text || "Page error");
    });
    cdp.on("Network.loadingFailed", (params) => {
      const payload = params as { requestId?: string; type?: string; errorText?: string; blockedReason?: string };
      failedRequests.push([payload.type, payload.errorText, payload.blockedReason].filter(Boolean).join(": "));
    });
    cdp.on("Performance.metrics", (params) => {
      layoutShifts = resolveLayoutShiftValue(params);
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });
    await cdp.send("Runtime.evaluate", {
      expression:
        "window.__littreeLayoutShifts = []; new PerformanceObserver((list) => { window.__littreeLayoutShifts.push(...list.getEntries().map((entry) => ({ value: entry.value, hadRecentInput: entry.hadRecentInput }))); }).observe({ type: 'layout-shift', buffered: true });",
      awaitPromise: false,
      returnByValue: false,
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: input.width,
      height: input.height,
      deviceScaleFactor: 1,
      mobile: input.viewport !== "desktop",
    });
    await cdp.send("Page.navigate", { url: input.url });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Preview capture timed out after ${timeoutMs}ms`)), timeoutMs);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      cdp.on("Page.loadEventFired", done);
      cdp.on("Page.lifecycleEvent", (params) => {
        const payload = params as { name?: string };
        if (payload.name === "networkIdle") done();
      });
      cdp.on("Page.javascriptDialogOpening", done);
    });

    const metrics = (await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const body = document.body;
        const brokenImages = Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).length;
        const fontStatus = document.fonts ? document.fonts.status : 'loaded';
        return {
          horizontalOverflow: Math.max(root.scrollWidth, body ? body.scrollWidth : 0) > window.innerWidth + 1,
          documentWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
          viewportWidth: window.innerWidth,
          brokenImages,
          missingFonts: fontStatus === 'loaded' ? 0 : 1,
          layoutShifts: window.__littreeLayoutShifts || [],
        };
      })()`,
      returnByValue: true,
    })) as { result?: { value?: Record<string, unknown> } };

    const screenshot = (await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
    })) as { data?: string };

    const payload = metrics.result?.value ?? {};
    await cdp.close();

    return {
      viewport: input.viewport,
      width: input.width,
      height: input.height,
      screenshot: Buffer.from(screenshot.data ?? "", "base64"),
      consoleErrors,
      pageErrors,
      failedRequests,
      horizontalOverflow: payload.horizontalOverflow === true,
      documentWidth: typeof payload.documentWidth === "number" ? payload.documentWidth : null,
      viewportWidth: typeof payload.viewportWidth === "number" ? payload.viewportWidth : null,
      brokenImages: typeof payload.brokenImages === "number" ? payload.brokenImages : 0,
      missingFonts: typeof payload.missingFonts === "number" ? payload.missingFonts : 0,
      layoutShifts: Array.isArray(payload.layoutShifts) ? payload.layoutShifts as Array<{ value: number; hadRecentInput: boolean }> : layoutShifts,
    };
  } finally {
    proc.kill("SIGKILL");
    await waitForProcessExit(proc).catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
