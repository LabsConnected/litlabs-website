/**
 * VerificationGate tests — the runtime truth boundary.
 *
 * Tests the single most important rule in LiTT:
 *   COMPLETE ≠ model says done
 *   COMPLETE = runtime proved it passed
 *
 * Covers:
 *   - All checks pass → proven
 *   - One check fails → not proven, stops at first failure
 *   - Missing checks skipped (not failed)
 *   - Browser check with/without verifier
 *   - Auto-detection from package.json scripts
 *   - Explicit checks list
 *   - Empty config → status "skipped", proven false
 *   - Phase transitions (verifying → complete/failed)
 *   - Event emission (verification_start, verification_check_*, verification_result)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  VerificationGate,
  createVerificationGate,
  assertComplete,
  VerificationEvidenceCache,
} from "../verification-gate.js";
import { CommandExecutor } from "../command-executor.js";
import { RuntimeStore } from "../state.js";
import type {
  RuntimeEvent,
  RuntimeEventEmitter,
  ShellExecutor,
  ShellExecuteOptions,
  ShellResult,
  ToolStatus,
} from "../types.js";
import type { CheckResult, VerificationCheckId } from "../verification-gate.js";

// ─── Event capture ─────────────────────────────────────────────────

class EventCapture {
  events: RuntimeEvent[] = [];
  emitter(): RuntimeEventEmitter {
    return (event: RuntimeEvent) => {
      this.events.push(event);
    };
  }
  litt(subtype: string): RuntimeEvent[] {
    return this.events.filter((e) => e.type === "litt_event" && e.subtype === subtype);
  }
}

// ─── Mock shell ────────────────────────────────────────────────────

interface MockShellBehavior {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  status?: ToolStatus;
  delayMs?: number;
}

class MockShell implements ShellExecutor {
  readonly cwd: string;
  readonly platform: NodeJS.Platform | string = process.platform;
  readonly environment: Record<string, string> = {};
  /** Map of "command args.join(' ')" → behavior, plus a default. */
  private _behaviors: Map<string, MockShellBehavior> = new Map();
  private _default: MockShellBehavior = { stdout: "", stderr: "", exitCode: 0, status: "success" };

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  setBehavior(command: string, args: string[], behavior: MockShellBehavior): void {
    this._behaviors.set(`${command} ${args.join(" ")}`, behavior);
  }

  setDefault(behavior: MockShellBehavior): void {
    this._default = behavior;
  }

  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    const key = `${options.command} ${(options.args ?? []).join(" ")}`;
    const b = this._behaviors.get(key) ?? this._default;
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    const exitCode = b.exitCode ?? 0;
    const status: ToolStatus = b.status ?? (exitCode === 0 ? "success" : "failed");
    return {
      ok: status === "success",
      status,
      stdout: b.stdout ?? "",
      stderr: b.stderr ?? "",
      exitCode,
      durationMs: b.delayMs ?? 1,
      command: options.command,
      args: options.args ?? [],
      truncated: false,
      pid: 12345,
    };
  }

  async cancel(): Promise<number[]> {
    return [];
  }
}

// ─── Mock browser verifier ─────────────────────────────────────────

