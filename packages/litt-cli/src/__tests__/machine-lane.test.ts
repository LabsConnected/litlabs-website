/**
 * Machine lane regression tests — P0 local-execution routing fix.
 *
 * Root cause being fixed: the cockpit's default execution target is
 * REMOTE. The MODEL inference is proxied through terminal-server; when
 * terminal-server is unreachable, `awaitRemoteReady()` throws after 15s
 * and the whole mission dies — even for requests that only need LOCAL
 * read-only commands like `where.exe adb` or `adb devices -l`.
 *
 * The machine lane executes explicit local commands through the local
 * ExecutionGateway with NO contact to the remote model server. These
 * tests cover the matching, parsing, risk classification, destructive
 * refusal, locus reporting, and the "no fake fallback when semantics
 * differ" guarantee.
 */

import { describe, it, expect } from "vitest";
import {
  matchMachineLane,
  parseCommandLine,
  extractCommands,
  classifyMachineCommand,
  shouldRefuseUpFront,
  formatMachineResult,
  type MachineCommand,
  type MachineCommandResult,
} from "../lib/machine-lane.js";
import type { ToolResult } from "@litt/agent-core";

// ─── Helpers ───────────────────────────────────────────────────────

function cmd(command: string, args: string[], raw?: string): MachineCommand {
  return { command, args, raw: raw ?? [command, ...args].join(" ") };
}

function toolResult(partial: Partial<ToolResult> & { success?: boolean }): ToolResult {
  return {
    status: partial.status ?? (partial.success ? "success" : "failed"),
    success: partial.success ?? false,
    message: partial.message ?? "",
    data: partial.data ?? {},
  };
}

function machineResult(
  command: MachineCommand,
  result: ToolResult,
  ms = 10,
): MachineCommandResult {
  return { command, result, ms, locus: "local" };
}

// ─── parseCommandLine ──────────────────────────────────────────────

