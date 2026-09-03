/**
 * ANSI-grid regression — proves the LiTT shell renders WITHOUT line
 * collisions across the sizes and content shapes that historically broke
 * (the 100×30 garble: long wrapped tool-result lines overwriting the
 * header, each other, and the footer).
 *
 * Method: the REAL LiTTShell is rendered by REAL Ink into a captured
 * byte stream, which is replayed through an ANSI grid emulator
 * (cursor moves, erases, SGR). Assertions run against the emulated
 * SCREEN — not the component tree — so any cursor-math regression that
 * makes two fragments share a cell fails here:
 *
 *   - width discipline : no row wider than the terminal
 *   - composer intact  : the "›" prompt row survives every scenario
 *   - footer intact    : Plan/Act + repo diff/status in the last rows
 *   - no interleaving  : known collision victims appear CONTIGUOUSLY
 *                        (e.g. "Failed:" must never merge into
 *                        "…(status 200)" garbage like "Failed:bytes)")
 *
 * Matrix (matches the live regression checklist):
 *   sizes    : 100×24, 100×30, 120×30 (+80×24 inside the resize test)
 *   scenarios: long multiline answer, tool-result feed w/ failures,
 *              FAILED summary, DONE summary, dirty repo footer,
 *              resize smaller→larger→smaller
 */

import React from "react";
import { Writable } from "node:stream";
import { render } from "ink";
import { describe, it, expect } from "vitest";
import { LiTTShell } from "../ink/shell/shell.js";
import type { LiTTShellProps } from "../ink/shell/shell.js";
import type { ActivityEntry, ChatMessage, MissionState } from "../ink/cockpit-store.js";

// ─── ANSI grid emulator (cursor moves, erases, plain text) ──────────

/** The raw parameter text of the CSI sequence starting at i, ending at j. */
function seqOf(buf: string, i: number, j: number): string {
  return buf.slice(i + 2, j);
}

function emulate(buf: string): string[] {
  const grid: string[][] = [];
  let row = 0;
  let col = 0;
  let i = 0;
  const ensure = (r: number) => {
    while (grid.length <= r) grid.push([]);
  };
  const put = (ch: string) => {
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
    if (ch === "\x1b") {
      // Non-CSI escape (OSC, ESC 7, charset…) — no grid geometry.
      if (buf[i + 1] !== "[") { i += 2; continue; }
      // CSI: param bytes 0x30-0x3F, intermediate bytes 0x20-0x2F,
      // then ONE final byte 0x40-0x7E. This covers private modes
      // (?25h cursor show, ?2026l synchronized output), SGR colors,
      // and anything else Ink/chalk emit — unknown finals are ignored.
      let j = i + 2;
      while (j < buf.length && /[\x20-\x3f]/.test(buf[j])) j++;
      if (j >= buf.length) break;
      const cmd = buf[j];
      if (cmd === "A") {
        row -= parseInt(seqOf(buf, i, j) || "1", 10) || 1;
      } else if (cmd === "B") {
        row += parseInt(seqOf(buf, i, j) || "1", 10) || 1;
      } else if (cmd === "C") {
        col += parseInt(seqOf(buf, i, j) || "1", 10) || 1;
      } else if (cmd === "D") {
        col -= parseInt(seqOf(buf, i, j) || "1", 10) || 1;
      } else if (cmd === "H" || cmd === "f") {
        const parts = seqOf(buf, i, j).split(";");
        row = Math.max(0, (parseInt(parts[0] || "1", 10) || 1) - 1);
        col = Math.max(0, (parseInt(parts[1] || "1", 10) || 1) - 1);
      } else if (cmd === "J") {
        const mode = parseInt(seqOf(buf, i, j) || "0", 10);
        if (mode === 2 || mode === 3) { grid.length = 0; row = 0; col = 0; }
      } else if (cmd === "K") {
        if (row < 0) row = 0;
        ensure(row);
        const mode = parseInt(seqOf(buf, i, j) || "0", 10);
        if (mode === 2 || mode === 0) {
          for (let x = mode === 2 ? 0 : col; x < grid[row].length; x++) grid[row][x] = " ";
        }
      }
      // m/h/l/s/u/g/n/X/@/q/… — no geometry effect.
      i = j + 1;
      continue;
    }
    put(ch);
    i += 1;
  }
  return grid.map((r) => (r || []).join("").replace(/ +$/g, ""));
}

