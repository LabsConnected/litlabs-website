/**
 * PC scheduled tasks — pure contract tests.
 *
 * Covers:
 *   - decodeTaskResult: scheduler result codes → readable strings
 *   - humanDuration / summarizeTriggers: trigger display
 *   - expectedPort: endpoint expectation for service-style tasks
 *   - classifyTaskHealth: state + process truth + limits + files + ports
 *   - findActionCollisions: duplicate payload detection
 *   - auth gate: pc tasks runs without login
 */
import { describe, it, expect } from "vitest";
import {
  decodeTaskResult,
  humanDuration,
  summarizeTriggers,
  expectedPort,
  classifyTaskHealth,
  findActionCollisions,
  isManagedTask,
  type SchedTask,
  type TaskTrigger,
} from "../lib/pc-tasks.js";
import { requiresAuth } from "../index.js";

const NOW = Date.parse("2026-10-31T21:00:00Z");
const ISO = (s: string) => new Date(Date.parse(s)).toISOString();

function mkTask(over: Partial<SchedTask> = {}): SchedTask {
  return {
    name: "Test Task",
    path: "\\",
    state: "Ready",
    enabled: true,
    lastRun: ISO("2026-10-31T12:00:00Z"),
    lastResult: 0,
    nextRun: ISO("2026-11-01T02:30:00Z"),
    missed: 0,
    actions: [{ exe: "powershell.exe", args: "-File C:\\x\\job.ps1", wd: "" }],
    triggers: [{ type: "MSFT_TaskDailyTrigger", start: "2026-10-31T03:30:00", daysOfWeek: 0, every: "", enabled: true }],
    execTimeoutSec: 3600,
    restartCount: 0,
    multiInst: "IgnoreNew",
    tokens: ["job.ps1"],
    procs: [],
    actionFiles: [{ path: "C:\\x\\job.ps1", exists: true }],
    port: null,
    portOn: null,
    ...over,
  };
}

const LOGON: TaskTrigger = { type: "MSFT_TaskLogonTrigger", start: "", daysOfWeek: 0, every: "", enabled: true };

describe("decodeTaskResult", () => {
  it("decodes the common scheduler codes", () => {
    expect(decodeTaskResult(0)).toBe("success");
    expect(decodeTaskResult(267009)).toContain("currently running");
    expect(decodeTaskResult(267011)).toContain("not yet run");
    expect(decodeTaskResult(3221225786)).toContain("terminated");
    expect(decodeTaskResult(-1073741510)).toContain("terminated"); // signed 0xC000013A
    expect(decodeTaskResult(0x80070002)).toContain("file not found");
  });
  it("falls back to hex for unknown codes", () => {
    expect(decodeTaskResult(0xdeadbeef)).toMatch(/exit 0xdeadbeef/i);
  });
});

describe("humanDuration", () => {
  it("parses ISO8601 durations", () => {
    expect(humanDuration("PT30M")).toBe("30m");
    expect(humanDuration("PT12H")).toBe("12h");
    expect(humanDuration("P1D")).toBe("1d");
    expect(humanDuration("PT1H30M")).toBe("1h30m");
    expect(humanDuration("P7D")).toBe("7d");
    expect(humanDuration("00:30:00")).toBe("30m"); // TimeSpan string form
    expect(humanDuration("12:00:00")).toBe("12h");
    expect(humanDuration("not-a-duration")).toBe("");
  });
});

describe("summarizeTriggers", () => {
  it("renders logon, daily, weekly, and repeating triggers", () => {
    const t = mkTask({ triggers: [LOGON] });
    expect(summarizeTriggers(t)).toBe("at logon");

    const daily = mkTask();
    expect(summarizeTriggers(daily)).toBe("daily 03:30");

    const weekly = mkTask({
      triggers: [{ type: "MSFT_TaskWeeklyTrigger", start: "2026-10-31T06:00:00", daysOfWeek: 1, every: "", enabled: true }],
    });
    expect(summarizeTriggers(weekly)).toBe("weekly Sun 06:00");

    const repeat = mkTask({
      triggers: [{ type: "MSFT_TaskTimeTrigger", start: "2026-10-31T15:55:57", daysOfWeek: 0, every: "PT30M", enabled: true }],
    });
    expect(summarizeTriggers(repeat)).toBe("once 15:55, repeats every 30m");
  });
  it("says when there are no enabled triggers", () => {
    const t = mkTask({ triggers: [{ ...LOGON, enabled: false }] });
    expect(summarizeTriggers(t)).toBe("no enabled triggers");
  });
});

describe("expectedPort", () => {
  it("extracts a port from the task name or args", () => {
    expect(expectedPort(mkTask({ name: "LiTT - Ollama 11434 Startup" }))).toBe(11434);
    expect(expectedPort(mkTask({ name: "LiTT Agent HQ" }))).toBe(8790);
    expect(expectedPort(mkTask({ name: "LiTT-BackupDaily" }))).toBeNull();
  });
});