class MockBrowserVerifier {
  private _ok: boolean;
  private _errors: string[];
  constructor(ok: boolean, errors: string[] = []) {
    this._ok = ok;
    this._errors = errors;
  }
  async verify(url: string, _timeoutMs: number) {
    return {
      ok: this._ok,
      errors: this._ok ? [] : this._errors,
      message: this._ok ? `OK ${url}` : `errors on ${url}`,
      durationMs: 5,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function makeTmpProject(scripts: Record<string, string> = {}, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-verify-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-proj", version: "1.0.0", scripts }, null, 2),
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function makeGate(
  cwd: string,
  shell: ShellExecutor,
  opts: {
    store?: RuntimeStore | null;
    emitter?: RuntimeEventEmitter | null;
    browserVerifier?: MockBrowserVerifier | null;
    config?: import("../verification-gate.js").VerificationConfig;
  } = {},
): VerificationGate {
  const executor = new CommandExecutor(shell, opts.store ?? null, opts.emitter ?? null);
  return createVerificationGate({
    executor,
    shell,
    store: opts.store ?? null,
    emitter: opts.emitter ?? null,
    cwd,
    browserVerifier: opts.browserVerifier ?? null,
    config: opts.config,
  });
}

function checkById(result: { checks: CheckResult[] }, id: VerificationCheckId): CheckResult | undefined {
  return result.checks.find((c) => c.id === id);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("VerificationGate — runtime-proved COMPLETE", () => {
  it("all configured checks pass → proven: true, status: proven", async () => {
    const cwd = makeTmpProject({ typecheck: "tsc --noEmit", test: "vitest run", build: "next build" });
    const shell = new MockShell(cwd);
    // All succeed by default
    const gate = makeGate(cwd, shell, { config: { checks: ["typecheck", "test", "build"] } });
    const result = await gate.verify();

    assert.equal(result.proven, true);
    assert.equal(result.status, "proven");
    assert.equal(result.ranChecks.length, 3);
    assert.equal(result.skippedChecks.length, 1); // browser skipped
    assert.equal(checkById(result, "typecheck")?.status, "success");
    assert.equal(checkById(result, "test")?.status, "success");
    assert.equal(checkById(result, "build")?.status, "success");
    assert.equal(checkById(result, "browser")?.status, "skipped");
  });

  it("one check fails → proven: false, status: failed, stops at first failure", async () => {
    const cwd = makeTmpProject({ typecheck: "tsc --noEmit", test: "vitest run", build: "next build" });
    const shell = new MockShell(cwd);
    shell.setBehavior("npm", ["run", "typecheck"], { exitCode: 0, stdout: "ok" });
    shell.setBehavior("npm", ["run", "test"], { exitCode: 1, stderr: "test failed" });
    // build should NOT run because test failed (stop on first failure)
    const gate = makeGate(cwd, shell, { config: { checks: ["typecheck", "test", "build"] } });
    const result = await gate.verify();

    assert.equal(result.proven, false);
    assert.equal(result.status, "failed");
    assert.equal(checkById(result, "typecheck")?.status, "success");
    assert.equal(checkById(result, "test")?.status, "failed");
    assert.equal(checkById(result, "test")?.exitCode, 1);
    assert.equal(checkById(result, "test")?.stderr, "test failed");
    // build was never run — it's not in ranChecks
    assert.ok(!result.ranChecks.includes("build"));
  });

  it("missing checks are skipped, not failed — proven stays true if run checks pass", async () => {
    // Project with only a build script, no typecheck/test
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const gate = makeGate(cwd, shell); // auto-detect
    const result = await gate.verify();

    assert.equal(result.proven, true, JSON.stringify(result.checks));
    assert.equal(result.status, "proven");
    assert.ok(result.ranChecks.includes("build"));
    assert.ok(result.skippedChecks.includes("typecheck"));
    assert.ok(result.skippedChecks.includes("test"));
    assert.equal(checkById(result, "typecheck")?.status, "skipped");
    assert.equal(checkById(result, "test")?.status, "skipped");
  });

  it("no checks configured at all → status: skipped, proven: false", async () => {
    // No package.json scripts, no tsconfig, no browser
    const cwd = makeTmpProject({});
    const shell = new MockShell(cwd);
    const gate = makeGate(cwd, shell);
    const result = await gate.verify();

    assert.equal(result.proven, false);
    assert.equal(result.status, "skipped");
    assert.equal(result.ranChecks.length, 0);
    assert.ok(result.message.includes("not proven"));
  });

  it("browser check runs when verifier + URL provided", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const verifier = new MockBrowserVerifier(true);
    const gate = makeGate(cwd, shell, {
      browserVerifier: verifier,
      config: { checks: ["build", "browser"], browser: { url: "http://localhost:3000" } },
    });
    const result = await gate.verify();

    assert.equal(result.proven, true);
    assert.equal(checkById(result, "browser")?.status, "success");
    assert.ok(result.ranChecks.includes("browser"));
  });

  it("browser check fails when verifier reports errors → not proven", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const verifier = new MockBrowserVerifier(false, ["ReferenceError: x is not defined"]);
    const gate = makeGate(cwd, shell, {
      browserVerifier: verifier,
      config: { checks: ["build", "browser"], browser: { url: "http://localhost:3000" } },
    });
    const result = await gate.verify();

    assert.equal(result.proven, false);
    assert.equal(checkById(result, "browser")?.status, "failed");
    assert.ok((checkById(result, "browser")?.stderr ?? "").includes("ReferenceError"));
  });

  it("browser check skipped when no verifier available (even if URL configured)", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const gate = makeGate(cwd, shell, {
      browserVerifier: null,
      config: { checks: ["build", "browser"], browser: { url: "http://localhost:3000" } },
    });
    const result = await gate.verify();

    assert.equal(result.proven, true); // build passed, browser skipped
    assert.equal(checkById(result, "browser")?.status, "skipped");
    assert.ok(result.skippedChecks.includes("browser"));
  });

  it("auto-detects typecheck via tsconfig.json when no typecheck script", async () => {
    const cwd = makeTmpProject(
      { build: "next build" },
      { "tsconfig.json": '{"compilerOptions":{}}' },
    );
    const shell = new MockShell(cwd);
    shell.setBehavior("npx", ["tsc", "--noEmit"], { exitCode: 0, stdout: "no errors" });
    const gate = makeGate(cwd, shell);
    const result = await gate.verify();

    assert.equal(result.proven, true);
    assert.ok(result.ranChecks.includes("typecheck"));
    assert.equal(checkById(result, "typecheck")?.status, "success");
  });

  it("explicit checks list runs exactly those checks", async () => {
    const cwd = makeTmpProject({ typecheck: "tsc", test: "vitest", build: "next build" });
    const shell = new MockShell(cwd);
    const gate = makeGate(cwd, shell, { config: { checks: ["test"] } });
    const result = await gate.verify();

    assert.equal(result.ranChecks.length, 1);
    assert.equal(result.ranChecks[0], "test");
    assert.ok(result.skippedChecks.includes("typecheck"));
    assert.ok(result.skippedChecks.includes("build"));
  });

  it("command overrides take precedence over auto-detection", async () => {
    const cwd = makeTmpProject({ typecheck: "tsc" });
    const shell = new MockShell(cwd);
    shell.setBehavior("custom", ["check"], { exitCode: 0, stdout: "custom ok" });
    const gate = makeGate(cwd, shell, {
      config: { checks: ["typecheck"], commands: { typecheck: { command: "custom", args: ["check"] } } },
    });
    const result = await gate.verify();

    assert.equal(result.proven, true);
    assert.equal(checkById(result, "typecheck")?.status, "success");
  });

  it("sets runtime phase to verifying then complete when proven", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const store = new RuntimeStore();
    const gate = makeGate(cwd, shell, { store });
    await gate.verify();

    assert.equal(store.getState().phase, "complete");
  });

  it("sets runtime phase to failed when not proven", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    shell.setBehavior("npm", ["run", "build"], { exitCode: 2, stderr: "build broke" });
    const store = new RuntimeStore();
    const gate = makeGate(cwd, shell, { store });
    await gate.verify();

    assert.equal(store.getState().phase, "failed");
  });

  it("emits verification_start and verification_result events", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const cap = new EventCapture();
    const gate = makeGate(cwd, shell, { emitter: cap.emitter() });
    await gate.verify();

    const starts = cap.litt("verification_start");
    const results = cap.litt("verification_result");
    assert.ok(starts.length >= 1, "verification_start emitted");
    assert.ok(results.length >= 1, "verification_result emitted");
    assert.equal(results[0].data.proven, true);
  });

