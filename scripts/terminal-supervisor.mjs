#!/usr/bin/env node
/**
 * terminal-supervisor.mjs — bounded-restart supervisor for the LiTTree
 * terminal-server. Cross-platform (Linux/macOS/Windows), stdlib only.
 *
 * Why this exists: the terminal-server previously crash-looped when the
 * node-pty native binding failed to load at module scope — the launcher
 * (a .cmd loop on Windows, an ad-hoc retry elsewhere) restarted it
 * forever, produced no diagnostics, and took the workspace file
 * transport down with it. This supervisor gives every environment the
 * same contract:
 *
 *   - Bounded restarts: at most SUPERVISOR_MAX_RESTARTS child exits
 *     inside SUPERVISOR_WINDOW_MS, then the supervisor exits nonzero
 *     (crash-loop detected — a human or the platform must intervene).
 *   - Exponential backoff between restarts (SUPERVISOR_BACKOFF_MS,
 *     doubling to a 60s cap).
 *   - Health gate: after each start, polls SUPERVISOR_HEALTH_URL until
 *     HTTP 200 or SUPERVISOR_HEALTH_TIMEOUT_MS; a child that exits
 *     before becoming healthy counts as a failed start.
 *   - Crash diagnostics: on every exit, logs the exit code/signal and
 *     the last SUPERVISOR_TAIL_LINES of child output.
 *   - Clean shutdown: SIGINT/SIGTERM kills the child and exits 0.
 *
 * Usage:
 *   node scripts/terminal-supervisor.mjs -- <command> [args...]
 *   node scripts/terminal-supervisor.mjs -- node terminal-server/dist/server.js
 *   node scripts/terminal-supervisor.mjs -- pnpm terminal:dev
 *
 * Env:
 *   SUPERVISOR_MAX_RESTARTS        (default 5)
 *   SUPERVISOR_WINDOW_MS           (default 600000 — 10 min)
 *   SUPERVISOR_BACKOFF_MS          (default 2000, doubles to 60s cap)
 *   SUPERVISOR_HEALTH_URL          (default http://127.0.0.1:${TERMINAL_SERVER_PORT||4001}/health)
 *   SUPERVISOR_HEALTH_TIMEOUT_MS   (default 60000)
 *   SUPERVISOR_HEALTH_POLL_MS      (default 2000)
 *   SUPERVISOR_TAIL_LINES          (default 40)
 *   SUPERVISOR_LOG                 (optional file to also append child output to)
 *   SUPERVISOR_KILL_GRACE_MS       (default 5000 — SIGKILL after this on Windows/POSIX)
 */

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const env = process.env;
const MAX_RESTARTS = int(env.SUPERVISOR_MAX_RESTARTS, 5);
const WINDOW_MS = int(env.SUPERVISOR_WINDOW_MS, 10 * 60_000);
const BACKOFF_MS = int(env.SUPERVISOR_BACKOFF_MS, 2_000);
const BACKOFF_CAP_MS = 60_000;
const HEALTH_URL =
  env.SUPERVISOR_HEALTH_URL ??
  `http://127.0.0.1:${env.TERMINAL_SERVER_PORT || 4001}/health`;
const HEALTH_TIMEOUT_MS = int(env.SUPERVISOR_HEALTH_TIMEOUT_MS, 60_000);
const HEALTH_POLL_MS = int(env.SUPERVISOR_HEALTH_POLL_MS, 2_000);
const TAIL_LINES = int(env.SUPERVISOR_TAIL_LINES, 40);
const LOG_FILE = env.SUPERVISOR_LOG ?? null;
const KILL_GRACE_MS = int(env.SUPERVISOR_KILL_GRACE_MS, 5_000);

function int(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function ts() {
  return new Date().toISOString();
}

function log(...args) {
  const line = `[supervisor ${ts()}] ${args.join(" ")}`;
  console.log(line);
  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, line + "\n");
    } catch {
      // logging must never kill the supervisor
    }
  }
}

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const command = sep >= 0 ? argv.slice(sep + 1) : argv;
if (command.length === 0) {
  console.error("usage: node scripts/terminal-supervisor.mjs -- <command> [args...]");
  process.exit(2);
}

