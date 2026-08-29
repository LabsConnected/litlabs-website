/**
 * Observability blocks visual harness.
 * Renders ThinkingBlock, ToolResultBlock, MissionProgressBlock, SummaryBlock
 * into an ANSI grid emulator at multiple widths — no TTY required.
 *
 * Usage: node scripts/verify-observability-visuals.mjs
 */
import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";
import { ThinkingBlock, ToolResultBlock, MissionProgressBlock, SummaryBlock } from "../dist/ink/observability.js";

const el = React.createElement;

// ─── ANSI grid emulator ────────────────────────────────────────────
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
        if (cmd === "J") { const mode = parseInt(seq || "0", 10); if (mode === 2 || mode === 3) { grid.length = 0; row = 0; col = 0; } }
        else if (cmd === "K") { ensure(row); const mode = parseInt(seq || "0", 10); if (mode === 2 || mode === 0) { grid[row] = grid[row] || []; for (let x = mode === 2 ? 0 : col; x < grid[row].length; x++) grid[row][x] = " "; } }
        else if (cmd === "H" || cmd === "f") { const parts = seq.split(";"); row = Math.max(0, (parseInt(parts[0] || "1", 10) || 1) - 1); col = Math.max(0, (parseInt(parts[1] || "1", 10) || 1) - 1); }
        else if (cmd === "A") { row -= parseInt(seq || "1", 10) || 1; }
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

function makeFakeStdout(columns, rows, captureArr) {
  const stream = new Writable({ write(chunk) { captureArr.push(chunk.toString()); } });
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

async function renderComponent(component, columns) {
  const rawChunks = [];
  const stdout = makeFakeStdout(columns, 20, rawChunks);
  const stdin = makeFakeStdin();
  const { unmount } = render(component, { stdout, stdin, debug: false });
  await new Promise(r => setTimeout(r, 100));
  unmount();
  await new Promise(r => setTimeout(r, 50));
  return emulate(rawChunks.join(""));
}

// ─── Scenarios ─────────────────────────────────────────────────────

const thinkingSteps = [
  { label: "project detected", status: "complete" },
  { label: "execution target: LOCAL", status: "complete" },
  { label: "inspecting controller.ts", status: "active" },
  { label: "preparing typecheck", status: "pending" },
];

const missionSteps = [
  { label: "Typecheck", status: "complete" },
  { label: "Unit tests", status: "complete" },
  { label: "Lint", status: "complete" },
  { label: "Production build", status: "active" },
];

const toolOutput = [
  "No type errors found.",
  "Done in 3.2s.",
];

for (const cols of [120, 80, 55]) {
  console.log(`\n========== THINKING @ ${cols} cols ==========`);
  try {
    const lines = await renderComponent(el(ThinkingBlock, { phase: "ANALYZING", steps: thinkingSteps }), cols);
    for (const line of lines) { const clean = line.replace(/\x1b\[[0-9;]*m/g, ""); if (clean.trim()) console.log(`|  ${clean}`); }
  } catch (e) { console.error(`  ERROR: ${e.message}`); }

  console.log(`\n========== TOOL RESULT @ ${cols} cols ==========`);
  try {
    const lines = await renderComponent(el(ToolResultBlock, { locus: "LOCAL", command: "pnpm typecheck", exitCode: 0, durationMs: 3200, output: toolOutput }), cols);
    for (const line of lines) { const clean = line.replace(/\x1b\[[0-9;]*m/g, ""); if (clean.trim()) console.log(`|  ${clean}`); }
  } catch (e) { console.error(`  ERROR: ${e.message}`); }

  console.log(`\n========== MISSION PROGRESS @ ${cols} cols ==========`);
  try {
    const lines = await renderComponent(el(MissionProgressBlock, { title: "VERIFY PROJECT", steps: missionSteps, elapsedMs: 18400, locus: "LOCAL" }), cols);
    for (const line of lines) { const clean = line.replace(/\x1b\[[0-9;]*m/g, ""); if (clean.trim()) console.log(`|  ${clean}`); }
  } catch (e) { console.error(`  ERROR: ${e.message}`); }

  console.log(`\n========== SUMMARY @ ${cols} cols ==========`);
  try {
    const lines = await renderComponent(el(SummaryBlock, { text: "Typecheck is clean. One routing issue remains in controller.ts.", success: true }), cols);
    for (const line of lines) { const clean = line.replace(/\x1b\[[0-9;]*m/g, ""); if (clean.trim()) console.log(`|  ${clean}`); }
  } catch (e) { console.error(`  ERROR: ${e.message}`); }
}