describe("classifyTaskHealth", () => {
  it("disabled tasks are reported as disabled", () => {
    const t = mkTask({ state: "Disabled", enabled: false });
    expect(classifyTaskHealth(t, NOW).level).toBe("disabled");
  });

  it("running task with live procs inside the limit is healthy", () => {
    const t = mkTask({
      state: "Running",
      lastRun: ISO("2026-10-31T20:30:00Z"), // 30m ago
      lastResult: 267009,
      execTimeoutSec: 12 * 3600,
      procs: [{ pid: 1, name: "powershell.exe", cpuSec: 80, wsMb: 39, cmd: "x job.ps1" }],
    });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("healthy");
    expect(h.summary).toContain("running 30m");
    expect(h.summary).toContain("12h");
  });

  it("running task past its execution limit is critical", () => {
    const t = mkTask({
      state: "Running",
      lastRun: ISO("2026-10-31T08:00:00Z"), // 13h ago
      lastResult: 267009,
      execTimeoutSec: 12 * 3600,
      procs: [{ pid: 1, name: "powershell.exe", cpuSec: 80, wsMb: 39, cmd: "x job.ps1" }],
    });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("critical");
    expect(h.summary).toContain("past");
  });

  it("running task near the limit warns", () => {
    const t = mkTask({
      state: "Running",
      lastRun: ISO("2026-10-31T10:30:00Z"), // 10.5h ago
      lastResult: 267009,
      execTimeoutSec: 12 * 3600,
      procs: [{ pid: 1, name: "powershell.exe", cpuSec: 80, wsMb: 39, cmd: "x job.ps1" }],
    });
    expect(classifyTaskHealth(t, NOW).level).toBe("warning");
  });

  it("state=Running with no live process warns — scheduler truth is not process truth", () => {
    const t = mkTask({ state: "Running", lastResult: 267009, procs: [] });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("warning");
    expect(h.summary).toContain("no action process");
  });

  it("clean exit on a Ready task is healthy", () => {
    const h = classifyTaskHealth(mkTask(), NOW);
    expect(h.level).toBe("healthy");
    expect(h.summary).toBe("ok");
  });

  it("never-ran task with a future run is informational", () => {
    const t = mkTask({ lastRun: null, lastResult: 267011 });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("info");
    expect(h.summary).toContain("first run pending");
  });

  it("never-ran task with nothing scheduled warns", () => {
    const t = mkTask({ lastRun: null, lastResult: 267011, nextRun: null });
    expect(classifyTaskHealth(t, NOW).level).toBe("warning");
  });

  it("nonzero exit warns and a dead logon-resident task is called out", () => {
    const t = mkTask({
      lastResult: 3221225786, // 0xC000013A
      execTimeoutSec: 0,
      triggers: [LOGON],
      procs: [],
    });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("warning");
    expect(h.summary).toContain("terminated");
    expect(h.summary).toContain("resident task not running");
  });

  it("a clean-exiting logon launcher is NOT flagged as dead resident", () => {
    // Ollama startup VBS: designed to exit after spawning the service.
    const t = mkTask({
      name: "LiTT - Ollama 11434 Startup",
      lastResult: 0,
      execTimeoutSec: 0,
      triggers: [LOGON],
      procs: [],
      port: 11434,
      portOn: "127.0.0.1",
    });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("healthy");
    expect(h.summary).toContain(":11434 reachable on 127.0.0.1");
  });

  it("expected port refusing connections warns", () => {
    const t = mkTask({
      name: "LiTT - Ollama 11434 Startup",
      lastResult: 0,
      execTimeoutSec: 0,
      triggers: [LOGON],
      procs: [],
      port: 11434,
      portOn: null,
    });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("warning");
    expect(h.summary).toContain(":11434 refused");
  });

  it("missing action file is critical", () => {
    const t = mkTask({ actionFiles: [{ path: "C:\\x\\job.ps1", exists: false }] });
    const h = classifyTaskHealth(t, NOW);
    expect(h.level).toBe("critical");
    expect(h.summary).toContain("action file missing");
  });

  it("missed runs warn", () => {
    const t = mkTask({ missed: 2 });
    expect(classifyTaskHealth(t, NOW).level).toBe("warning");
  });
});

describe("findActionCollisions", () => {
  it("flags two enabled tasks launching the same script", () => {
    const a = mkTask({ name: "A", actions: [{ exe: "powershell.exe", args: "-File C:\\x\\job.ps1", wd: "" }] });
    const b = mkTask({ name: "B", actions: [{ exe: "powershell.exe", args: "-NoProfile -File C:\\x\\job.ps1", wd: "" }] });
    const cols = findActionCollisions([a, b]);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.tasks.sort()).toEqual(["A", "B"]);
  });
  it("ignores disabled tasks and distinct payloads", () => {
    const a = mkTask({ name: "A" });
    const b = mkTask({ name: "B", enabled: false, state: "Disabled" });
    const cTask = mkTask({ name: "C", actions: [{ exe: "powershell.exe", args: "-File C:\\x\\other.ps1", wd: "" }] });
    expect(findActionCollisions([a, b, cTask])).toHaveLength(0);
  });
});

describe("isManagedTask", () => {
  it("matches the LiTT fleet by name or action path", () => {
    expect(isManagedTask(mkTask({ name: "LiTT-BackupDaily" }))).toBe(true);
    expect(isManagedTask(mkTask({ name: "LiTT - Ollama 11434 Startup" }))).toBe(true);
    expect(isManagedTask(mkTask({ name: "LiTT Agent HQ" }))).toBe(true);
    expect(isManagedTask(mkTask({ name: "LiTTSplitTree" }))).toBe(true);
    expect(
      isManagedTask(mkTask({ name: "Plain Task", actions: [{ exe: "powershell.exe", args: "-File C:\\Users\\litbi\\litt-supervisor\\x.ps1", wd: "" }] })),
    ).toBe(true);
    expect(isManagedTask(mkTask({ name: "Windows Update", actions: [{ exe: "svchost.exe", args: "-k netsvcs", wd: "" }] }))).toBe(false);
  });
});

describe("auth gate — pc commands are local machine tools", () => {
  it("requiresAuth is false for pc-tasks", () => {
    expect(requiresAuth("pc-tasks", false, false, false, false)).toBe(false);
    expect(requiresAuth("pc", false, false, false, false)).toBe(false);
  });
});
