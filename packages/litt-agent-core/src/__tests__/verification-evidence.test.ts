/**
 * Verification evidence propagation — regression tests.
 *
 * The failure that motivated this: a verification_check_result event
 * carried only {status, exitCode, durationMs}. The underlying command,
 * cwd, stdout/stderr, and spawn/timeout status were dropped, so the UI
 * could only show a generic "NOT VERIFIED" summary.
 *
 * These tests pin what the gate emits for each real outcome:
 *   - nonzero exit with a distinctive stderr marker
 *   - timeout
 *   - spawn failure (executable missing)
 *   - success
 *   - secret redaction + long-output bounding
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { VerificationGate } from "../verification-gate.js";
import { CommandExecutor } from "../command-executor.js";
import { RuntimeStore } from "../state.js";
import type {
  RuntimeEvent,
  ShellExecutor,
  ShellExecuteOptions,
  ShellResult,
  ToolStatus,
} from "../types.js";

const TMP: string[] = [];
afterEach(() => {
  while (TMP.length) fs.rmSync(TMP.pop()!, { recursive: true, force: true });
});

function makeProject(scripts: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-vev-"));
  TMP.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "vev", version: "1.0.0", scripts }),
  );
  return dir;
}

interface Behavior { stdout?: string; stderr?: string; exitCode?: number; status?: ToolStatus }

class MockShell implements ShellExecutor {
  readonly cwd: string;
  readonly platform = process.platform;
  readonly environment: Record<string, string> = {};
  behavior: Behavior = { exitCode: 0 };
  constructor(cwd: string) { this.cwd = cwd; }
  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    const b = this.behavior;
    const exitCode = b.exitCode ?? 0;
    const status = b.status ?? (exitCode === 0 ? "success" : "failed");
    return {
      ok: status === "success", status,
      stdout: b.stdout ?? "", stderr: b.stderr ?? "",
      exitCode, durationMs: 5,
      command: options.command, args: options.args ?? [],
      truncated: false, pid: 1,
    };
  }
  async cancel(): Promise<number[]> { return []; }
}

function harness(cwd: string) {
  const events: RuntimeEvent[] = [];
  const shell = new MockShell(cwd);
  const store = new RuntimeStore();
  const executor = new CommandExecutor(shell, store);
  const gate = new VerificationGate({
    executor, shell, cwd,
    emitter: (e) => events.push(e),
    config: { checks: ["build"], timeoutMs: 60_000 },
  });
  const checkEvents = () =>
    events.filter((e) => e.type === "litt_event" && e.subtype === "verification_check_result");
  return { gate, shell, checkEvents };
}

describe("verification_check_result event evidence", () => {
  it("nonzero exit carries command, cwd, exit code, and stderr marker", async () => {
    const cwd = makeProject({ build: "x" });
    const { gate, shell, checkEvents } = harness(cwd);
    shell.behavior = { exitCode: 1, stderr: "UNIQUE_BUILD_ERROR_42 at src/x.ts" };
    const result = await gate.verify();
    assert.equal(result.proven, false);
    const ev = checkEvents().at(-1)!;
    assert.equal(ev.data?.status, "failed");
    assert.equal(ev.data?.exitCode, 1);
    assert.equal(ev.data?.command, "npm");
    assert.deepEqual(ev.data?.args, ["run", "build"]);
    assert.equal(ev.data?.cwd, cwd);
    assert.match(String(ev.data?.stderr), /UNIQUE_BUILD_ERROR_42/);
    // The mission-level summary now names the first real failure.
    assert.match(result.message, /First failure:/);
  });

  it("timeout is explicit — not a generic failure", async () => {
    const cwd = makeProject({ build: "x" });
    const { gate, shell, checkEvents } = harness(cwd);
    shell.behavior = { status: "timeout", exitCode: -1, stderr: "" };
    await gate.verify();
    const ev = checkEvents().at(-1)!;
    assert.equal(ev.data?.status, "timeout");
    assert.equal(ev.data?.exitCode, -1);
  });

  it("spawn failure surfaces the spawn error, not 'exit 1'", async () => {
    const cwd = makeProject({ build: "x" });
    const { gate, shell, checkEvents } = harness(cwd);
    shell.behavior = { status: "failed", exitCode: -1, stderr: "spawn npm ENOENT" };
    await gate.verify();
    const ev = checkEvents().at(-1)!;
    assert.equal(ev.data?.status, "failed");
    assert.equal(ev.data?.exitCode, -1);
    assert.match(String(ev.data?.stderr), /ENOENT/);
  });

  it("exit 0 reports success with output", async () => {
    const cwd = makeProject({ build: "x" });
    const { gate, shell, checkEvents } = harness(cwd);
    shell.behavior = { exitCode: 0, stdout: "BUILD_OK_MARKER" };
    const result = await gate.verify();
    assert.equal(result.proven, true);
    const ev = checkEvents().at(-1)!;
    assert.equal(ev.data?.status, "success");
    assert.equal(ev.data?.exitCode, 0);
    assert.match(String(ev.data?.stdout), /BUILD_OK_MARKER/);
  });

  it("secrets are redacted and long output is bounded", async () => {
    const cwd = makeProject({ build: "x" });
    const { gate, shell, checkEvents } = harness(cwd);
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const tail = "TAIL_ERROR_VISIBLE";
    shell.behavior = { exitCode: 1, stderr: `${secret}\n${"x".repeat(9000)}\n${tail}` };
    await gate.verify();
    const ev = checkEvents().at(-1)!;
    const err = String(ev.data?.stderr);
    assert.ok(!err.includes(secret), "secret must not appear in emitted stderr");
    assert.ok(err.length < 4600, "stderr excerpt is bounded");
    assert.match(err, new RegExp(tail));
  });
});