// ─── Harness: fake stdin/stdout with real dimensions + resize ───────

function makeStdin() {
  const l = new Map<string, () => void>();
  return {
    isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {},
    pause() {}, resume() {},
    addListener(e: string, f: () => void) { l.set(e, f); return this; },
    removeListener(e: string) { l.delete(e); return this; },
    on(e: string, f: () => void) { l.set(e, f); return this; },
    off(e: string) { l.delete(e); return this; },
    emit() {},
  };
}

interface FakeStdout extends Writable {
  columns: number;
  rows: number;
  isTTY: boolean;
  /** Bytes emitted so far (the whole session). */
  readonly bytes: string;
  /** Drop everything emitted before now — snapshot a phase. */
  reset(): void;
  resize(columns: number, rows: number): void;
}

function makeStdout(columns: number, rows: number): FakeStdout {
  let buf = "";
  const out = new Writable({
    write(chunk, _enc, cb) { buf += chunk.toString(); cb(); },
  }) as FakeStdout;
  out.columns = columns;
  out.rows = rows;
  out.isTTY = true;
  Object.defineProperty(out, "bytes", { get: () => buf });
  out.reset = () => { buf = ""; };
  // Ink listens for the terminal 'resize' event and re-renders.
  out.resize = (c, r) => {
    out.columns = c;
    out.rows = r;
    out.emit("resize");
  };
  return out;
}

function defaultProps(over: Partial<LiTTShellProps> = {}): LiTTShellProps {
  return {
    messages: [],
    activityLog: [],
    holoState: "IDLE",
    isProcessing: false,
    busySince: null,
    missionState: null,
    gitModified: 0,
    gitUntracked: 0,
    toolProgress: null,
    composerValue: "",
    onComposerChange: () => {},
    onSubmit: () => {},
    onNavigateHistory: () => null,
    onOpenPalette: () => {},
    onOpenContext: () => {},
    composerDisabled: false,
    project: "litlabs-website",
    branch: "feat/post-login-workspace-onboarding",
    localRuntime: "ready",
    brain: "LiTT Auto",
    activeModel: "GPT 5.6 Luna",
    activeProvider: null,
    mode: "act",

    // Pinned approval wiring — no approval is pending in these scenarios.
    approvalPrompt: null,
    onApprovalDecision: () => {},
    approvalSince: null,
    approvalAccumMs: 0,

    ...over,
  };
}

async function waitForBytes(bytes: () => string, needle: string): Promise<void> {
  await expect.poll(() => bytes().includes(needle), {
    timeout: 5_000,
    interval: 40,
  }).toBe(true);
}

// ─── Frame assertions ────────────────────────────────────────────────

/** Rows at the very bottom that must contain the status bar. */
const FOOTER_WINDOW = 8;

function assertCleanFrame(
  grid: string[],
  cols: number,
  opts: { footer: string[]; body?: string[] },
): void {
  // 1. Width discipline — no row may exceed the terminal width.
  const wide = grid.filter((l) => l.length > cols);
  expect(wide.map((l) => JSON.stringify(l)), `rows exceed ${cols} cols`).toEqual([]);
  // 2. Composer prompt row survived (never clobbered by content).
  expect(grid.some((l) => l.includes("›")), "composer prompt missing").toBe(true);

  // 3. Footer intact — status bar markers land in the bottom rows.
  const tail = grid.slice(-FOOTER_WINDOW);
  for (const s of opts.footer) {
    expect(
      tail.some((l) => l.includes(s)),
      `footer sentinel "${s}" not in last ${FOOTER_WINDOW} rows`,
    ).toBe(true);
  }

  // 4. No interleaving — historical collision victims appear contiguous.
  for (const s of opts.body ?? []) {
    expect(grid.some((l) => l.includes(s)), `"${s}" got shredded/overwritten`).toBe(true);
  }
}