  it("emits per-check start and result events", async () => {
    const cwd = makeTmpProject({ typecheck: "tsc", build: "next build" });
    const shell = new MockShell(cwd);
    const cap = new EventCapture();
    const gate = makeGate(cwd, shell, { emitter: cap.emitter(), config: { checks: ["typecheck", "build"] } });
    await gate.verify();

    const checkStarts = cap.litt("verification_check_start");
    const checkResults = cap.litt("verification_check_result");
    assert.ok(checkStarts.length >= 2, "check_start for each check");
    assert.ok(checkResults.length >= 2, "check_result for each check");
  });

  it("cancelled check → not proven", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    shell.setBehavior("npm", ["run", "build"], { status: "cancelled" });
    const gate = makeGate(cwd, shell, { config: { checks: ["build"] } });
    const result = await gate.verify();

    assert.equal(result.proven, false);
    assert.equal(result.status, "failed");
    assert.equal(checkById(result, "build")?.status, "cancelled");
  });

  it("timeout check → not proven", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    shell.setBehavior("npm", ["run", "build"], { status: "timeout" });
    const gate = makeGate(cwd, shell, { config: { checks: ["build"] } });
    const result = await gate.verify();

    assert.equal(result.proven, false);
    assert.equal(checkById(result, "build")?.status, "timeout");
  });

  it("assertComplete returns the verification result unchanged", async () => {
    const cwd = makeTmpProject({ build: "next build" });
    const shell = new MockShell(cwd);
    const gate = makeGate(cwd, shell);
    const result = await gate.verify();
    const asserted = assertComplete(result);
    assert.equal(asserted, result);
    assert.equal(asserted.proven, true);
  });

  it("the honest-COMPLETE rule: proven is the ONLY truth, not a model claim", async () => {
    // A project where build fails. No matter what, proven must be false.
    const cwd = makeTmpProject({ typecheck: "tsc", build: "next build" });
    const shell = new MockShell(cwd);
    shell.setBehavior("npm", ["run", "build"], { exitCode: 1, stderr: "SyntaxError" });
    const gate = makeGate(cwd, shell);
    const result = await gate.verify();

    // Even though typecheck passed, build failed → NOT proven.
    assert.equal(result.proven, false);
    assert.equal(result.status, "failed");
    assert.ok(result.message.includes("NOT VERIFIED"));
  });
});

