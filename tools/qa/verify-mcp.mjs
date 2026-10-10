#!/usr/bin/env node
/**
 * verify-mcp.mjs — smoke-test the QA Playwright MCP stack end to end.
 *
 * Spawns tools/qa/qa-browser.sh (with QA_TARGET_URL=http://127.0.0.1:1, an
 * allowed-but-empty target) and speaks MCP JSON-RPC over stdio.
 *
 * Ordering is deliberate to rule out false positives: the browser is proven
 * working BEFORE and AFTER the production-block probes, so a blocked result
 * can only mean the guard proxy did its job — never a dead browser being
 * misread as "blocked".
 *
 *   1. initialize + notifications/initialized
 *   2. tools/list — asserts browser_navigate / browser_snapshot exist
 *   3. browser_navigate -> about:blank — MUST SUCCEED (browser works)
 *   4. browser_snapshot — MUST return content
 *   5. browser_navigate -> https://www.litlabs.net/ — MUST FAIL with a
 *      block-indicating error. A *successful* navigation here is a FAIL.
 *   6. browser_navigate -> https://app.litlabs.net/ — MUST FAIL likewise.
 *   7. browser_navigate -> http://127.0.0.1:18999/ (local server that
 *      302-redirects to https://www.litlabs.net/) — MUST FAIL. The MCP
 *      server's own blocklist explicitly does not affect redirects, so a
 *      failure here proves the GUARD PROXY stopped the redirect hop
 *      (expect ERR_TUNNEL_CONNECTION_FAILED from the proxy's 403).
 *   8. browser_navigate -> about:blank — MUST SUCCEED (retried; proves the
 *      browser is still alive and the failures above were host-specific).
 *
 * Exit 0 on PASS, 1 on FAIL. No network target required.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(DIR, "qa-browser.sh");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const child = spawn("bash", [WRAPPER], {
  env: {
    ...process.env,
    QA_TARGET_URL: "http://127.0.0.1:1",
    QA_ARTIFACT_DIR: "/tmp/qa-mcp-verify",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

// Local redirector: 302s straight to production. Used to prove the guard
// proxy (not the MCP server's blocklist, which ignores redirects) stops
// redirect hops.
const redirector = http
  .createServer((req, res) => {
    res.writeHead(302, { location: "https://www.litlabs.net/redirect-probe" });
    res.end();
  })
  .listen(18999, "127.0.0.1");

let nextId = 1;
const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // non-JSON stdout (e.g. npx banners) — ignore
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 90000);
  });
const notify = (method, params = {}) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const callTool = (name, args) => send("tools/call", { name, arguments: args });

/** True only if the tool result actually indicates the request was blocked. */
function isBlockedResult(res) {
  const text = JSON.stringify(res.error || res.result || "");
  return (
    res.error !== undefined ||
    res.result?.isError === true ||
    /403|blocked by qa-guard-proxy|ERR_TUNNEL|ERR_PROXY_CONNECTION_FAILED|net::ERR/i.test(text)
  );
}
/** True only if the tool call genuinely succeeded. */
function isSuccessResult(res) {
  return res.error === undefined && res.result?.isError !== true;
}

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-verify", version: "1.0.0" },
  });
  check("MCP initialize", !!init.result, `server: ${init.result?.serverInfo?.name}@${init.result?.serverInfo?.version}`);
  notify("notifications/initialized");

  const tools = await send("tools/list", {});
  const names = (tools.result?.tools || []).map((t) => t.name);
  check("tools/list returns browser tools", names.includes("browser_navigate") && names.includes("browser_snapshot"), `${names.length} tools`);

  // Prove the browser works BEFORE the block probes.
  const blank1 = await callTool("browser_navigate", { url: "about:blank" });
  check("browser works (about:blank navigate)", isSuccessResult(blank1),
    isSuccessResult(blank1) ? "" : JSON.stringify(blank1).slice(0, 160));
  const snap = await callTool("browser_snapshot", {});
  const snapOk = isSuccessResult(snap) && JSON.stringify(snap.result || "").length > 50;
  check("browser_snapshot returns content", snapOk);

  // Production navigations MUST be blocked — and a *success* here is a FAIL.
  for (const prodUrl of ["https://www.litlabs.net/", "https://app.litlabs.net/"]) {
    const r = await callTool("browser_navigate", { url: prodUrl });
    const blocked = isBlockedResult(r);
    const leaked = isSuccessResult(r);
    check(
      `production blocked: ${prodUrl}`,
      blocked && !leaked,
      leaked
        ? `LEAKED — navigation succeeded: ${JSON.stringify(r.result).slice(0, 120)}`
        : JSON.stringify(r.error || r.result).slice(0, 120)
    );
  }

  // Redirect-hop probe: the MCP blocklist ignores redirects, so only the
  // guard proxy can stop this. Expect ERR_TUNNEL_CONNECTION_FAILED (proxy 403).
  const redir = await callTool("browser_navigate", { url: "http://127.0.0.1:18999/" });
  const redirText = JSON.stringify(redir.error || redir.result || "");
  const redirBlocked =
    isBlockedResult(redir) && /ERR_TUNNEL_CONNECTION_FAILED/i.test(redirText);
  check(
    "redirect hop to production stopped by guard proxy",
    redirBlocked && !isSuccessResult(redir),
    redirText.slice(0, 140)
  );

  // Prove the browser is STILL alive — the failures above were host-specific.
  // A blocked navigation can leave a settling navigation behind, so retry.
  let alive = false;
  let aliveDetail = "";
  for (let i = 0; i < 3 && !alive; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    const b = await callTool("browser_navigate", { url: "about:blank" });
    alive = isSuccessResult(b);
    aliveDetail = alive ? "" : JSON.stringify(b).slice(0, 120);
  }
  check("browser still alive after block probes", alive, aliveDetail);
} catch (err) {
  check("verify-mcp completed without exception", false, err.message);
}

redirector.close();
child.kill("SIGKILL");
const bad = results.filter((r) => !r.ok);
console.log(bad.length === 0 ? "\nVERIFY-MCP: ALL PASS" : `\nVERIFY-MCP: ${bad.length} FAILURES`);
process.exit(bad.length === 0 ? 0 : 1);
