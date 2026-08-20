/**
 * Visual verification for the polished overlays (palette, @ picker,
 * /diff, /ship) at 80×24 and 118×36.
 */
import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";
import { CommandPalette, DEFAULT_ACTIONS } from "../dist/ink/command-palette.js";
import { ContextPicker } from "../dist/ink/overlays/context-picker.js";
import { DiffViewer } from "../dist/ink/overlays/diff-viewer.js";
import { ShipFlow } from "../dist/ink/overlays/ship-flow.js";
import { OverlayKeyboardProvider } from "../dist/ink/overlay-manager.js";

const el = React.createElement;

function emulate(buf) {
  const grid = [];
  let row = 0, col = 0;
  let i = 0;
  const ensure = (r) => { while (grid.length <= r) grid.push([]); };
  const put = (ch) => {
    if (ch === "\n") { row += 1; col = 0; return; }
    if (ch === "\r") { col = 0; return; }
    if (row < 0) row = 0;
    if (col < 0) col = 0;
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
        if (cmd === "m" || cmd === "l" || cmd === "h" || cmd === "s" || cmd === "u" || cmd === "g") { i = j; i += 1; continue; }
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
  for (let r = 0; r < grid.length; r++) out.push((grid[r] || []).join("").replace(/ +$/g, ""));
  return out;
}

function makeStdout(columns, rows) {
  let buf = "";
  const out = new Writable({ write(c, _e, cb) { buf += c.toString(); cb(); } });
  out.columns = columns; out.rows = rows; out.isTTY = true;
  return { out, get: () => buf };
}

function fakeStdin() {
  return { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, pause() {}, resume() {},
    addListener() { return this; }, removeListener() { return this; }, on() { return this; }, off() { return this; }, emit() {} };
}

const cwd = process.cwd();
const scenarios = {
  palette: () => el(OverlayKeyboardProvider, { appShortcutHandler: () => {} },
    el(CommandPalette, { actions: DEFAULT_ACTIONS, initialQuery: "ver", onSelect: () => {}, onCancel: () => {} })),
  context: () => el(OverlayKeyboardProvider, { appShortcutHandler: () => {} },
    el(ContextPicker, { cwd, initialQuery: "", onSelect: () => {}, onCancel: () => {} })),
  diff: () => el(OverlayKeyboardProvider, { appShortcutHandler: () => {} },
    el(DiffViewer, {
      cwd, onClose: () => {}, onRevert: () => {}, onOpen: () => {}, onAccept: () => {},
      files: [
        { path: "packages/litt-cli/src/ink/controller.ts", status: "M", additions: 42, deletions: 9 },
        { path: "packages/litt-cli/src/ink/shell/composer.tsx", status: "A", additions: 130, deletions: 0 },
        { path: "packages/litt-cli/src/ink/colors.ts", status: "M", additions: 15, deletions: 12 },
      ],
    })),
  ship: () => el(OverlayKeyboardProvider, { appShortcutHandler: () => {} },
    el(ShipFlow, {
      cwd, project: "litlabs-website", branch: "feat/litt-final-integration", suggestedMessage: "feat(cli): premium shell polish",
      files: [
        { path: "packages/litt-cli/src/ink/controller.ts", status: "M", additions: 42, deletions: 9 },
        { path: "packages/litt-cli/src/ink/shell/composer.tsx", status: "A", additions: 130, deletions: 0 },
      ],
      onVerify: async () => ({
        proven: true, status: "success", checks: [
          { id: "litt-cli", status: "success", exitCode: 0, message: "333 passed" },
          { id: "typecheck", status: "success", exitCode: 0, message: "passed" },
        ], totalDurationMs: 12000, message: "All checks passed", runId: "verify_1", ranChecks: ["litt-cli", "typecheck"], skippedChecks: [],
      }),
      onCommit: async () => ({ ok: true, message: "Committed" }),
      onReview: () => {}, onClose: () => {},
    })),
  shipBlocked: () => el(OverlayKeyboardProvider, { appShortcutHandler: () => {} },
    el(ShipFlow, {
      cwd, project: "litlabs-website", branch: "feat/litt-final-integration", suggestedMessage: "feat(cli): premium shell polish",
      files: [
        { path: "packages/litt-cli/src/ink/controller.ts", status: "M", additions: 42, deletions: 9 },
      ],
      onVerify: async () => ({
        proven: false, status: "failed", checks: [
          { id: "litt-cli", status: "failed", exitCode: 1, message: "1 test failing" },
        ], totalDurationMs: 8000, message: "Verification not proven", runId: "verify_2", ranChecks: ["litt-cli"], skippedChecks: [],
      }),
      onCommit: async () => ({ ok: false, message: "blocked" }),
      onReview: () => {}, onClose: () => {},
    })),
};

const scenario = process.argv[2] ?? "palette";
const build = scenarios[scenario];
if (!build) { console.error(`Unknown: ${scenario} (palette|context|diff|ship|shipBlocked)`); process.exit(1); }

const { out, get } = makeStdout(80, 24);
const { unmount, waitUntilExit } = render(build(), { stdout: out, stdin: fakeStdin() });
await new Promise((r) => setTimeout(r, 600));
unmount();
await new Promise((r) => setTimeout(r, 150));
const lines = emulate(get());
console.log(`===== ${scenario.toUpperCase()} @ 80x24 =====`);
for (const l of lines) console.log("|" + l);
await waitUntilExit();