// ─── Duplicate expensive verification ──────────────────────────────
//
// Regression coverage for the duplicate-verification defect.
//
// In a live REMOTE mission the same `pnpm run test` ran three times at
// ~111-118s each, pushing the mission to ~472s. An identical check in
// an unchanged project cannot honestly produce a different answer, so
// it must execute once per generation; a mutation bumps the generation
// and makes prior evidence stale.

/** A shell that records how many times each command was executed. */
class CountingShell extends MockShell {
  readonly calls: string[] = [];
  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    this.calls.push(`${options.command} ${(options.args ?? []).join(" ")}`);
    return super.execute(options);
  }
  countOf(prefix: string): number {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  }
}

describe("VerificationEvidenceCache", () => {
  it("returns null for an unrecorded command", () => {
    const cache = new VerificationEvidenceCache();
    assert.equal(cache.get("pnpm", ["run", "test"], "/p"), null);
  });

  it("returns recorded evidence within the same generation", () => {
    const cache = new VerificationEvidenceCache();
    cache.record("pnpm", ["run", "test"], "/p", {
      status: "success", success: true, exitCode: 0, message: "ok", durationMs: 111_000,
    });
    assert.equal(cache.get("pnpm", ["run", "test"], "/p")?.success, true);
  });

  it("caches FAILED evidence too — a red suite stays red until something changes", () => {
    const cache = new VerificationEvidenceCache();
    cache.record("pnpm", ["run", "test"], "/p", {
      status: "failed", success: false, exitCode: 1, message: "exit 1", durationMs: 118_000,
    });
    const hit = cache.get("pnpm", ["run", "test"], "/p");
    assert.equal(hit?.success, false);
    assert.equal(hit?.exitCode, 1);
  });

  it("invalidate() makes prior evidence stale", () => {
    const cache = new VerificationEvidenceCache();
    cache.record("pnpm", ["run", "test"], "/p", {
      status: "success", success: true, exitCode: 0, message: "ok", durationMs: 1,
    });
    assert.notEqual(cache.get("pnpm", ["run", "test"], "/p"), null);
    cache.invalidate();
    assert.equal(cache.get("pnpm", ["run", "test"], "/p"), null);
  });

  it("distinguishes different commands, args and cwds", () => {
    const cache = new VerificationEvidenceCache();
    cache.record("pnpm", ["run", "test"], "/p", {
      status: "success", success: true, exitCode: 0, message: "ok", durationMs: 1,
    });
    assert.equal(cache.get("pnpm", ["run", "build"], "/p"), null);
    assert.equal(cache.get("npm", ["run", "test"], "/p"), null);
    assert.equal(cache.get("pnpm", ["run", "test"], "/other"), null);
  });
});