// Ring buffer of recent child output for crash diagnostics.
const tail = [];
function tailPush(chunk) {
  for (const line of String(chunk).split("\n")) {
    if (line.length === 0) continue;
    tail.push(line);
    if (tail.length > TAIL_LINES) tail.shift();
  }
}

let child = null;
let shuttingDown = false;
let starts = 0;
const exitTimes = []; // timestamps of child exits (for the restart window)

function writeChildOutput(chunk) {
  process.stdout.write(chunk);
  tailPush(chunk);
  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, chunk);
    } catch {
      // ignore
    }
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!child || child.exitCode !== null || shuttingDown) return false;
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

function killChild(signal) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // already gone
  }
}

function pruneWindow() {
  const cutoff = Date.now() - WINDOW_MS;
  while (exitTimes.length && exitTimes[0] < cutoff) exitTimes.shift();
}

async function run() {
  let backoff = BACKOFF_MS;

  for (;;) {
    if (shuttingDown) return 0;

    starts += 1;
    const startNo = starts;
    log(`start #${startNo}: ${command.map((a) => JSON.stringify(a)).join(" ")}`);

    child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: false,
      windowsHide: true,
    });
    const thisChild = child;
    child.stdout.on("data", writeChildOutput);
    child.stderr.on("data", writeChildOutput);

    const exited = new Promise((resolve) => {
      thisChild.once("exit", (code, signal) => resolve({ code, signal }));
    });
    thisChild.once("error", (err) => {
      log(`spawn error: ${err.message}`);
    });

    // Wait until the child exits OR the health gate passes.
    const healthy = await Promise.race([
      exited.then(() => "exited"),
      waitForHealth(HEALTH_TIMEOUT_MS).then((ok) => (ok ? "healthy" : "unhealthy")),
    ]);

    if (healthy === "healthy") {
      log(`start #${startNo} healthy at ${HEALTH_URL}`);
      backoff = BACKOFF_MS; // a healthy start resets backoff
      await exited; // then ride it until it exits
    } else if (healthy === "unhealthy") {
      log(`start #${startNo} did not pass health within ${HEALTH_TIMEOUT_MS}ms — killing`);
      killChild("SIGTERM");
      await Promise.race([
        exited,
        new Promise((r) => setTimeout(r, KILL_GRACE_MS)),
      ]);
      killChild("SIGKILL");
      await exited;
    }

    const { code, signal } = await exited;
    if (shuttingDown) return 0;

    exitTimes.push(Date.now());
    pruneWindow();
    const restartsLeft = Math.max(0, MAX_RESTARTS - exitTimes.length);
    log(
      `child exited (code=${code ?? "null"} signal=${signal ?? "null"}) — ` +
        `${exitTimes.length}/${MAX_RESTARTS} exits within ${Math.round(WINDOW_MS / 60000)}min window`,
    );
    if (tail.length > 0) {
      log(`--- last ${tail.length} output lines ---`);
      for (const line of tail) log(`  ${line}`);
      log(`--- end tail ---`);
      tail.length = 0;
    }

    if (exitTimes.length >= MAX_RESTARTS) {
      log(
        `restart budget exhausted (${MAX_RESTARTS} exits inside ${Math.round(WINDOW_MS / 60000)}min) — ` +
          `crash-loop detected, giving up. Fix the underlying failure before relaunching.`,
      );
      return 1;
    }

    log(`restarting in ${Math.round(backoff / 1000)}s (${restartsLeft} restarts left in window)`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal} — stopping child and exiting`);
  killChild("SIGTERM");
  setTimeout(() => {
    killChild("SIGKILL");
    process.exit(0);
  }, KILL_GRACE_MS).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    log(`supervisor fatal: ${err?.stack ?? err}`);
    process.exit(1);
  });
