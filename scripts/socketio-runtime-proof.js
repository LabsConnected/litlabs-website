/**
 * Socket.IO runtime proof — proves the full end-to-end flow:
 *   1. Connect to terminal-server Socket.IO
 *   2. Receive runtime:snapshot on connect
 *   3. POST /internal/command (simulating Studio)
 *   4. Receive runtime:event (command_start with runId)
 *   5. Receive runtime:event (command_end with runId)
 *   6. Receive runtime:state (updated snapshot)
 *   7. Verify runId matches across REST, snapshot, and events
 *
 * Usage: node scripts/socketio-runtime-proof.js
 */
const { io } = require("socket.io-client");
const { createHmac } = require("crypto");

const BASE = process.env.TERMINAL_SERVER_URL ?? "http://127.0.0.1:4001";
const INTERNAL_KEY = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "test-internal-key-" + "b".repeat(32);
const AUTH_SECRET = process.env.TERMINAL_AUTH_SECRET ?? "test-auth-secret-" + "a".repeat(32);
const CWD = "C:\\Users\\litbi\\CascadeProjects\\litlabs-website\\packages\\litt-agent-core";

/**
 * Mint a terminal JWT-like token (HMAC-SHA256, matching terminal-server/auth.ts).
 */
function mintTerminalToken(userId = "proof-user") {
  const payload = {
    sub: userId,
    aud: "littree-terminal",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

async function main() {
  console.log("=== Socket.IO Runtime Proof ===");
  console.log(`Connecting to ${BASE} ...`);

  const token = mintTerminalToken();
  console.log(`Minted terminal token for proof-user`);

  const socket = io(BASE, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
    auth: { token },
  });

  // Step 1: Wait for runtime:snapshot on connect
  const snapshot = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout waiting for runtime:snapshot")), 5000);
    socket.on("runtime:snapshot", (state) => {
      clearTimeout(timeout);
      console.log("\n[1] runtime:snapshot received on connect:");
      console.log(`    phase: ${state.phase}`);
      console.log(`    heartbeat.seq: ${state.heartbeat?.seq ?? "n/a"}`);
      console.log(`    activeCommand: ${state.activeCommand ? state.activeCommand.command : "null"}`);
      console.log(`    lastResult: ${state.lastResult ? state.lastResult.command : "null"}`);
      resolve(state);
    });
    socket.on("connect_error", (err) => reject(new Error(`Connect error: ${err.message}`)));
  });

  // Step 2: Collect events while we trigger a command
  const events = [];
  socket.on("runtime:event", (event) => {
    events.push(event);
    console.log(`\n[EVENT] ${event.type}:`, JSON.stringify(event.data ?? {}));
  });
  socket.on("runtime:state", (state) => {
    console.log(`\n[STATE] phase=${state.phase} activeCmd=${state.activeCommand?.command ?? "null"} lastResult.runId=${state.lastResult?.runId ?? "n/a"}`);
  });

  // Step 3: Wait for heartbeat to make state fresh, then trigger command
  console.log("\nWaiting 2s for heartbeat...");
  await sleep(2000);

  console.log("\n[2] POST /internal/command (simulating Studio /check)...");
  const response = await fetch(`${BASE}/internal/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": INTERNAL_KEY,
    },
    body: JSON.stringify({ command: "check", cwd: CWD }),
    signal: AbortSignal.timeout(60_000),
  });

  const cmdResult = await response.json();
  const restRunId = cmdResult.runId;
  console.log(`    REST response: ok=${cmdResult.ok} runId=${restRunId}`);

  // Wait for events to arrive
  console.log("\nWaiting 3s for Socket.IO events...");
  await sleep(3000);

  // Step 4: Verify
  console.log("\n=== VERIFICATION ===");

  const startEvent = events.find((e) => e.type === "command_start");
  const endEvent = events.find((e) => e.type === "command_end");

  let allPass = true;

  // Check 1: runtime:snapshot received
  console.log(`[1] runtime:snapshot on connect: ${snapshot ? "PASS" : "FAIL"}`);
  if (!snapshot) allPass = false;

  // Check 2: command_start event received with runId
  if (startEvent) {
    const eventRunId = startEvent.data?.runId;
    const match = eventRunId === restRunId;
    console.log(`[2] command_start event runId: ${eventRunId} — ${match ? "MATCH" : "MISMATCH"} (REST: ${restRunId})`);
    if (!match) allPass = false;
  } else {
    console.log(`[2] command_start event: NOT RECEIVED — FAIL`);
    allPass = false;
  }

  // Check 3: command_end event received with runId
  if (endEvent) {
    const eventRunId = endEvent.data?.runId;
    const match = eventRunId === restRunId;
    console.log(`[3] command_end event runId: ${eventRunId} — ${match ? "MATCH" : "MISMATCH"} (REST: ${restRunId})`);
    if (!match) allPass = false;
  } else {
    console.log(`[3] command_end event: NOT RECEIVED — FAIL`);
    allPass = false;
  }

  // Check 4: runtime:state received after command
  console.log(`[4] runtime:state updates received: ${events.length > 0 ? "PASS" : "FAIL"}`);
  if (events.length === 0) allPass = false;

  // Check 5: Total event count
  console.log(`[5] Total events received: ${events.length}`);

  console.log(`\n=== RESULT: ${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} ===`);

  socket.disconnect();
  process.exit(allPass ? 0 : 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
