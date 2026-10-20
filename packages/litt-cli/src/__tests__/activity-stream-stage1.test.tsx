/**
 * Stage 1 render checks — ActivityStream directly (no cockpit mount):
 * redaction in collapsed + expanded rows + command output + env assignments,
 * per-row expandedIds isolation, timestamps, and hard width-boundary
 * assertions at 120/80/60 columns (no overflow).
 *
 * RENDER SYNC: ActivityStream is a pure function component — its ENTIRE
 * output is committed in the first frame. `waitFrame()` polls until Ink has
 * written that frame (out.length > 0). No fixed delays are used.
 */
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityStream } from "../ink/activity-stream.js";
import type { ActivityEntry } from "../ink/cockpit-store.js";

const __filename = fileURLToPath(import.meta.url);

const stripAnsi = (s: string) => s.replace(/\x1B(?:\][^\x07]*\x07|\[[0-9;?]*[ -/]*[@-~])/g, "");

function mountStream(props: Parameters<typeof ActivityStream>[0]) {
  let out = "";
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = props.width ?? 80; stdout.rows = 40; stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { out += c.toString(); });
  const inst = render(React.createElement(ActivityStream, props), {
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false, patchConsole: false,
  });
  return {
    frame: () => stripAnsi(out),
    /** Wait until Ink has written the first complete frame. */
    async waitFrame(ms = 4000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (out.length > 0) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return false;
    },
    unmount: () => inst.unmount(),
  };
}

const secretEntry: ActivityEntry = {
  id: "e1", ts: Date.now(), type: "tool.completed",
  text: "ran with OPENROUTER_API_KEY=supersecret123",
  fullText: "full output\nBearer abcdef123456 done\nAPI_TOKEN=tok987 ok",
};

const cmdEntry: ActivityEntry = {
  id: "e2", ts: Date.now(), type: "tool.stdout",
  text: "export OPENAI_API_KEY=sk-proj-abc987654321 && run",
  fullText: "export OPENAI_API_KEY=sk-proj-abc987654321 && run\nGROQ_SECRET=hidden99\nexit 0",
};

const longEntry: ActivityEntry = {
  id: "e3", ts: Date.now(), type: "tool.stdout",
  text: "x".repeat(200) + " OPENROUTER_API_KEY=tailsecret999",
  fullText: "y".repeat(300) + " Bearer looooooooooooooooongtoken123456",
};

describe("ActivityStream — Stage 1", () => {
  it("renders real timestamps (HH:MM:SS)", async () => {
    const s = mountStream({ entries: [secretEntry], width: 120 });
    expect(await s.waitFrame()).toBe(true);
    expect(s.frame()).toMatch(/\d{2}:\d{2}:\d{2}/);
    s.unmount();
  });
  it("redacts secrets in collapsed rows", async () => {
    const s = mountStream({ entries: [secretEntry], width: 120 });
    expect(await s.waitFrame()).toBe(true);
    const f = s.frame();
    expect(f).not.toContain("supersecret123");
    expect(f).toContain("OPENROUTER_API_KEY=•••");
    s.unmount();
  });
  it("redacts secrets in per-row expanded details", async () => {
    const s = mountStream({ entries: [secretEntry], width: 120, expandedIds: new Set(["e1"]) });
    expect(await s.waitFrame()).toBe(true);
    const f = s.frame();
    expect(f).not.toContain("abcdef123456");
    expect(f).not.toContain("tok987");
    expect(f).toContain("•••");
    expect(f).toContain("−"); // expanded marker
    s.unmount();
  });
  it("redacts command output and env-var assignments", async () => {
    const s = mountStream({ entries: [cmdEntry], width: 120, expandedIds: new Set(["e2"]) });
    expect(await s.waitFrame()).toBe(true);
    const f = s.frame();
    expect(f).not.toContain("sk-proj-abc987654321");
    expect(f).not.toContain("hidden99");
    expect(f).toContain("OPENAI_API_KEY=•••");
    expect(f).toContain("GROQ_SECRET=•••");
    s.unmount();
  });
  it("expanding one entry never reveals another entry's protected content", async () => {
    const s = mountStream({
      entries: [secretEntry, cmdEntry],
      width: 120,
      expandedIds: new Set(["e2"]), // expand ONLY the command entry
    });
    expect(await s.waitFrame()).toBe(true);
    const f = s.frame();
    // e2's own expanded detail renders — redacted.
    expect(f).toContain("GROQ_SECRET=•••");
    // e1 stays collapsed: its fullText content AND its secret never surface.
    expect(f).not.toContain("full output");
    expect(f).not.toContain("abcdef123456");
    expect(f).not.toContain("tok987");
    s.unmount();
  });
  it("no rendered line exceeds the terminal width at 120/80/60", async () => {
    for (const w of [120, 80, 60]) {
      const s = mountStream({
        entries: [secretEntry, cmdEntry, longEntry],
        width: w,
        expandedIds: new Set(["e1", "e2", "e3"]),
        details: true,
      });
      expect(await s.waitFrame()).toBe(true);
      const lines = s.frame().split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `width ${w} produced output`).toBeGreaterThan(0);
      const over = lines.filter((l) => l.length > w);
      expect(over, `width ${w}: every line must fit — overflow: ${JSON.stringify(over.slice(0, 2))}`).toEqual([]);
      s.unmount();
    }
  });
});

// Source canaries — same convention as slash-command-ux.test.tsx. The full
// cockpit graph with a populated transcript needs a model turn; these lock
// the keyboard wiring so regressions can't silently remove the shortcuts.
describe("shortcut wiring canaries", () => {
  const appSrc = readFileSync(
    join(dirname(__filename), "..", "ink", "app.tsx"), "utf8");
  const streamSrc = readFileSync(
    join(dirname(__filename), "..", "ink", "activity-stream.tsx"), "utf8");
  it("Ctrl+D still branches on composerValue (not the keystroke)", () => {
    expect(appSrc).toMatch(/isCtrl\(input,\s*key,\s*"d"\)/);
    expect(appSrc).toMatch(/store\.state\.composerValue/);
    expect(appSrc).toMatch(/controller\.openDiffViewer\(\)/);
  });
  it("Ctrl+G toggles per-activity expansion on the latest entry", () => {
    expect(appSrc).toMatch(/isCtrl\(input,\s*key,\s*"g"\)/);
    expect(appSrc).toMatch(/toggleActivityExpanded/);
    expect(appSrc).toMatch(/expandedActivityIds=\{store\.state\.expandedActivityIds\}/);
  });
  it("Ctrl+O retains the global details toggle", () => {
    expect(appSrc).toMatch(/isCtrl\(input,\s*key,\s*"o"\)/);
    expect(appSrc).toMatch(/toggleToolDetails\(\)/);
  });
  it("expandedIds participates in row expansion and output is redacted", () => {
    expect(streamSrc).toMatch(/expandedIds\?\.has\(entry\.id\)/);
    expect(streamSrc).toMatch(/redactSecrets/);
  });
});