describe("VerificationGate — no duplicate expensive checks", () => {
  it("D. the same test command requested twice in one mission executes ONCE", async () => {
    const dir = makeTmpProject({ test: "vitest run" }, { "pnpm-lock.yaml": "" });
    const shell = new CountingShell(dir);
    const cache = new VerificationEvidenceCache();
    const executor = new CommandExecutor(shell, null, null);
    const gate = createVerificationGate({
      executor, shell, cwd: dir,
      config: { checks: ["test"] },
      evidenceCache: cache,
    });

    const first = await gate.verify();
    const second = await gate.verify();

    assert.equal(first.proven, true);
    assert.equal(second.proven, true);
    // The expensive command ran exactly once across both verifications.
    assert.equal(shell.countOf("pnpm run test"), 1);
    assert.ok(!checkById(first, "test")?.reused);
    assert.equal(checkById(second, "test")?.reused, true);
    assert.ok(checkById(second, "test")?.message.includes("reused"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("D2. a failing check is not re-run either — it reports the same failure", async () => {
    const dir = makeTmpProject({ test: "vitest run" }, { "pnpm-lock.yaml": "" });
    const shell = new CountingShell(dir);
    shell.setBehavior("pnpm", ["run", "test"], { exitCode: 1, status: "failed", stderr: "2 failed" });
    const cache = new VerificationEvidenceCache();
    const executor = new CommandExecutor(shell, null, null);
    const gate = createVerificationGate({
      executor, shell, cwd: dir,
      config: { checks: ["test"] },
      evidenceCache: cache,
    });

    const first = await gate.verify();
    const second = await gate.verify();

    assert.equal(first.proven, false);
    assert.equal(second.proven, false);
    assert.equal(checkById(second, "test")?.exitCode, 1);
    assert.equal(shell.countOf("pnpm run test"), 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("D3. a mutation invalidates the evidence and the check runs again", async () => {
    const dir = makeTmpProject({ test: "vitest run" }, { "pnpm-lock.yaml": "" });
    const shell = new CountingShell(dir);
    const cache = new VerificationEvidenceCache();
    const executor = new CommandExecutor(shell, null, null);
    const gate = createVerificationGate({
      executor, shell, cwd: dir,
      config: { checks: ["test"] },
      evidenceCache: cache,
    });

    await gate.verify();
    assert.equal(shell.countOf("pnpm run test"), 1);

    // The project changed — prior evidence could now genuinely be wrong.
    cache.invalidate();
    const afterChange = await gate.verify();

    assert.equal(shell.countOf("pnpm run test"), 2);
    assert.ok(!checkById(afterChange, "test")?.reused);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("D4. without a cache the gate behaves exactly as before (re-runs)", async () => {
    const dir = makeTmpProject({ test: "vitest run" }, { "pnpm-lock.yaml": "" });
    const shell = new CountingShell(dir);
    const executor = new CommandExecutor(shell, null, null);
    const gate = createVerificationGate({
      executor, shell, cwd: dir,
      config: { checks: ["test"] },
    });

    await gate.verify();
    await gate.verify();
    assert.equal(shell.countOf("pnpm run test"), 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("D5. evidence recorded by a surface spares the gate the first run", async () => {
    const dir = makeTmpProject({ test: "vitest run" }, { "pnpm-lock.yaml": "" });
    const shell = new CountingShell(dir);
    const cache = new VerificationEvidenceCache();
    const executor = new CommandExecutor(shell, null, null);
    const gate = createVerificationGate({
      executor, shell, cwd: dir,
      config: { checks: ["test"] },
      evidenceCache: cache,
    });

    // The model already ran project.test itself; the surface records it
    // against the command the gate would use.
    const cmd = gate.resolveCheckCommand("test");
    assert.deepEqual(cmd, { command: "pnpm", args: ["run", "test"] });
    cache.record(cmd!.command, cmd!.args, dir, {
      status: "failed", success: false, exitCode: 1, message: "exit 1", durationMs: 111_000,
    });

    const result = await gate.verify();
    assert.equal(shell.countOf("pnpm run test"), 0); // never re-run
    assert.equal(result.proven, false);
    assert.equal(checkById(result, "test")?.reused, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
