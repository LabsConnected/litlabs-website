/**
 * Dex SUPER Stage 1A — local diagnostics tests.
 *
 * Covers: tasklist parsing, structured-argv capture, consent gating,
 * audit redaction, honest-unavailable behavior, and the command router.
 * Subprocesses are injected — tests never spawn tasklist/PowerShell.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTasklistCsv, listProcesses } from "../lib/dex/processes.js";
import { captureScreenshot } from "../lib/dex/screenshot.js";
import { collectMetrics } from "../lib/dex/metrics.js";
import { audit, auditLogPath } from "../lib/dex/audit.js";
import { dexCommand } from "../commands/dex.js";

const TASKLIST_CSV = [
  '"System Idle Process","0","Services","0","8 K"',
  '"chrome.exe","42100","Console","1","1,245,876 K"',
  '"Code.exe","1234","Console","1","512,300 K"',
  '"svchost.exe","876","Services","0","45,000 K"',
  '"malformed line without quotes',
  '"node.exe","5555","Console","1","98,765 K"',
].join("\r\n");

describe("parseTasklistCsv", () => {
  it("parses rows, sorts by memory desc, skips malformed lines", () => {
    const rows = parseTasklistCsv(TASKLIST_CSV);
    expect(rows.map((r) => r.name)).toEqual([
      "chrome.exe",
      "Code.exe",
      "node.exe",
      "svchost.exe",
      "System Idle Process",
    ]);
    expect(rows[0]).toMatchObject({ pid: 42100, memKb: 1245876 });
  });

  it("returns empty on garbage", () => {
    expect(parseTasklistCsv("not csv at all")).toEqual([]);
  });
});

describe("listProcesses", () => {
  it("returns top-N via injected execFile on Windows; honest unavailable elsewhere", async () => {
    const run = vi.fn((_cmd: string, _args: string[], cb: (e: Error | null, o: string) => void) => {
      cb(null, TASKLIST_CSV);
    });
    const result = await listProcesses(3, run);
    if (process.platform === "win32") {
      expect(result).toMatchObject({ ok: true, total: 5 });
      if (result.ok) {
        expect(result.top).toHaveLength(3);
        expect(result.top[0].name).toBe("chrome.exe");
      }
      // Structured argv — tasklist.exe, CSV format flag, no shell.
      expect(run).toHaveBeenCalledWith(
        "tasklist.exe",
        ["/fo", "csv", "/nh"],
        expect.any(Function),
      );
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("tasklist");
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("reports exec failure honestly", async () => {
    const run = vi.fn((_c: string, _a: string[], cb: (e: Error | null, o: string) => void) =>
      cb(new Error("spawn failed"), ""),
    );
    const result = await listProcesses(5, run);
    if (process.platform === "win32") {
      expect(result).toMatchObject({ ok: false });
    } else {
      expect(result.ok).toBe(false);
    }
  });
});

describe("captureScreenshot", () => {
  it("uses non-interactive structured PowerShell argv; reports platform honestly", async () => {
    const run = vi.fn((_c: string, _a: string[], cb: (e: Error | null, o: string) => void) =>
      cb(null, ""),
    );
    const result = await captureScreenshot(run);
    if (process.platform === "win32") {
      // The fake run wrote no file → honest "no output" rather than success.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("no output");
      const [cmd, args] = run.mock.calls[0];
      expect(cmd).toBe("powershell.exe");
      expect(args).toContain("-NoProfile");
      expect(args).toContain("-NonInteractive");
      // Output path lands inside the dex shots dir, not caller input.
      expect(args[args.length - 1]).toMatch(/dex[\\/]shots[\\/]shot-.*\.png/);
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("System.Drawing");
      expect(run).not.toHaveBeenCalled();
    }
  });
});

describe("collectMetrics", () => {
  it("returns sane structured metrics on any platform", async () => {
    const m = await collectMetrics();
    expect(m.cpu.cores).toBeGreaterThan(0);
    expect(m.cpu.busyFraction).toBeGreaterThanOrEqual(0);
    expect(m.cpu.busyFraction).toBeLessThanOrEqual(1);
    expect(m.memory.totalMb).toBeGreaterThan(0);
    expect(m.memory.usedMb).toBeGreaterThan(0);
    if (process.platform === "win32") {
      expect(m.cpu.loadavg).toBeNull(); // honest null, not fake zeros
    } else {
      expect(m.cpu.loadavg).toHaveLength(3);
    }
  });
});

describe("audit", () => {
  let tmp: string;
  let prev: string | undefined;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "litt-dex-test-"));
    prev = process.env.LITT_STATE_HOME;
    process.env.LITT_STATE_HOME = tmp;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.LITT_STATE_HOME;
    else process.env.LITT_STATE_HOME = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("appends redacted JSONL records under the dex home", async () => {
    audit({ verb: "status", ok: true, ms: 12, detail: "env API_KEY=superlongsecretvalue12345 done" });
    audit({ verb: "cpu", ok: false, ms: 3 });
    const path = auditLogPath();
    expect(path).toContain(join("dex", "audit.jsonl"));
    const lines = (await fs.readFile(path, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const rec = JSON.parse(lines[0]);
    expect(rec.verb).toBe("status");
    expect(rec.ok).toBe(true);
    expect(rec.detail).not.toContain("superlongsecretvalue");
  });
});

describe("dexCommand", () => {
  let tmp: string;
  let prev: string | undefined;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "litt-dex-test-"));
    prev = process.env.LITT_STATE_HOME;
    process.env.LITT_STATE_HOME = tmp;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.LITT_STATE_HOME;
    else process.env.LITT_STATE_HOME = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("prints usage with no verb (exit 0)", async () => {
    expect(await dexCommand([])).toBe(0);
  });

  it("owns --help: never executes for `dex --help` or `dex <verb> --help`", async () => {
    // Routing regression: index.ts passes --help through to dex (a
    // SELF_HELP_COMMANDS member); dexCommand must treat it as usage —
    // exit 0, and crucially must NOT run a verb (e.g. `shot --help`
    // must not be read as a screenshot with an unknown flag).
    expect(await dexCommand(["--help"])).toBe(0);
    expect(await dexCommand(["-h"])).toBe(0);
    expect(await dexCommand(["status", "--help"])).toBe(0);
    expect(await dexCommand(["shot", "--help"])).toBe(0); // no consent prompt path, no capture
  });

  it("rejects an unknown verb (exit 1)", async () => {
    expect(await dexCommand(["reboot"])).toBe(1);
  });

  it("refuses screenshot without explicit --yes consent", async () => {
    // Consent gate: no --yes → exit 1 and no capture attempt.
    expect(await dexCommand(["shot"])).toBe(1);
  });

  it("status composite completes (subsystems degrade honestly)", async () => {
    expect(await dexCommand(["status"])).toBe(0);
  }, 20_000);

  it("cpu and ram report (exit 0)", async () => {
    expect(await dexCommand(["cpu"])).toBe(0);
    expect(await dexCommand(["ram"])).toBe(0);
  }, 10_000);

  it("project reports detected root (exit 0)", async () => {
    expect(await dexCommand(["project"])).toBe(0);
  });

  it("writes an audit record per invocation", async () => {
    await dexCommand(["ram"]);
    const lines = (await fs.readFile(auditLogPath(), "utf-8")).trim().split("\n");
    const verbs = lines.map((l) => JSON.parse(l).verb);
    expect(verbs).toContain("ram");
  });
});
