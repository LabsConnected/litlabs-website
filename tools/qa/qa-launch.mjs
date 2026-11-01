#!/usr/bin/env node
/**
 * qa-launch.mjs — canonical Playwright MCP launcher for the LiTT QA lane.
 *
 * Cross-platform (Linux/macOS/Windows). All MCP entry points (Codex CLI,
 * Cursor, VS Code) must go through this launcher so production restrictions
 * are enforced in code at every entry point, not just the shell wrapper.
 *
 * Enforcement layers:
 *  1. Target validation: QA_TARGET_URL must be localhost or a Railway preview
 *     (*.up.railway.app). Production hosts are refused outright (fail-closed,
 *     exit 2).
 *  2. Redirect pre-check: the full redirect chain is resolved BEFORE launch;
 *     a final host that is production (or outside the allowlist) refuses launch.
 *  3. Network-layer guard (qa-guard-proxy.mjs, wired via the MCP server's
 *     --proxy-server): every browser request to a production host — initial
 *     navigation, any redirect hop, or an agent's browser_navigate — gets 403.
 *     (Playwright MCP's own --allowed-origins/--blocked-origins flags state
 *     they "do not serve as a security boundary and do not affect redirects",
 *     so they are defense-in-depth only.)
 *
 * Env:
 *   QA_TARGET_URL          required — isolated preview URL or http://127.0.0.1:PORT
 *   QA_ALLOW_EXTRA_ORIGIN  optional — one extra allowed origin, exact match
 *   QA_ARTIFACT_DIR        optional — artifact dir (default ./test-results/qa-mcp)
 *   PLAYWRIGHT_MCP_VERSION optional — pinned MCP version (default 0.0.83)
 *
 * Extra CLI args are forwarded to the MCP server.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MCP_VERSION = process.env.PLAYWRIGHT_MCP_VERSION || "0.0.83";
const TARGET = process.env.QA_TARGET_URL || "";
const EXTRA_ORIGIN = process.env.QA_ALLOW_EXTRA_ORIGIN || "";
const ARTIFACT_DIR =
  process.env.QA_ARTIFACT_DIR || path.join(process.cwd(), "test-results", "qa-mcp");

// Exact-host production denylist. Subdomains NOT listed here stay reachable on
// purpose: clerk.litlabs.net is the Clerk Frontend API required for auth on
// previews. web-production-d3a22.up.railway.app is the Railway domain serving
// the production app service (kept out of the *.up.railway.app preview lane).
const PROD_HOSTS = new Set([
  "litlabs.net",
  "www.litlabs.net",
  "app.litlabs.net",
  "web-production-d3a22.up.railway.app",
]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

const fail = (msg) => {
  console.error(`qa-launch: ERROR: ${msg}`);
  process.exit(2);
};
const warn = (msg) => console.error(`qa-launch: WARN: ${msg}`);
const info = (msg) => console.error(`qa-launch: ${msg}`);

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const originOf = (u) => {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}`;
  } catch {
    return "";
  }
};

/** "ok" | "production" | "not-allowlisted" | "unparseable" */
function targetVerdict(url) {
  const h = hostOf(url);
  if (!h) return "unparseable";
  if (PROD_HOSTS.has(h)) return "production";
  if (LOOPBACK.has(h)) return "ok";
  if (h.endsWith(".up.railway.app")) return "ok";
  if (EXTRA_ORIGIN && originOf(url) === EXTRA_ORIGIN) return "ok";
  return "not-allowlisted";
}

/** GET the URL, abort after headers; resolve redirect location or null. */
function redirectLocation(url, timeoutMs) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https:") ? https : http;
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      const loc = res.headers.location;
      res.resume();
      req.destroy();
      finish(
        res.statusCode >= 300 && res.statusCode < 400 && loc ? loc : null
      );
    });
    req.on("timeout", () => {
      req.destroy();
      finish("UNREACHABLE");
    });
    req.on("error", () => finish("UNREACHABLE"));
  });
}

