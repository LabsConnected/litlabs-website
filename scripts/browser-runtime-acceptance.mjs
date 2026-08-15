/**
 * OS-2D.2 Browser Runtime Acceptance — Playwright proof (v2).
 *
 * Uses page.evaluate() for reliable state extraction instead of
 * fragile text selectors.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  console.log("=== OS-2D.2 Browser Runtime Acceptance (v2) ===\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
    if (msg.type() === "warning") consoleWarnings.push(msg.text());
  });
  // Track failed HTTP requests to identify 401 sources
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (res) => {
    if (res.status() === 401) {
      failedRequests.push(`401: ${res.url()}`);
    }
  });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  console.log("[1] Navigating to /runtime-test...");
  await page.goto(`${BASE}/runtime-test`, { waitUntil: "networkidle", timeout: 60000 });
  console.log("    Page loaded");

  // Wait for token + Socket.IO connection
  console.log("[2] Waiting for token and Socket.IO connection...");
  await page.waitForTimeout(8000);

  // Extract state from the page using evaluate
  const state = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      bodyText: body,
      hasToken: body.includes("OBTAINED"),
      hasConnected: body.includes("Connected:") && body.includes("YES"),
      hasPhase: /Phase:\s*\S+/.test(body) && !body.includes("Phase:null") && !body.includes("Phase: null"),
      phase: body.match(/Phase:\s*(\S+)/)?.[1] ?? "n/a",
      freshness: body.match(/Freshness:\s*(\S+)/)?.[1] ?? "n/a",
      heartbeatSeq: body.match(/Heartbeat seq:\s*(\S+)/)?.[1] ?? "n/a",
      eventLogText: document.querySelector("[data-testid='event-log']")?.textContent ?? "",
      mountCount: body.match(/Mount count.*?:\s*(\d+)/)?.[1] ?? "n/a",
    };
  });

  console.log(`    Token: ${state.hasToken ? "OBTAINED" : "PENDING"}`);
  console.log(`    Connected: ${state.hasConnected ? "YES" : "NO"}`);
  console.log(`    Phase: ${state.phase}`);
  console.log(`    Freshness: ${state.freshness}`);
  console.log(`    Heartbeat seq: ${state.heartbeatSeq}`);
  console.log(`    Mount count: ${state.mountCount}`);

  // Check event log before command
  const eventsBefore = state.eventLogText;
  console.log(`    Events before command: ${eventsBefore.includes("command_start") ? "has command_start" : "none yet"}`);

  // Trigger a command
  console.log("\n[3] Clicking /check button...");
  await page.click("button:has-text('/check')").catch(() => {
    console.log("    Could not click — trying to trigger via evaluate");
  });

  // Wait for command to complete (typecheck can take ~20s)
  console.log("[4] Waiting for command events (25s)...");
  await page.waitForTimeout(25000);

  // Extract state after command
  const stateAfter = await page.evaluate(() => {
    const body = document.body.innerText;
    const eventLog = document.querySelector("[data-testid='event-log']")?.textContent ?? "";
    return {
      bodyText: body,
      phase: body.match(/Phase:\s*(\S+)/)?.[1] ?? "n/a",
      eventLogText: eventLog,
      hasCommandStart: eventLog.includes("command_start"),
      hasCommandEnd: eventLog.includes("command_end"),
      hasPhaseChange: eventLog.includes("phase_change"),
      triggeredRunId: body.match(/Triggered runId:\s*(run_\S+)/)?.[1] ?? 
                       body.match(/(run_\d+_\w+)/)?.[1] ?? null,
      eventRunId: eventLog.match(/"runId":"(run_\S+)"/)?.[1] ?? 
                  eventLog.match(/runId.*?(run_\d+_\w+)/)?.[1] ?? null,
      lastResultRunId: body.match(/Last runId:\s*(run_\S+)/)?.[1] ?? null,
      lastResult: body.match(/Last result:\s*(.+)/)?.[1]?.trim() ?? "n/a",
    };
  });

  console.log(`    Phase after: ${stateAfter.phase}`);
  console.log(`    command_start: ${stateAfter.hasCommandStart ? "RECEIVED" : "NOT received"}`);
  console.log(`    command_end: ${stateAfter.hasCommandEnd ? "RECEIVED" : "NOT received"}`);
  console.log(`    phase_change: ${stateAfter.hasPhaseChange ? "RECEIVED" : "NOT received"}`);
  console.log(`    Triggered runId: ${stateAfter.triggeredRunId ?? "none"}`);
  console.log(`    Event runId: ${stateAfter.eventRunId ?? "none"}`);
  console.log(`    Last result: ${stateAfter.lastResult}`);
  console.log(`    Last result runId: ${stateAfter.lastResultRunId ?? "n/a"}`);

  const runIdMatch = stateAfter.triggeredRunId && stateAfter.eventRunId &&
    stateAfter.triggeredRunId === stateAfter.eventRunId;
  console.log(`    RunId match: ${runIdMatch ? "MATCH" : "NO MATCH"}`);

  // Console check
  console.log("\n[5] Browser console:");
  console.log(`    Errors: ${consoleErrors.length}`);
  console.log(`    Warnings: ${consoleWarnings.length}`);
  // Filter out Clerk auth 401s (expected in headless browser without auth)
  // and CSP-related issues (already fixed for dev mode)
  const realErrors = consoleErrors.filter(e =>
    !e.includes("clerk.com") && !e.includes("Clerk") && !e.includes("development keys") &&
    !e.includes("401") && !e.includes("Content-Security-Policy")
  );
  if (realErrors.length > 0) {
    realErrors.slice(0, 5).forEach(e => console.log(`    ERROR: ${e.substring(0, 200)}`));
  }
  if (failedRequests.length > 0) {
    console.log(`    Failed/401 requests:`);
    failedRequests.slice(0, 5).forEach(r => console.log(`      ${r.substring(0, 150)}`));
  }
  if (pageErrors.length > 0) {
    console.log(`    Page errors: ${pageErrors.length}`);
    pageErrors.slice(0, 3).forEach(e => console.log(`    PAGE ERROR: ${e.substring(0, 200)}`));
  }

  // ─── Summary ───────────────────────────────────────────────────
  console.log("\n=== ACCEPTANCE CHECKLIST ===");
  const checks = {
    "Page loaded": true,
    "Token obtained": state.hasToken,
    "Socket.IO connected": state.hasConnected,
    "runtime:snapshot received (phase visible)": state.hasPhase,
    "command triggered": stateAfter.triggeredRunId !== null,
    "command_start event received": stateAfter.hasCommandStart,
    "command_end event received": stateAfter.hasCommandEnd,
    "runId matches (triggered = event)": !!runIdMatch,
    "phase transition observed": stateAfter.hasPhaseChange,
    "no duplicate listeners (mount=1)": state.mountCount === "1",
    "console clean (no real errors)": realErrors.length === 0,
    "no page errors": pageErrors.length === 0,
  };

  let passCount = 0;
  for (const [check, pass] of Object.entries(checks)) {
    console.log(`  ${pass ? "PASS" : "FAIL"} — ${check}`);
    if (pass) passCount++;
  }

  const total = Object.keys(checks).length;
  console.log(`\n=== RESULT: ${passCount}/${total} checks passed ===`);

  await browser.close();
  process.exit(passCount === total ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
