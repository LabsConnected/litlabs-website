/**
 * Header visual verification harness.
 * Renders the REAL Header component into an ANSI grid emulator
 * at multiple terminal widths — no TTY required.
 *
 * Usage: node scripts/verify-header-visuals.mjs
 */
import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";
import { Header } from "../dist/ink/header.js";

const el = React.createElement;

// ─── ANSI grid emulator (same as verify-shell-visuals.mjs) ──────────
function emulate(buf) {
  const grid = [];
  let row = 0, col = 0;
  let i = 0;
  const ensure = (r) => { while (grid.length <= r) grid.push([]); };
  const put = (ch) => {
    if (ch === "\n") { row += 1; col = 0; return; }
    if (ch === "\r") { col = 0; return; }
    if (row < 0) { row = 0; }
    if (col < 0) { col = 0; }
    ensure(row);
    grid[row][col] = ch;
    col += 1;
  };
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === "\x1b" && buf[i + 1] === "[") {
      let j = i + 2;
      let seq = "";
      while (j < buf.length && !"ABCDEFGHJKSTfglmsu".includes(buf[j])) { seq += buf[j]; j++; }
      if (j < buf.length) {
        const cmd = buf[j];
        if (cmd === "m" || cmd === "l" || cmd === "h" || cmd === "s" || cmd === "u" || cmd === "g") {
          i = j; i += 1; continue;
        }
        if (cmd === "J") {
          const mode = parseInt(seq || "0", 10);
          if (mode === 2 || mode === 3) { grid.length = 0; row = 0; col = 0; }
        } else if (cmd === "K") {
          ensure(row);
          const mode = parseInt(seq || "0", 10);
          if (mode === 2 || mode === 0) {
            grid[row] = grid[row] || [];
            for (let x = mode === 2 ? 0 : col; x < grid[row].length; x++) grid[row][x] = " ";
          }
        } else if (cmd === "H" || cmd === "f") {
          const parts = seq.split(";");
          row = Math.max(0, (parseInt(parts[0] || "1", 10) || 1) - 1);
          col = Math.max(0, (parseInt(parts[1] || "1", 10) || 1) - 1);
        } else if (cmd === "A") { row -= parseInt(seq || "1", 10) || 1; }
        else if (cmd === "B") { row += parseInt(seq || "1", 10) || 1; }
        else if (cmd === "C") { col += parseInt(seq || "1", 10) || 1; }
        else if (cmd === "D") { col -= parseInt(seq || "1", 10) || 1; }
        i = j;
      }
      i += 1;
      continue;
    }
    put(ch);
    i += 1;
  }
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    out.push((grid[r] || []).join("").replace(/ +$/g, ""));
  }
  return out;
}

// ─── Fake stdout with dimensions that captures output ──────────────
function makeFakeStdout(columns, rows, captureArr) {
  const stream = new Writable({
    write(chunk) { captureArr.push(chunk.toString()); }
  });
  stream.columns = columns;
  stream.rows = rows;
  stream.isTTY = true;
  stream.on = () => stream;
  stream.write = (chunk) => { captureArr.push(chunk.toString()); return true; };
  stream.removeListener = () => stream;
  return stream;
}

function makeFakeStdin() {
  const stream = new Writable({ write() {} });
  stream.isTTY = true;
  stream.setRawMode = () => stream;
  stream.on = () => stream;
  stream.removeListener = () => stream;
  stream.pause = () => stream;
  stream.resume = () => stream;
  return stream;
}

// ─── Render Header at a given width and return text lines ───────────
async function renderHeader(opts) {
  const { columns, executionTarget, localRuntime, remoteRuntime, signedIn } = opts;
  const rawChunks = [];
  const stdout = makeFakeStdout(columns, 8, rawChunks);
  const stdin = makeFakeStdin();

  const props = {
    project: "litlabs-website",
    projectRoot: "E:\\LiTT\\Worktrees\\main",
    branch: "main",
    brain: "LiTT Auto",
    activeModel: null,
    source: "OpenAI",
    connected: true,
    executionTarget,
    localRuntime: localRuntime ?? "ready",
    remoteRuntime: remoteRuntime ?? "offline",
    mode: "act",
    authEmail: null,
    signedIn: signedIn,
    compact: false,
  };

  const { unmount } = render(el(Header, props), {
    stdout,
    stdin,
    debug: false,
  });

  // Wait for Ink to flush
  await new Promise(r => setTimeout(r, 100));
  unmount();
  await new Promise(r => setTimeout(r, 50));

  // Emulate all raw ANSI chunks
  const allOutput = rawChunks.join("");
  return emulate(allOutput);
}

// ─── Test matrix ────────────────────────────────────────────────────
const scenarios = [
  // Wide desktop, signed in, LOCAL
  { name: "WIDE 120 · LOCAL · signed in", columns: 120, executionTarget: "local", signedIn: true },
  // Wide desktop, signed out, LOCAL
  { name: "WIDE 120 · LOCAL · signed out", columns: 120, executionTarget: "local", signedIn: false },
  // Normal 80, signed in, LOCAL
  { name: "NORMAL 80 · LOCAL · signed in", columns: 80, executionTarget: "local", signedIn: true },
  // Normal 80, signed out, LOCAL
  { name: "NORMAL 80 · LOCAL · signed out", columns: 80, executionTarget: "local", signedIn: false },
  // Narrow 55, signed in, LOCAL
  { name: "NARROW 55 · LOCAL · signed in", columns: 55, executionTarget: "local", signedIn: true },
  // Narrow 55, signed out, LOCAL
  { name: "NARROW 55 · LOCAL · signed out", columns: 55, executionTarget: "local", signedIn: false },
  // Wide, REMOTE connected
  { name: "WIDE 120 · REMOTE · connected", columns: 120, executionTarget: "remote", remoteRuntime: "connected", signedIn: true },
  // Normal, REMOTE connecting
  { name: "NORMAL 80 · REMOTE · connecting", columns: 80, executionTarget: "remote", remoteRuntime: "connecting", signedIn: true },
];

for (const sc of scenarios) {
  console.log(`\n===== ${sc.name} =====`);
  try {
    const lines = await renderHeader(sc);
    for (const line of lines) {
      // Strip ANSI escape codes for readability
      const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
      if (clean.trim()) console.log(`|  ${clean}`);
    }
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
  }
}