// ─── Scenarios ───────────────────────────────────────────────────────

const t = Date.now();
const msg = (m: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage =>
  ({ ts: t, status: "complete", ...m });

/** Long multiline answer ending in the exact FAILED-summary shape that
 *  produced the original "Failed:bytes)" collision. */
const LONG_MULTILINE = [
  "Here's what I found:",
  "",
  "- Disk usage is at 87% — Dropbox and the search index dominate",
  "- Startup apps add roughly four seconds to boot",
  "",
  "Tried:",
  "- web.search: store hours ZIP 49456",
  "- web.fetch: Fetched the store page — 404",
  "",
  "Failed:",
  "- web.search: Web search failed (status 200)",
  "",
  "I did not verify the project as fully healthy.",
].join("\n");

const overflowScenario = (): Partial<LiTTShellProps> => ({
  messages: [
    msg({ id: "u1", role: "user", content: "what time does best buy open tomorrow 49456" }),
    msg({
      id: "a1", role: "assistant", content: LONG_MULTILINE,
      requestedModel: "LiTT Auto", resolvedModel: "GPT 5.6 Luna",
      servedModel: "openai/gpt-5.6-luna", durationMs: 7000,
    }),
  ],
  activityLog: [
    { id: "e1", ts: t, type: "tool.completed", text: "Store hours lookup returned no answers", semantic: "success" },
    { id: "e2", ts: t, type: "tool.failed", text: "Web search failed (status 200)", semantic: "failed" },
    { id: "e3", ts: t, type: "tool.completed", text: "Fetched store page — 404", semantic: "success" },
  ] as ActivityEntry[],
  missionState: {
    text: "Find Best Buy hours", runId: "run_xyz", state: "FAILED",
    startedAt: t - 60_000, endedAt: t, filesTouched: [], commandsExecuted: [],
    testResults: null, typecheckPassed: null, buildPassed: null, runtimeProven: false,
    baselineGitFiles: [], missionDeltaFiles: [], readOnly: true,
    toolsUsed: ["web.search", "web.fetch"],
  } satisfies MissionState,
  // Dirty repo props: under the terminal-state precedence the FAILED
  // footer ("× Failed") wins over the raw "+3" — dirty counts only
  // render when the runtime is idle.
  gitModified: 1,
  gitUntracked: 2,
});

const doneSummaryScenario = (): Partial<LiTTShellProps> => ({
  messages: [
    msg({ id: "u1", role: "user", content: "Optimize the startup sequence" }),
    msg({
      id: "a1", role: "assistant",
      content: "Disabled three redundant services and deferred the wallpaper loader.",
      requestedModel: "LiTT Auto", resolvedModel: "GPT 5.6 Luna",
      servedModel: "openai/gpt-5.6-luna", durationMs: 18_500,
    }),
  ],
  activityLog: [
    { id: "e1", ts: t, type: "tool.completed", text: "Edited startup.ps1", semantic: "success" },
    { id: "e2", ts: t, type: "tool.completed", text: "Ran verification gate — all green", semantic: "success" },
  ] as ActivityEntry[],
  missionState: {
    text: "Optimize the startup sequence", runId: "run_abc", state: "COMPLETE",
    startedAt: t - 30_000, endedAt: t,
    filesTouched: ["startup.ps1"], commandsExecuted: ["pnpm verify"],
    testResults: { passed: 22, failed: 0, total: 22 },
    typecheckPassed: true, buildPassed: true, runtimeProven: true,
    baselineGitFiles: [], missionDeltaFiles: ["startup.ps1"], readOnly: false,
    toolsUsed: ["edit_file", "run_command"],
  } satisfies MissionState,
  gitModified: 2,
  gitUntracked: 0,
});

// ─── The matrix ──────────────────────────────────────────────────────

describe("shell ANSI-grid regression", () => {
  const SIZES = [
    [100, 24], [100, 30], [120, 30],
  ] as const;

  for (const [cols, rows] of SIZES) {
    it(`overflow (long multiline + tool results + FAILED + dirty footer) @ ${cols}x${rows}`, async () => {
      const out = makeStdout(cols, rows);
      const inst = render(
        React.createElement(LiTTShell, defaultProps(overflowScenario())),
        { stdout: out, stdin: makeStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true },
      );
      try {
        await waitForBytes(() => out.bytes, "Act");
        await new Promise((r) => setTimeout(r, 150));
        inst.unmount();
        await new Promise((r) => setTimeout(r, 100));

        assertCleanFrame(emulate(out.bytes), cols, {
          // FAILED missions show "× Failed  v View" — the terminal state
          // takes priority over the raw dirty count in the status bar.
          // (Pre-redesign the sentinel was "! failed"; the runtime-state
          // consolidation renamed it to the shared glyph vocabulary.)
          footer: ["Plan", "Act", "× Failed"],
          body: [
            "Web search failed (status 200)",
            // Tail line of the long answer — historically shredded first.
            "I did not verify the project as fully healthy.",
          ],
        });
      } finally {
        inst.unmount();
      }
    });

    it(`COMPLETE summary @ ${cols}x${rows}`, async () => {
      const out = makeStdout(cols, rows);
      const inst = render(
        React.createElement(LiTTShell, defaultProps(doneSummaryScenario())),
        { stdout: out, stdin: makeStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true },
      );
      try {
        await waitForBytes(() => out.bytes, "COMPLETE");
        await new Promise((r) => setTimeout(r, 150));
        inst.unmount();
        await new Promise((r) => setTimeout(r, 100));

        assertCleanFrame(emulate(out.bytes), cols, {
          // COMPLETE missions show "✓ Complete" — terminal state now takes
          // precedence over the raw git dirty count ("+2"), mirroring the
          // FAILED-over-dirty precedence the overflow scenario asserts.
          footer: ["Plan", "Act", "✓ Complete"],
          body: ["COMPLETE", "tests passed"],
        });
      } finally {
        inst.unmount();
      }
    });
  }

  it("resize smaller → larger → smaller keeps every phase clean", async () => {
    const out = makeStdout(80, 24);
    const inst = render(
      React.createElement(LiTTShell, defaultProps(overflowScenario())),
      { stdout: out, stdin: makeStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true },
    );
    try {
      // Phase 1: small
      await waitForBytes(() => out.bytes, "Act");
      await new Promise((r) => setTimeout(r, 150));
      assertCleanFrame(emulate(out.bytes), 80, {
        footer: ["Plan", "Act"],
        body: ["I did not verify the project as fully healthy."],
      });
      out.reset();

      // Phase 2: grow
      out.resize(120, 36);
      await new Promise((r) => setTimeout(r, 300));
      assertCleanFrame(emulate(out.bytes), 120, {
        footer: ["Plan", "Act", "× Failed"],
      });
      out.reset();

      // Phase 3: shrink back
      out.resize(80, 24);
      await new Promise((r) => setTimeout(r, 300));
      inst.unmount();
      await new Promise((r) => setTimeout(r, 100));
      assertCleanFrame(emulate(out.bytes), 80, {
        footer: ["Plan", "Act", "× Failed"],
        body: ["I did not verify the project as fully healthy."],
      });
    } finally {
      inst.unmount();
    }
  });
});