async function precheckRedirects(url) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const loc = await redirectLocation(current, 20000);
    if (loc === "UNREACHABLE") return { ok: true, unreachable: true };
    if (loc === null) return { ok: true, finalUrl: current };
    current = new URL(loc, current).toString();
    const v = targetVerdict(current);
    if (v !== "ok") return { ok: false, finalUrl: current, reason: v };
  }
  return { ok: false, finalUrl: current, reason: "too-many-redirects" };
}

function startGuardProxy() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const log = fs.openSync(path.join(ARTIFACT_DIR, "guard-proxy.log"), "a");
    const child = spawn(
      process.execPath,
      [path.join(DIR, "qa-guard-proxy.mjs")],
      { stdio: ["ignore", "pipe", log] }
    );
    let out = "";
    const timer = setTimeout(
      () => reject(new Error("guard proxy did not report a port")),
      10000
    );
    child.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/QA_GUARD_PROXY_PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: m[1] });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (c) => {
      clearTimeout(timer);
      reject(new Error(`guard proxy exited with code ${c}`));
    });
  });
}

function chromeExecutable() {
  const cands =
    process.platform === "win32"
      ? [path.join(os.homedir(), ".cache", "ms-playwright", "chrome-win", "chrome.exe")]
      : [
          path.join(os.homedir(), ".cache", "ms-playwright", "chrome-linux64", "chrome"),
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];
  return cands.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function main() {
  if (!TARGET)
    fail(
      "QA_TARGET_URL is not set. Set it to an isolated preview URL (https://<name>.up.railway.app) or http://127.0.0.1:PORT for local."
    );
  const v0 = targetVerdict(TARGET);
  if (v0 === "production") fail(`refusing production target: ${TARGET}`);
  if (v0 === "unparseable") fail(`could not parse QA_TARGET_URL=${TARGET}`);
  if (v0 !== "ok")
    fail(
      `target not in QA allowlist: ${TARGET} (localhost or *.up.railway.app; override with QA_ALLOW_EXTRA_ORIGIN=<origin>)`
    );

  const pre = await precheckRedirects(TARGET);
  if (!pre.ok)
    fail(
      `target redirect chain rejected (${pre.reason}): ${TARGET} -> ${pre.finalUrl}`
    );
  if (pre.unreachable)
    warn(
      `could not pre-resolve ${TARGET} (may be down); continuing — guard proxy still enforced in-session.`
    );

  const { child: proxy, port } = await startGuardProxy().catch((e) => {
    fail(`guard proxy failed to start: ${e.message}`);
  });
  info(`guard proxy on 127.0.0.1:${port} — production origins blocked at network layer.`);

  const mcpArgs = [
    "-y",
    `@playwright/mcp@${MCP_VERSION}`,
    "--browser",
    "chromium",
    "--headless",
    "--isolated",
    "--proxy-server",
    `http://127.0.0.1:${port}`,
    "--blocked-origins",
    [...PROD_HOSTS].map((h) => `https://${h}`).join(";"),
    "--output-dir",
    ARTIFACT_DIR,
    "--console-level",
    "error",
  ];
  const exe = chromeExecutable();
  if (exe) {
    mcpArgs.push("--executable-path", exe);
    info(`using Chrome for Testing at ${exe}`);
  }
  mcpArgs.push(...process.argv.slice(2));

  const useShell = process.platform === "win32";
  const mcp = spawn("npx", mcpArgs, { stdio: "inherit", shell: useShell });
  const killProxy = () => {
    try {
      proxy.kill();
    } catch {
      /* already gone */
    }
  };
  process.on("SIGINT", () => {
    mcp.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    mcp.kill("SIGTERM");
  });
  mcp.on("exit", (code, signal) => {
    killProxy();
    process.exit(code === null ? (signal ? 1 : 0) : code);
  });
  mcp.on("error", (e) => {
    killProxy();
    fail(`failed to launch Playwright MCP: ${e.message}`);
  });
}

main().catch((e) => fail(e.message));