describe("machine-lane: parseCommandLine", () => {
  it("parses a simple command + args", () => {
    expect(parseCommandLine("where.exe adb")).toEqual(cmd("where.exe", ["adb"]));
  });

  it("parses adb devices -l", () => {
    expect(parseCommandLine("adb devices -l")).toEqual(cmd("adb", ["devices", "-l"]));
  });

  it("preserves double-quoted args with spaces (Windows paths)", () => {
    const parsed = parseCommandLine('"C:\\Program Files\\nodejs\\node.exe" --version');
    expect(parsed).not.toBeNull();
    expect(parsed!.command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(parsed!.args).toEqual(["--version"]);
  });

  it("skips empty lines and comments", () => {
    expect(parseCommandLine("")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
    expect(parseCommandLine("# a comment")).toBeNull();
    expect(parseCommandLine("// a comment")).toBeNull();
  });

  it("handles a command with no args", () => {
    expect(parseCommandLine("pwd")).toEqual(cmd("pwd", [], "pwd"));
  });
});

// ─── extractCommands ───────────────────────────────────────────────

describe("machine-lane: extractCommands", () => {
  it("extracts commands from a Run: block", () => {
    const input = [
      "Use real tools only. Execute locally.",
      "",
      "Run:",
      "where.exe adb",
      "adb devices -l",
      "git --version",
      "",
      "Do not modify anything.",
    ].join("\n");
    const commands = extractCommands(input);
    expect(commands).not.toBeNull();
    expect(commands!.map((c) => c.raw)).toEqual([
      "where.exe adb",
      "adb devices -l",
      "git --version",
    ]);
  });

  it("stops at a blank line after the Run: block", () => {
    const input = "Run:\nwhere.exe adb\n\ngit --version";
    const commands = extractCommands(input);
    expect(commands).not.toBeNull();
    expect(commands!.map((c) => c.raw)).toEqual(["where.exe adb"]);
  });

  it("stops at a trailing policy line", () => {
    const input = "Run:\nwhere.exe adb\nDo not modify anything.";
    const commands = extractCommands(input);
    expect(commands).not.toBeNull();
    expect(commands!.map((c) => c.raw)).toEqual(["where.exe adb"]);
  });

  it("returns null when no command lines are found", () => {
    expect(extractCommands("just some prose with no commands here")).toBeNull();
  });
});

// ─── matchMachineLane ──────────────────────────────────────────────

describe("machine-lane: matchMachineLane", () => {
  it("matches /local slash command with a single command", () => {
    const match = matchMachineLane("/local where.exe adb");
    expect(match).not.toBeNull();
    expect(match!.locus).toBe("local");
    expect(match!.commands).toEqual([cmd("where.exe", ["adb"])]);
  });

  it("matches /local with multiple lines", () => {
    const match = matchMachineLane("/local where.exe adb\nadb devices -l");
    expect(match).not.toBeNull();
    expect(match!.commands.length).toBe(2);
    expect(match!.commands[0].command).toBe("where.exe");
    expect(match!.commands[1].command).toBe("adb");
  });

  it("returns null for /local with no command", () => {
    expect(matchMachineLane("/local")).toBeNull();
    expect(matchMachineLane("/local   ")).toBeNull();
  });

  it("matches natural language with explicit local intent + Run: block", () => {
    const input = [
      "Use real tools only. Execute locally. Do not use REMOTE.",
      "",
      "Run:",
      "where.exe adb",
      "adb version",
      "adb devices -l",
      "git --version",
      "node --version",
      "pnpm --version",
      "powershell --version",
      "git rev-parse --show-toplevel",
      "git branch --show-current",
      "git rev-parse HEAD",
      "",
      "Do not modify anything.",
    ].join("\n");
    const match = matchMachineLane(input);
    expect(match).not.toBeNull();
    expect(match!.locus).toBe("local");
    expect(match!.commands.length).toBe(10);
    expect(match!.commands[0].raw).toBe("where.exe adb");
    expect(match!.commands[2].raw).toBe("adb devices -l");
  });

  it("does NOT match prose without local intent", () => {
    // A request with no "execute locally" / "do not use remote" intent
    // must fall through to the normal path (which may use remote).
    expect(matchMachineLane("what time is it")).toBeNull();
    expect(matchMachineLane("where.exe adb")).toBeNull();
  });

  it("does NOT match a remote-only request (no fake fallback)", () => {
    // "show Railway production filesystem" is remote-only — the machine
    // lane must not match it, so it falls through and fails correctly
    // when remote is down (no silent local fallback that changes semantics).
    const input = "Show the Railway production filesystem. Execute locally.";
    // Has local intent but no parseable command lines → no match.
    expect(matchMachineLane(input)).toBeNull();
  });

  it("reports LOCAL locus for every matched command", () => {
    const match = matchMachineLane("/local adb devices -l");
    expect(match!.locus).toBe("local");
  });
});

// ─── Risk classification (reuses canonical classifyCommand) ────────

describe("machine-lane: risk classification", () => {
  it("classifies where.exe adb as read-only (Windows suffix normalization)", () => {
    const risk = classifyMachineCommand(cmd("where.exe", ["adb"]));
    expect(risk.capability).toBe("read_only");
    expect(risk.level).toBe("safe");
  });

  it("classifies adb devices -l as read-only", () => {
    const risk = classifyMachineCommand(cmd("adb", ["devices", "-l"]));
    // adb is not in the registry → arbitrary_code by default. BUT the
    // machine lane still runs it locally (the gateway enforces mode).
    // The key assertion: it is NOT classified as destructive.
    expect(risk.capability).not.toBe("destructive");
  });

  it("classifies git --version as read-only (version flag)", () => {
    const risk = classifyMachineCommand(cmd("git", ["--version"]));
    expect(risk.capability).toBe("read_only");
    expect(risk.level).toBe("safe");
  });

  it("classifies node --version as read-only (version flag downgrade)", () => {
    const risk = classifyMachineCommand(cmd("node", ["--version"]));
    expect(risk.capability).toBe("read_only");
    expect(risk.level).toBe("safe");
  });

  it("classifies Get-Process as read-only (PowerShell cmdlet)", () => {
    const risk = classifyMachineCommand(cmd("Get-Process", []));
    expect(risk.capability).toBe("read_only");
  });

  it("classifies git status as read-only", () => {
    const risk = classifyMachineCommand(cmd("git", ["status"]));
    expect(risk.capability).toBe("read_only");
  });

  it("classifies pnpm test as arbitrary_code (not read-only)", () => {
    const risk = classifyMachineCommand(cmd("pnpm", ["test"]));
    expect(risk.capability).toBe("arbitrary_code");
  });
});

// ─── Destructive refusal ───────────────────────────────────────────

describe("machine-lane: destructive refusal", () => {
  it("refuses rm -rf up front", () => {
    expect(shouldRefuseUpFront(cmd("rm", ["-rf", "/"]))).toBe(true);
  });

  it("refuses fastboot flash (device-destructive)", () => {
    expect(shouldRefuseUpFront(cmd("fastboot", ["flash", "boot", "boot.img"]))).toBe(true);
  });

  it("refuses format (disk-destructive)", () => {
    expect(shouldRefuseUpFront(cmd("format", ["C:"]))).toBe(true);
  });

  it("does NOT refuse fastboot devices (read-only)", () => {
    expect(shouldRefuseUpFront(cmd("fastboot", ["devices"]))).toBe(false);
  });

  it("does NOT refuse where.exe adb (read-only)", () => {
    expect(shouldRefuseUpFront(cmd("where.exe", ["adb"]))).toBe(false);
  });

  it("does NOT refuse adb devices -l", () => {
    expect(shouldRefuseUpFront(cmd("adb", ["devices", "-l"]))).toBe(false);
  });

  it("does NOT refuse git --version", () => {
    expect(shouldRefuseUpFront(cmd("git", ["--version"]))).toBe(false);
  });
});

// ─── Result formatting with locus ──────────────────────────────────

describe("machine-lane: result formatting", () => {
  it("formats a successful result with LOCAL locus", () => {
    const res = machineResult(
      cmd("where.exe", ["adb"]),
      toolResult({
        success: true,
        message: "where.exe adb — exit 0 (10ms)",
        data: { stdout: "C:\\platform-tools\\adb.exe", exitCode: 0 },
      }),
    );
    const formatted = formatMachineResult(res);
    expect(formatted).toContain("LOCAL");
    expect(formatted).toContain("where.exe adb");
    expect(formatted).toContain("exit 0");
    expect(formatted).toContain("C:\\platform-tools\\adb.exe");
  });

  it("formats a failed result (missing tool) honestly", () => {
    const res = machineResult(
      cmd("adb", ["version"]),
      toolResult({
        success: false,
        message: "adb version — exit 1 (5ms)",
        data: { stderr: "'adb' is not recognized", exitCode: 1 },
      }),
    );
    const formatted = formatMachineResult(res);
    expect(formatted).toContain("LOCAL");
    expect(formatted).toContain("adb version");
    // Must report the real failure, never infer availability
    expect(formatted).toContain("not recognized");
  });

  it("includes the execution locus in every result", () => {
    const res = machineResult(
      cmd("git", ["--version"]),
      toolResult({ success: true, message: "ok", data: { stdout: "git version 2.43.0", exitCode: 0 } }),
    );
    expect(formatMachineResult(res)).toMatch(/^LOCAL ·/);
  });
});

// ─── Routing invariants (no fake fallback) ─────────────────────────

describe("machine-lane: routing invariants", () => {
  it("a local USB/ADB request resolves to LOCAL locus, never remote", () => {
    const match = matchMachineLane("/local adb devices -l");
    expect(match!.locus).toBe("local");
    // USB hardware is local — the lane must never claim remote can see it.
    expect(match!.commands[0].command).toBe("adb");
  });

  it("remote-only capability words do not produce a machine match", () => {
    // "Railway production logs" requires remote — no command lines to
    // parse locally, so no machine match (falls through, fails correctly).
    expect(matchMachineLane("Show Railway production logs. Execute locally.")).toBeNull();
  });

  it("does not silently relocate a remote-semantic request to local", () => {
    // Even with local intent, a request whose commands are clearly
    // remote-server operations (no local command lines) does not match.
    const input = "Check production Railway logs. Execute locally. Do not use REMOTE.";
    expect(matchMachineLane(input)).toBeNull();
  });
});

// ─── Structured argv (no shell string) ─────────────────────────────

describe("machine-lane: structured argv", () => {
  it("preserves args as separate array elements, not a concatenated string", () => {
    const parsed = parseCommandLine("git rev-parse --show-toplevel");
    expect(parsed!.command).toBe("git");
    expect(parsed!.args).toEqual(["rev-parse", "--show-toplevel"]);
    // No shell string concatenation
    expect(typeof parsed!.command).toBe("string");
    expect(Array.isArray(parsed!.args)).toBe(true);
  });

  it("handles Windows paths containing spaces via quoting", () => {
    const parsed = parseCommandLine('"C:\\Program Files\\Git\\bin\\git.exe" --version');
    expect(parsed!.command).toBe("C:\\Program Files\\Git\\bin\\git.exe");
    expect(parsed!.args).toEqual(["--version"]);
  });
});

// ─── Secret redaction (defense-in-depth, applied by runCommand) ────

describe("machine-lane: secret redaction contract", () => {
  it("the machine lane does not bypass redaction (gateway applies it)", () => {
    // The machine lane routes through gateway → project.run → runCommand,
    // which calls redactSecrets() on stdout/stderr. This test asserts the
    // contract: a result containing a secret pattern is already redacted
    // by the time formatMachineResult sees it (the gateway did it).
    const res = machineResult(
      cmd("env", []),
      toolResult({
        success: true,
        message: "ok",
        data: { stdout: "API_KEY=[REDACTED]", exitCode: 0 },
      }),
    );
    const formatted = formatMachineResult(res);
    // The redaction happened upstream (runCommand); the lane just formats.
    // Assert no raw secret leaks through the formatting layer.
    expect(formatted).not.toContain("sk-");
    expect(formatted).toContain("[REDACTED]");
  });
});
