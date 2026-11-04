/**
 * Regression tests for the independent security review of the repair
 * pipeline. Each block names the review finding it pins down.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProvider } from "@litt/agent-core";
import { repairCommand, type RepairPipelineDeps } from "../commands/repair.js";
import { formatPatchSummary } from "../lib/repair/approve.js";
import { repairCommandSchema, repairJobSchema } from "../lib/repair/contracts.js";
import { diagnoseFailure } from "../lib/repair/diagnose.js";
import { runEvidenceCommand } from "../lib/repair/command-runner.js";
import { applyContextPatches } from "../lib/repair/patch.js";
import { createRepairReport, digestRepairJob, repairReportPath, writeRepairReport } from "../lib/repair/report.js";
import type { RepairProviderHandle } from "../lib/repair/provider.js";
import type { RepairReport } from "../lib/repair/contracts.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import {
  loadSnapshots,
  persistSnapshots,
  repairSnapshotPath,
  restoreSnapshots,
  snapshotPatchTargets,
} from "../lib/repair/snapshot.js";
import { hasUnsafePathSyntax, isProtectedRepairPath } from "../lib/repair/workspace-policy.js";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litt-hardening-"));
  scratch.push(dir);
  return dir;
}

describe("review finding: shell interpreters, destructive and outward-facing commands", () => {
  const parse = (command: string, args: string[] = []) =>
    repairCommandSchema.safeParse({ command, args });

  it.each(["sh", "bash", "cmd", "cmd.exe", "powershell", "pwsh.exe", "wsl"])(
    "rejects interpreter %s because it turns argv back into a shell script",
    (command) => expect(parse(command, ["-c", "echo hi"]).success).toBe(false),
  );

  it.each(["rm", "del", "rmdir", "format", "sudo", "taskkill"])(
    "rejects destructive command %s",
    (command) => expect(parse(command, ["x"]).success).toBe(false),
  );

  it("rejects git push, remote and credential operations but allows git status", () => {
    expect(parse("git", ["push", "--force"]).success).toBe(false);
    expect(parse("git", ["remote", "add", "x", "y"]).success).toBe(false);
    expect(parse("git", ["status", "--short"]).success).toBe(true);
  });

  it("rejects package publishing and deploy tools", () => {
    expect(parse("pnpm", ["publish"]).success).toBe(false);
    expect(parse("npm", ["publish", "--access", "public"]).success).toBe(false);
    expect(parse("vercel", ["--prod"]).success).toBe(false);
    expect(parse("railway", ["up"]).success).toBe(false);
  });

  it("rejects cmd.exe metacharacters in arguments of .cmd-shim commands", () => {
    expect(parse("pnpm", ["test", "& del *"]).success).toBe(false);
    expect(parse("npm", ["run", "x|y"]).success).toBe(false);
    expect(parse("pnpm", ["test", "%PATH%"]).success).toBe(false);
    expect(parse("pnpm", ["exec", "vitest", "run", "src/a.test.ts"]).success).toBe(true);
  });

  it("applies the deny rules inside a full repair job", () => {
    const job = {
      version: 1,
      incident: "a job that tries to run a shell",
      reproduction: {
        command: { command: "bash", args: ["-c", "exit 1"] },
        expectedFailure: { stream: "any", includes: "x" },
      },
      regression: { path: "t.cjs", command: { command: "node", args: ["t.cjs"] } },
      editablePaths: ["src"],
      checks: [{ name: "f", kind: "focused", command: { command: "node", args: ["t.cjs"] } }],
    };
    expect(repairJobSchema.safeParse(job).success).toBe(false);
  });
});

describe("review finding: protected and unsafe paths were only checked at the workspace root", () => {
  it.each(["src/.env", "src/.env.production", "app/.git/config", "pkg/credentials/key.json", "src/backups/a.txt", ".litt/repairs/x/report.json"])(
    "treats %s as protected",
    (path) => expect(isProtectedRepairPath(path)).toBe(true),
  );

  it("does not flag ordinary source files", () => {
    expect(isProtectedRepairPath("src/environment.ts")).toBe(false);
    expect(isProtectedRepairPath("src/state.txt")).toBe(false);
  });

  it.each(["src/a.txt:stream", "src/nul", "src/con.txt", "src/trailing.", "src/trailing "])(
    "flags unsafe Windows path syntax in %s",
    (path) => expect(hasUnsafePathSyntax(path)).toBe(true),
  );

  it("refuses to patch a nested .env even though src is editable", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", ".env"), "TOKEN=abc\n", "utf8");
    await expect(
      applyContextPatches(root, [{ operation: "replace", path: "src/.env", search: "abc", replacement: "x" }], ["src"]),
    ).rejects.toThrow(/Protected path/);
    expect(await readFile(join(root, "src", ".env"), "utf8")).toBe("TOKEN=abc\n");
  });

  it("refuses an alternate data stream path", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.txt"), "hello\n", "utf8");
    await expect(
      applyContextPatches(root, [{ operation: "create", path: "src/a.txt:hidden", content: "x" }], ["src"]),
    ).rejects.toThrow(/Unsafe path syntax/);
  });
});

describe("review finding: a symlinked target could be written through to outside the workspace", () => {
  it("refuses to patch a symlink and leaves the outside file untouched", async (context) => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(outside, "secret.txt"), "outside\n", "utf8");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "src", "link.txt"));
    } catch (error) {
      // Windows without Developer Mode cannot create symlinks; report as skipped, not passed.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip();
      throw error;
    }
    await expect(
      applyContextPatches(root, [{ operation: "replace", path: "src/link.txt", search: "outside", replacement: "pwned" }], ["src"]),
    ).rejects.toThrow(/Symbolic link/);
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("outside\n");
  });
});

describe("review finding: approval showed byte counts, not the content to be written", () => {
  it("shows removed and inserted text and redacts secrets", () => {
    const summary = formatPatchSummary([
      { operation: "replace", path: "src/a.ts", search: "const mode = 'old';", replacement: "const mode = 'new'; // key sk_live_abcdefghijklmnop1234" },
      { operation: "create", path: "src/b.ts", content: "export const created = true;\n" },
    ]);
    expect(summary).toContain("const mode = 'old';");
    expect(summary).toContain("const mode = 'new';");
    expect(summary).toContain("export const created = true;");
    expect(summary).not.toContain("sk_live_abcdefghijklmnop1234");
  });

  it("neutralizes terminal control characters in previews", () => {
    const summary = formatPatchSummary([
      { operation: "create", path: "src/c.ts", content: "ok\u001b[2Jcleared" },
    ]);
    expect(summary).not.toContain("\u001b");
  });
});

describe("review finding: snapshots were never persisted and could capture rejected targets", () => {
  it("does not snapshot protected, escaping or unsafe targets", async () => {
    const root = await tempDir();
    await writeFile(join(root, ".env"), "TOKEN=abc\n", "utf8");
    const snapshots = await snapshotPatchTargets(root, [
      { operation: "replace", path: ".env", search: "abc", replacement: "x" },
      { operation: "create", path: "../escape.txt", content: "x" },
      { operation: "create", path: "src/a.txt:s", content: "x" },
    ]);
    expect(snapshots).toEqual([]);
  });

  it("round-trips persisted snapshots and restores prior bytes", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.txt"), "before\n", "utf8");
    const snapshots = await snapshotPatchTargets(root, [
      { operation: "replace", path: "src/a.txt", search: "before", replacement: "after" },
      { operation: "create", path: "src/new.txt", content: "x" },
    ]);
    const path = repairSnapshotPath(join(root, ".litt", "repairs", "run-1", "report.json"));
    await persistSnapshots(path, snapshots);
    await writeFile(join(root, "src", "a.txt"), "after\n", "utf8");
    await writeFile(join(root, "src", "new.txt"), "x", "utf8");

    const loaded = await loadSnapshots(path);
    expect(loaded).toEqual(snapshots);
    const outcome = await restoreSnapshots(root, loaded ?? []);
    expect(outcome.failed).toEqual([]);
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("before\n");
    await expect(readFile(join(root, "src", "new.txt"), "utf8")).rejects.toThrow();
  });

  it("keeps restoring remaining files when one cannot be restored, and reports it", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "good.txt"), "after\n", "utf8");
    const outcome = await restoreSnapshots(root, [
      { path: "src/good.txt", previous: "before\n" },
      { path: "src/missing-dir/bad.txt", previous: "x" },
    ]);
    expect(outcome.failed.map((f) => f.path)).toEqual(["src/missing-dir/bad.txt"]);
    expect(await readFile(join(root, "src", "good.txt"), "utf8")).toBe("before\n");
  });
});

// ─── pipeline-level findings ───────────────────────────────────────

function stubProvider(proposal: object, beforeReturn?: () => void) {
  const provider: ModelProvider = {
    stream: async (_m, emit) => {
      const text = JSON.stringify(proposal);
      emit({ type: "delta", text });
      beforeReturn?.();
      return {
        content: text, model: "stub", provider: "stub", usage: { total_tokens: 1 },
        timing: { ttftMs: 0, generationMs: 0, totalMs: 0 }, profile: "smart" as const,
      };
    },
    health: async () => 0,
  };
  const handle: RepairProviderHandle = { provider, modelId: "stub", label: "stub", providerId: "stub", local: true };
  return { ok: true as const, handle };
}

const FIX = {
  rootCause: "state.txt holds a BROKEN marker; flip it to healthy.",
  patches: [{ operation: "replace", path: "src/state.txt", search: "status=BROKEN", replacement: "status=HEALTHY" }],
};

interface PipelineSetup {
  regression?: string;
  extraCheck?: string;
}

async function pipelineWorkspace(setup: PipelineSetup = {}): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "src", "state.txt"), "status=BROKEN\n", "utf8");
  await writeFile(
    join(root, "repro.cjs"),
    "const s=require('fs').readFileSync('src/state.txt','utf8');if(s.includes('BROKEN')){console.error('BROKEN-SIGNATURE');process.exit(1)}\n",
    "utf8",
  );
  await writeFile(
    join(root, "tests", "regression.cjs"),
    setup.regression ?? "const s=require('fs').readFileSync('src/state.txt','utf8');process.exit(s.includes('BROKEN')?1:0);\n",
    "utf8",
  );
  if (setup.extraCheck) await writeFile(join(root, "extra.cjs"), setup.extraCheck, "utf8");
  const node = (script: string) => ({ command: "node", args: [script], timeoutMs: 10_000 });
  const checks: object[] = [{ name: "regression", kind: "focused", command: node("tests/regression.cjs") }];
  if (setup.extraCheck) checks.push({ name: "extra", kind: "lint", command: node("extra.cjs") });
  await writeFile(join(root, "job.json"), JSON.stringify({
    version: 1,
    incident: "state.txt contains a BROKEN marker.",
    reproduction: { command: node("repro.cjs"), expectedFailure: { stream: "stderr", includes: "BROKEN-SIGNATURE" } },
    regression: { path: "tests/regression.cjs", command: node("tests/regression.cjs") },
    editablePaths: ["src", "tests"],
    checks,
  }), "utf8");
  return root;
}

async function runStart(root: string, deps: RepairPipelineDeps, extra: string[] = ["--yes"]) {
  const session = { getCwd: () => root } as RuntimeSession;
  return repairCommand(["start", "--job", "job.json", ...extra], session, undefined, deps);
}

async function readOnlyReport(root: string): Promise<{ runId: string; report: RepairReport }> {
  const { readdir } = await import("node:fs/promises");
  const [runId] = await readdir(join(root, ".litt", "repairs"));
  const report = JSON.parse(await readFile(join(root, ".litt", "repairs", runId, "report.json"), "utf8")) as RepairReport;
  return { runId, report };
}

describe("review finding: Ctrl+C mid-validation left the patch applied with no rollback", () => {
  it("rolls the patch back and reports interrupted when the signal aborts after patching", async () => {
    const root = await pipelineWorkspace();
    const interrupt = new AbortController();
    const code = await runStart(root, {
      resolveProvider: async () => stubProvider(FIX, () => interrupt.abort()),
      isTTY: () => false,
      signal: interrupt.signal,
    });
    expect(code).toBe(4);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
    const { report } = await readOnlyReport(root);
    expect(report.stage).toBe("failed");
    expect(report.blockReason).toBe("interrupted");
    expect(report.remainingRisks.join(" ")).toContain("workspace restored");
  });
});

describe("review finding: unrelated changes were never detected (field always empty)", () => {
  it("does not report complete when a check writes a file outside the approved patch", async () => {
    const root = await pipelineWorkspace({ extraCheck: "require('fs').writeFileSync('stray.txt','side effect');\n" });
    const code = await runStart(root, { resolveProvider: async () => stubProvider(FIX), isTTY: () => false });
    expect(code).toBe(5);
    const { report } = await readOnlyReport(root);
    expect(report.stage).toBe("partially-verified");
    expect(report.blockReason).toBe("unrelated-changes");
    expect(report.unrelatedChanges).toEqual(["stray.txt"]);
    // Reported, never silently deleted.
    expect(await readFile(join(root, "stray.txt"), "utf8")).toBe("side effect");
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=HEALTHY\n");
  });
});

describe("review finding: COMPLETE was reachable when the regression test was already green", () => {
  it("downgrades to partially-verified when the regression command never failed before the fix", async () => {
    const root = await pipelineWorkspace({ regression: "process.exit(0);\n" });
    const code = await runStart(root, { resolveProvider: async () => stubProvider(FIX), isTTY: () => false });
    expect(code).toBe(5);
    const { report } = await readOnlyReport(root);
    expect(report.stage).toBe("partially-verified");
    expect(report.blockReason).toBe("regression-coverage");
  });
});

describe("review finding: the declared regression command only ran post-patch if repeated as a check", () => {
  it("rolls back when the regression command fails after patching even though no check repeats it", async () => {
    // The regression command passes only while the file still says BROKEN, so the fix breaks it.
    const root = await pipelineWorkspace({ regression: "const s=require('fs').readFileSync('src/state.txt','utf8');process.exit(s.includes('BROKEN')?0:1);\n" });
    const job = JSON.parse(await readFile(join(root, "job.json"), "utf8"));
    job.checks = [{ name: "noop", kind: "focused", command: { command: "node", args: ["repro.cjs"], timeoutMs: 10_000 } }];
    await writeFile(join(root, "job.json"), JSON.stringify(job), "utf8");
    const code = await runStart(root, { resolveProvider: async () => stubProvider(FIX), isTTY: () => false });
    expect(code).toBe(4);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
  });
});

describe("review finding: resume trusted any job file and lost rollback state", () => {
  it("refuses to resume with a different job than the run started with", async () => {
    const root = await pipelineWorkspace();
    const deps: RepairPipelineDeps = { resolveProvider: async () => stubProvider(FIX), isTTY: () => false };
    expect(await runStart(root, deps, [])).toBe(3); // parks for approval
    const { runId } = await readOnlyReport(root);

    const job = JSON.parse(await readFile(join(root, "job.json"), "utf8"));
    job.editablePaths = ["src", "tests", "extra"];
    await writeFile(join(root, "job.json"), JSON.stringify(job), "utf8");
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["resume", "--run", runId, "--job", "job.json", "--yes"], session, undefined, deps);
    expect(code).toBe(2);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
  });

  it("restores from the persisted snapshot when a resumed validation fails", async () => {
    const root = await pipelineWorkspace({ regression: "process.exit(1);\n" });
    const job = repairJobSchema.parse(JSON.parse(await readFile(join(root, "job.json"), "utf8")));
    const runId = "repair-crashed";
    const outputPath = repairReportPath(root, runId);
    const report = createRepairReport(job, runId);
    report.stage = "focused-validation";
    report.filesChanged = ["src/state.txt"];
    await writeRepairReport(outputPath, report);
    // The crashed run had already patched the file and persisted the prior bytes.
    await writeFile(join(root, "src", "state.txt"), "status=HEALTHY\n", "utf8");
    await persistSnapshots(repairSnapshotPath(outputPath), [{ path: "src/state.txt", previous: "status=BROKEN\n" }]);
    expect(report.jobDigest).toBe(digestRepairJob(job));

    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(
      ["resume", "--run", runId, "--job", "job.json", "--yes"], session, undefined, { isTTY: () => false },
    );
    expect(code).toBe(4);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
    const saved = JSON.parse(await readFile(outputPath, "utf8")) as RepairReport;
    expect(saved.remainingRisks.join(" ")).toContain("workspace restored");
  });

  it("says rollback is impossible, instead of claiming restoration, when snapshots are missing", async () => {
    const root = await pipelineWorkspace({ regression: "process.exit(1);\n" });
    const job = repairJobSchema.parse(JSON.parse(await readFile(join(root, "job.json"), "utf8")));
    const runId = "repair-no-snapshot";
    const outputPath = repairReportPath(root, runId);
    const report = createRepairReport(job, runId);
    report.stage = "focused-validation";
    report.filesChanged = ["src/state.txt"];
    await writeRepairReport(outputPath, report);

    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(
      ["resume", "--run", runId, "--job", "job.json", "--yes"], session, undefined, { isTTY: () => false },
    );
    expect(code).toBe(4);
    const saved = JSON.parse(await readFile(outputPath, "utf8")) as RepairReport;
    const risks = saved.remainingRisks.join(" ");
    expect(risks).toContain("NO ROLLBACK POSSIBLE");
    expect(risks).not.toContain("workspace restored");
  });
});

describe("review finding: --run accepted path separators and could leave .litt/repairs", () => {
  it("rejects traversal-shaped run ids before touching the filesystem", async () => {
    const root = await pipelineWorkspace();
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(
      ["resume", "--run", "../../outside/report", "--job", "job.json", "--yes"], session, undefined, { isTTY: () => false },
    );
    expect(code).toBe(2);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
  });
});

describe("review finding: the diagnoser sent protected files inside editable scopes to the model", () => {
  it("never includes a nested .env or credentials file in the model prompt", async () => {
    const root = await pipelineWorkspace();
    await writeFile(join(root, "src", ".env"), "DATABASE_PASSWORD=hunter2-not-a-known-pattern\n", "utf8");
    await mkdir(join(root, "src", "credentials"), { recursive: true });
    await writeFile(join(root, "src", "credentials", "key.txt"), "PRIVATE-MATERIAL\n", "utf8");

    const job = repairJobSchema.parse(JSON.parse(await readFile(join(root, "job.json"), "utf8")));
    let prompt = "";
    const provider: ModelProvider = {
      stream: async (messages, emit) => {
        prompt = messages.map((m) => String(m.content)).join("\n");
        const text = JSON.stringify(FIX);
        emit({ type: "delta", text });
        return {
          content: text, model: "stub", provider: "stub", usage: { total_tokens: 1 },
          timing: { ttftMs: 0, generationMs: 0, totalMs: 0 }, profile: "smart" as const,
        };
      },
      health: async () => 0,
    };
    const evidence = {
      name: "original failure", command: "node", args: ["repro.cjs"], cwd: root, status: "failed" as const,
      exitCode: 1, signal: null, stdout: "", stderr: "BROKEN-SIGNATURE", stdoutTruncated: false,
      stderrTruncated: false, startedAt: new Date().toISOString(), durationMs: 1,
    };
    const outcome = await diagnoseFailure(
      root, job, evidence, { provider, modelId: "stub", label: "stub", providerId: "stub", local: true },
    );

    expect(outcome.ok).toBe(true);
    expect(prompt).toContain("status=BROKEN");
    expect(prompt).not.toContain("hunter2-not-a-known-pattern");
    expect(prompt).not.toContain("PRIVATE-MATERIAL");
  });
});

describe("review finding: a stale temp file from a crashed run broke report persistence", () => {
  it("overwrites a leftover report temp file instead of failing", async () => {
    const root = await tempDir();
    const job = repairJobSchema.parse({
      version: 1,
      incident: "stale temp file scenario",
      reproduction: { command: { command: "node", args: ["r.cjs"] }, expectedFailure: { stream: "any", includes: "x" } },
      regression: { path: "t.cjs", command: { command: "node", args: ["t.cjs"] } },
      editablePaths: ["src"],
      checks: [{ name: "f", kind: "focused", command: { command: "node", args: ["t.cjs"] } }],
    });
    const path = repairReportPath(root, "repair-stale");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path + ".tmp-" + process.pid, "stale partial write", "utf8");

    await expect(writeRepairReport(path, createRepairReport(job, "repair-stale"))).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path, "utf8")).runId).toBe("repair-stale");
  });
});

describe("review finding: OpenAI/GitHub/JWT secrets passed the redactor unmasked", () => {
  const FAKE_LONG = "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";
  const FAKE_OPENAI = "sk-" + "proj-" + FAKE_LONG;
  const FAKE_GHP = "ghp_" + FAKE_LONG;
  const FAKE_JWT = "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" + "." +
    "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + "." + "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";

  it("strips all three classes from approval previews", () => {
    const summary = formatPatchSummary([
      { operation: "replace", path: "src/a.ts", search: "x", replacement: `key=${FAKE_OPENAI} pat=${FAKE_GHP} jwt=${FAKE_JWT}` },
    ]);
    expect(summary).not.toContain(FAKE_OPENAI);
    expect(summary).not.toContain(FAKE_GHP);
    expect(summary).not.toContain(FAKE_JWT);
  });

  it("strips all three classes from command evidence (logs and persisted stdout/stderr)", async () => {
    const shell = {
      execute: async () => ({
        command: "node", args: ["x.cjs"], cwd: "/w", status: "failed" as const,
        exitCode: 1, pid: 1, error: null,
        stdout: `openai=${FAKE_OPENAI}`, stderr: `gh=${FAKE_GHP} jwt=${FAKE_JWT}`,
        truncated: false, durationMs: 1,
      }),
      cancel: async () => undefined,
    };
    const evidence = await runEvidenceCommand(
      { command: "node", args: ["x.cjs"], timeoutMs: 5000 },
      { name: "t", cwd: "/w", shell },
    );
    expect(evidence.stdout).not.toContain(FAKE_OPENAI);
    expect(evidence.stderr).not.toContain(FAKE_GHP);
    expect(evidence.stderr).not.toContain(FAKE_JWT);
  });

  it("strips all three classes from file content bound for the model prompt", async () => {
    const root = await pipelineWorkspace();
    await writeFile(join(root, "src", "leaky.ts"), `export const a = "${FAKE_OPENAI}";\nexport const b = "${FAKE_GHP}";\nexport const c = "${FAKE_JWT}";\n`, "utf8");
    const job = repairJobSchema.parse(JSON.parse(await readFile(join(root, "job.json"), "utf8")));
    let prompt = "";
    const provider: ModelProvider = {
      stream: async (messages, emit) => {
        prompt = messages.map((m) => String(m.content)).join("\n");
        emit({ type: "delta", text: JSON.stringify(FIX) });
        return {
          content: JSON.stringify(FIX), model: "stub", provider: "stub", usage: { total_tokens: 1 },
          timing: { ttftMs: 0, generationMs: 0, totalMs: 0 }, profile: "smart" as const,
        };
      },
      health: async () => 0,
    };
    const evidence = {
      name: "original failure", command: "node", args: ["repro.cjs"], cwd: root, status: "failed" as const,
      exitCode: 1, signal: null, stdout: "", stderr: "BROKEN-SIGNATURE", stdoutTruncated: false,
      stderrTruncated: false, startedAt: new Date().toISOString(), durationMs: 1,
    };
    const outcome = await diagnoseFailure(
      root, job, evidence, { provider, modelId: "stub", label: "stub", providerId: "stub", local: true },
    );
    expect(outcome.ok).toBe(true);
    expect(prompt).not.toContain(FAKE_OPENAI);
    expect(prompt).not.toContain(FAKE_GHP);
    expect(prompt).not.toContain(FAKE_JWT);
  });
});
