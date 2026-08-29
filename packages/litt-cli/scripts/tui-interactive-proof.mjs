#!/usr/bin/env node
/**
 * TUI INTERACTIVE PROOF — drives the REAL `litt` Ink cockpit through a
 * real PTY (node-pty/ConPTY) and verifies scroll behavior with REAL key
 * sequences:
 *
 *   PgUp       \x1b[5~     (page up through history)
 *   PgDn       \x1b[6~     (page down toward live)
 *   Ctrl+End   \x1b[1;5F   (return to live / auto-follow)
 *
 * Also proves a SIGNED-OUT LOCAL TOOL MISSION runs from the TUI: the
 * `/local <command>` machine lane executes without auth, no model key,
 * no remote contact.
 *
 * Output: prints PASS/FAIL per assertion and dumps screen snapshots to
 * tui-proof-evidence.txt in the CWD. Exit code 0 = all proofs passed.
 *
 * Usage (from packages/litt-cli):
 *   node scripts/tui-interactive-proof.mjs
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");

// node-pty is installed (physically) under terminal-server's node_modules.
const req = createRequire(pathToFileURL(path.join(repoRoot, "terminal-server", "package.json")));
const pty = req("node-pty");

const COLS = 120;
const ROWS = 30;
const TIMEOUT_MS = 75_000;

// ─── Tiny ANSI screen emulator (enough for Ink renders) ──────────────
class Screen {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
    this.r = 0;
    this.c = 0;
  }
  /** Feed raw bytes; maintain cursor + grid. */
  feed(chunk) {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\x1b") {
        const next = s[i + 1];
        if (next === "[") {
          // CSI — read until final byte
          let j = i + 2;
          while (j < s.length && !/[0-9A-Za-z@`]/.test(s[j])) j++;
          const body = s.slice(i + 2, j);
          const final = s[j] ?? "";
          this.csi(body, final);
          i = j >= s.length ? s.length - 1 : j;
        } else if (next === "]") {
          // OSC — consume until BEL or ST
          let j = i + 2;
          while (j < s.length && s[j] !== "\x07") {
            if (s[j] === "\x1b" && s[j + 1] === "\\") { j += 2; break; }
            j++;
          }
          i = Math.min(j, s.length - 1);
        } else if (next === "(" || next === ")") {
          i++; // charset select
        } else if (next === "7" || next === "8" || next === "M" || next === "D" || next === "E" || next === "c") {
          i++; // ignore save/restore/RI/IND/NEL/RIS
        } else {
          i++; // lone ESC — ignore
        }
        continue;
      }
      if (ch === "\r") { this.c = 0; continue; }
      if (ch === "\n") { this.r = Math.min(this.rows - 1, this.r + 1); continue; }
      if (ch === "\b") { this.c = Math.max(0, this.c - 1); continue; }
      if (ch === "\t") { this.c = Math.min(this.cols - 1, this.c + 8 - (this.c % 8)); continue; }
      if (ch < " ") continue;
      if (this.r < this.rows && this.c < this.cols) {
        this.grid[this.r][this.c] = ch;
      }
      this.c = Math.min(this.cols - 1, this.c + 1);
    }
  }
  csi(body, final) {
    const params = body.replace(/\?/g, "").split(";").map((p) => Number.parseInt(p, 10) || 0);
    const n = params[0] || 1;
    switch (final) {
      case "H": case "f": {
        this.r = Math.min(this.rows - 1, (params[0] || 1) - 1);
        this.c = Math.min(this.cols - 1, (params[1] || 1) - 1);
        break;
      }
      case "A": this.r = Math.max(0, this.r - n); break;
      case "B": this.r = Math.min(this.rows - 1, this.r + n); break;
      case "C": this.c = Math.min(this.cols - 1, this.c + n); break;
      case "D": this.c = Math.max(0, this.c - n); break;
      case "J":
        if ((params[0] || 0) === 2) {
          for (let i = 0; i < this.rows; i++) this.grid[i].fill(" ");
        }
        break;
      case "K":
        if ((params[0] || 0) === 2) this.grid[this.r].fill(" ");
        else if ((params[0] || 0) === 1) this.grid[this.r].fill(" ", 0, this.c + 1);
        else for (let c = this.c; c < this.cols; c++) this.grid[this.r][c] = " ";
        break;
      default: break; // SGR 'm', modes 'h'/'l', etc — no-op
    }
  }
  /** Plain-text rendition of the whole screen. */
  text() {
    return this.grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n");
  }
  rowsText() {
    return this.grid.map((row) => row.join("").replace(/\s+$/, ""));
  }
}

// ─── Harness state ───────────────────────────────────────────────────
const screen = new Screen(COLS, ROWS);
let buffer = "";
let evidence = [];
const log = (line) => { evidence.push(line); console.log(line); };
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + TIMEOUT_MS;
async function waitFor(label, predicate, stepMs = 120) {
  while (Date.now() < deadline) {
    if (predicate(screen.text())) return true;
    await sleep(stepMs);
  }
  log(`TIMEOUT waiting for: ${label}`);
  return false;
}

const HASH_RE = /[0-9a-f]{7}/g;
function firstVisibleHash(rows) {
  for (const row of rows) {
    const m = row.match(HASH_RE);
    if (m) return m[0];
  }
  return null;
}
function visibleHashes(rows) {
  return [...new Set(rows.flatMap((r) => r.match(HASH_RE) ?? []))];
}

// ─── Spawn the real TUI ──────────────────────────────────────────────
const env = { ...process.env };
for (const k of [
  "LITT_TERMINAL_URL", "LITT_CLERK_TOKEN", "LITT_CLERK_ISSUER",
  "LITT_CLERK_OAUTH_CLIENT_ID", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
  "GROQ_API_KEY", "LITT_MODE",
]) delete env[k];
env.TERM = "xterm-256color";
env.COLORTERM = "truecolor";

const child = pty.spawn(process.execPath, ["dist/index.js"], {
  name: "xterm-256color",
  cols: COLS,
  rows: ROWS,
  cwd: cliRoot,
  env,
  useConpty: true,
});

let outputTail = "";
child.onData((data) => {
  buffer += data;
  outputTail = (outputTail + data).slice(-64_000);
  screen.feed(data);
});

const killedTimer = setTimeout(() => {
  log("HARNESS TIMEOUT — killing TUI.");
  log("---- SCREEN AT TIMEOUT ----\n" + screen.text() + "\n---------------------------");
  try { child.kill(); } catch {}
  finish(2);
}, TIMEOUT_MS);

async function main() {
  // 1. Boot
  const booted = await waitFor("TUI boot (header + composer)", (t) =>
    /LiTT/i.test(t) && (t.includes("›") || t.includes("Ask LiTT") || t.includes("⚡")),
  );
  check("TUI boots in a real PTY", booted);
  if (!booted) {
    log("RAW OUTPUT TAIL:\n" + outputTail.slice(-4000));
    finish(1);
    return;
  }
  await sleep(1200); // let Ink install raw mode + first render settle
  log("---- BOOT SCREEN ----\n" + screen.text() + "\n---------------------");
  check("Header shows LOCAL execution target", /LOCAL|BYOK/i.test(screen.text()));

  // 2. Signed-out local tool missions — seed MANY small messages so the
  //    transcript overflows the region with per-message fit. This exercises
  //    the anchor-based SCROLL MODEL (PgUp/PgDn page the anchor). A single
  //    giant output would instead hit the documented natural-flow fallback.
  let newestHash = null;
  for (let i = 0; i < 12; i++) {
    child.write(`/local git log --oneline -1`);
    await sleep(250);
    child.write("\r");
    await waitFor(`seed ${i + 1} output visible`, (t) => t.includes("exit 0"), 200);
    if (i === 0) {
      // Newest hash = first hash below the first "exit 0" marker row.
      const rows = screen.rowsText();
      const idx = rows.findIndex((r) => r.includes("exit 0"));
      for (let j = idx; j < rows.length; j++) {
        const m = (rows[j] ?? "").match(HASH_RE);
        if (m) { newestHash = m[0]; break; }
      }
    }
  }
  check("Signed-out local tool missions run from TUI (/local git log)", !!newestHash, `newest=${newestHash}`);
  await sleep(1000);
  const liveFrame = screen.rowsText();
  const liveHashes = visibleHashes(liveFrame);
  check("Newest commit visible at live", liveHashes.includes(newestHash),
    `newest=${newestHash} first6=${JSON.stringify(liveHashes.slice(0, 6))}`);
  log(`live first-visible hash=${firstVisibleHash(liveFrame)}`);

  // 3. PgUp #1 — should scroll UP (away from live)
  child.write("\x1b[5~");
  await sleep(500);
  const up1Frame = screen.rowsText();
  const up1Hashes = visibleHashes(up1Frame);
  const moved1 = JSON.stringify(up1Hashes) !== JSON.stringify(liveHashes)
    && !up1Hashes.includes(newestHash);
  check("PgUp scrolled up (newest no longer visible)", moved1,
    `first6=${JSON.stringify(up1Hashes.slice(0, 6))}`);
  log(`up1 first-visible hash=${firstVisibleHash(up1Frame)}`);

  // 4. PgUp #2 — keeps moving
  child.write("\x1b[5~");
  await sleep(500);
  const up2Frame = screen.rowsText();
  const up2Hashes = visibleHashes(up2Frame);
  const moved2 = JSON.stringify(up2Hashes) !== JSON.stringify(up1Hashes);
  check("Repeated PgUp keeps moving", moved2, `first6=${JSON.stringify(up2Hashes.slice(0, 6))}`);
  const anchorBeforeNew = firstVisibleHash(up2Frame);
  log(`up2 first-visible hash=${anchorBeforeNew}`);

  // 5. New tool output while scrolled — must NOT yank the viewport to live
  child.write("/local litt --version");
  await sleep(250);
  child.write("\r");
  await waitFor("extra output visible", (t) => (t.match(/exit 0/g) ?? []).length >= 13, 400);
  const noYankFrame = screen.rowsText();
  const anchorAfterNew = firstVisibleHash(noYankFrame);
  const stillScrolled = anchorAfterNew === anchorBeforeNew && !visibleHashes(noYankFrame).includes(newestHash);
  check("New output while scrolled does NOT yank to live", stillScrolled,
    `anchorBefore=${anchorBeforeNew} anchorAfter=${anchorAfterNew}`);
  log(`no-yank first-visible hash=${anchorAfterNew}`);

  // 6. PgDn — moves back toward live
  child.write("\x1b[6~");
  await sleep(500);
  const dn1Frame = screen.rowsText();
  const dn1Hashes = visibleHashes(dn1Frame);
  check("PgDn moves toward live",
    JSON.stringify(dn1Hashes) !== JSON.stringify(visibleHashes(noYankFrame)),
    `first6=${JSON.stringify(dn1Hashes.slice(0, 6))}`);

  // 7. Ctrl+End — return to live (newest visible again)
  child.write("\x1b[1;5F");
  await sleep(600);
  const endFrame = screen.rowsText();
  const endHashes = visibleHashes(endFrame);
  check("Ctrl+End returns to live (newest visible)", endHashes.includes(newestHash),
    `newest=${newestHash} first6=${JSON.stringify(endHashes.slice(0, 6))}`);

  log("---- FINAL SCREEN ----\n" + screen.text() + "\n-----------------------");

  // Clean exit
  child.write("\x03");
  await sleep(700);
  try { child.kill(); } catch {}

  finish(results.every((r) => r.ok) ? 0 : 1);
}

function finish(code) {
  clearTimeout(killedTimer);
  fs.writeFileSync(
    path.join(cliRoot, "tui-proof-evidence.txt"),
    evidence.join("\n") + "\n\n==== RAW TAIL ====\n" + outputTail.slice(-6000),
    "utf8",
  );
  process.exit(code);
}

main().catch((err) => {
  log("HARNESS ERROR: " + (err && err.stack ? err.stack : String(err)));
  finish(2);
});