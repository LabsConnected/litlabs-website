/**
 * OS-2D.2 Disconnect/Reconnect test — proves Socket.IO reconnects
 * and restores state from snapshot after terminal-server restart.
 */
const { chromium } = require("playwright");
const { execSync, exec } = require("child_process");
const fs = require("fs");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("=== Disconnect/Reconnect Test ===\n");

  // Navigate and wait for connection
  await page.goto("http://localhost:3000/runtime-test", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(8000);

  let state = await page.evaluate(() => ({
    connected: document.body.innerText.includes("Connected:") && document.body.innerText.includes("YES"),
    freshness: document.body.innerText.match(/Freshness:\s*(\S+)/)?.[1] ?? "n/a",
  }));
  console.log(`[1] Before disconnect: connected=${state.connected} freshness=${state.freshness}`);

  // Kill terminal-server
  try {
    const output = execSync('netstat -ano | findstr :4001 | findstr LISTENING').toString().trim();
    const pid = output.split(/\s+/).pop();
    console.log(`[2] Killing terminal-server PID: ${pid}`);
    execSync(`taskkill /PID ${pid} /F`);
  } catch (e) {
    console.log(`[2] Could not kill terminal-server: ${e.message}`);
  }

  // Wait for disconnect to be detected
  await page.waitForTimeout(3000);
  state = await page.evaluate(() => ({
    connected: document.body.innerText.includes("Connected:") && document.body.innerText.includes("YES"),
    freshness: document.body.innerText.match(/Freshness:\s*(\S+)/)?.[1] ?? "n/a",
  }));
  console.log(`[3] After kill: connected=${state.connected} freshness=${state.freshness}`);

  // Restart terminal-server using the batch wrapper (handles env vars correctly on Windows)
  console.log("[4] Restarting terminal-server...");
  const batchPath = process.env.TEMP + "\\start-terminal-server.bat";
  const child = exec(`cmd /c "${batchPath}"`, {
    windowsHide: true,
  });

  // Wait for restart and reconnection
  await page.waitForTimeout(20000);
  state = await page.evaluate(() => ({
    connected: document.body.innerText.includes("Connected:") && document.body.innerText.includes("YES"),
    freshness: document.body.innerText.match(/Freshness:\s*(\S+)/)?.[1] ?? "n/a",
    phase: document.body.innerText.match(/Phase:\s*(\S+)/)?.[1] ?? "n/a",
    heartbeatSeq: document.body.innerText.match(/Heartbeat seq:\s*(\S+)/)?.[1] ?? "n/a",
  }));
  console.log(`[5] After restart: connected=${state.connected} freshness=${state.freshness} phase=${state.phase} hb=${state.heartbeatSeq}`);

  const reconnectPass = state.connected && state.freshness === "fresh";
  console.log(`\n=== RECONNECT RESULT: ${reconnectPass ? "PASS" : "FAIL"} ===`);
  console.log(`  Socket.IO reconnected: ${state.connected ? "YES" : "NO"}`);
  console.log(`  Freshness restored: ${state.freshness === "fresh" ? "YES" : "NO"}`);
  console.log(`  Snapshot restored: ${state.phase !== "n/a" ? `YES (phase=${state.phase})` : "NO"}`);

  await browser.close();
  child.kill();
  process.exit(reconnectPass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
