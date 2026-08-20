/**
 * Visual verification harness for the polished LiTT shell.
 * Renders the REAL LiTTShell component into a mini ANSI grid emulator
 * at multiple terminal sizes — no TTY required.
 *
 * Usage: node scripts/_verify-shell.mjs [scenario]
 *   welcome | conversation | busy | done | failed
 */
import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";
import { LiTTShell } from "../dist/ink/shell/shell.js";

const el = React.createElement;

// ─── ANSI grid emulator (cursor moves, erases, plain text) ──────────
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
          // SGR / private-mode / save-restore-cursor — no geometry effect.
          i = j;
          i += 1;
          continue;
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

// ─── Fake stdout with dimensions + raw-mode-capable stdin ──────────
function makeFakeStdin() {
  const listeners = new Map();
  return {
    isTTY: true,
    setRawMode() {},
    setEncoding() {},
    ref() {},
    unref() {},
    pause() {},
    resume() {},
    addListener(ev, fn) { listeners.set(ev, fn); return this; },
    removeListener(ev) { listeners.delete(ev); return this; },
    on(ev, fn) { listeners.set(ev, fn); return this; },
    off(ev) { listeners.delete(ev); return this; },
    emit() {},
    getListeners: () => listeners,
  };
}

function makeStdout(columns, rows) {
  let buf = "";
  const out = new Writable({
    write(chunk, _enc, cb) { buf += chunk.toString(); cb(); },
  });
  out.columns = columns;
  out.rows = rows;
  out.isTTY = true;
  return { out, get: () => buf };
}

// ─── Scenario builder ───────────────────────────────────────────────
const t = Date.now();
const msg = (over) => ({ ...over, ts: t });

function shell(props) {
  const base = {
    messages: [], activityLog: [], holoState: "IDLE", isProcessing: false,
    busySince: null, missionState: null, gitModified: 0, gitUntracked: 0,
    composerValue: "", onComposerChange: () => {}, onSubmit: () => {},
    onNavigateHistory: () => null, onOpenPalette: () => {}, onOpenContext: () => {},
    composerDisabled: false,
    project: "litlabs-website", branch: "feat/litt-final-integration", localRuntime: "ready",
    brain: "LiTT Auto", activeModel: null, mode: "act",
  };
  return el(LiTTShell, { ...base, ...props });
}

const scenarios = {
  welcome: () => shell({}),
  scrolled: () => {
    // 10 turns — enough to overflow the region — scrolled up 2 pages.
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg({ id: `u${i}`, role: "user", content: `Question ${i} about the project state?`, status: "complete" }));
      messages.push(msg({ id: `a${i}`, role: "assistant", content: `Answer ${i}: the working tree is **clean** and the branch is \`main\`. Details below for turn ${i}.`, status: "complete", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna", servedModel: "openai/gpt-5.6-luna", durationMs: 8000 + i }));
    }
    return shell({
      messages,
      activityLog: [
        { id: "e1", ts: t, type: "tool.completed", text: "142 processes scanned", semantic: "success" },
      ],
      transcriptAnchor: 4, // scrolled up — top visible message is index 4
      onTranscriptPageChange: () => {}, onTranscriptAnchorChange: () => {},
      composerValue: "",
      activeModel: "GPT-5.6 Luna",
    });
  },
  conversation: () => shell({
    messages: [
      msg({ id: "u1", role: "user", content: "What's slowing down my PC?", status: "complete" }),
      msg({ id: "a1", role: "assistant", content: "I'm checking the processes using the most CPU and memory.\n\nChrome is using the most memory right now — 1.4 GB across 12 tabs. Closing the background tabs should free most of it.", status: "complete", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna", servedModel: "openai/gpt-5.6-luna", durationMs: 9400 }),
      msg({ id: "u2", role: "user", content: "And the disk?", status: "complete" }),
      msg({ id: "a2", role: "assistant", content: "Disk usage is at 87% — Dropbox and the Windows search index are the top writers. Nothing critical right now.", status: "complete", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna", servedModel: "openai/gpt-5.6-luna", durationMs: 6100 }),
    ],
    activityLog: [
      { id: "e1", ts: t, type: "tool.completed", text: "142 processes scanned", semantic: "success" },
      { id: "e2", ts: t, type: "tool.completed", text: "top memory consumers identified", semantic: "success" },
    ],
    composerValue: "how about the startup apps?",
    activeModel: "GPT-5.6 Luna",
  }),
  busy: () => shell({
    messages: [
      msg({ id: "u1", role: "user", content: "Find the slowest processes", status: "complete" }),
      msg({ id: "a1", role: "assistant", content: "Scanning running processes for CPU and memory usage…", status: "streaming", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna" }),
    ],
    activityLog: [
      { id: "e1", ts: t, type: "tool.started", text: "Inspecting running processes", semantic: "working" },
    ],
    holoState: "RUNNING", isProcessing: true, busySince: t - 24000,
    gitModified: 3, gitUntracked: 1,
    composerDisabled: true,
    activeModel: "GPT-5.6 Luna",
  }),
  done: () => shell({
    messages: [
      msg({ id: "u1", role: "user", content: "Optimize the startup sequence", status: "complete" }),
      msg({ id: "a1", role: "assistant", content: "Disabled three redundant services and deferred the wallpaper loader. Boot time should drop by ~2s.", status: "complete", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna", servedModel: "openai/gpt-5.6-luna", durationMs: 18500 }),
    ],
    missionState: msg({ text: "Optimize the startup sequence", runId: "run_abc", state: "COMPLETE", startedAt: t - 30000, endedAt: t, filesTouched: ["startup.ps1"], commandsExecuted: [], testResults: { passed: 22, failed: 0, total: 22 }, typecheckPassed: true, buildPassed: true, runtimeProven: true }),
    gitModified: 2, gitUntracked: 0,
    activeModel: "GPT-5.6 Luna",
  }),
  failed: () => shell({
    messages: [
      msg({ id: "u1", role: "user", content: "Fix the failing test suite", status: "complete" }),
      msg({ id: "a1", role: "assistant", content: "Agent error: verification failed — 1 test still failing.", status: "error", requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna" }),
    ],
    missionState: msg({ text: "Fix the failing test suite", runId: "run_xyz", state: "FAILED", startedAt: t - 60000, endedAt: t, filesTouched: ["src/foo.ts"], commandsExecuted: [], testResults: { passed: 21, failed: 1, total: 22 }, typecheckPassed: true, buildPassed: null, runtimeProven: false }),
    gitModified: 1, gitUntracked: 2,
    activeModel: "GPT-5.6 Luna",
  }),
};

const scenario = process.argv[2] ?? "welcome";
const sizes = [[118, 36], [80, 24]];

for (const [cols, rows] of sizes) {
  const { out, get } = makeStdout(cols, rows);
  const tree = scenarios[scenario]?.();
  if (!tree) { console.error(`Unknown scenario: ${scenario}`); process.exit(1); }
  const { unmount, waitUntilExit } = render(tree, { stdout: out, stdin: makeFakeStdin() });
  await new Promise((r) => setTimeout(r, 900));
  unmount();
  await new Promise((r) => setTimeout(r, 150));
  const lines = emulate(get());
  console.log(`\n===== ${scenario.toUpperCase()} @ ${cols}x${rows} (${lines.length} rows) =====`);
  for (const l of lines) console.log("|" + l);
  await waitUntilExit();
}
