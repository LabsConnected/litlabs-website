/**
 * End-to-end repair pipeline coverage — real temp workspaces, real command
 * execution, a stub provider that returns a canned proposal. The model call
 * is the only thing faked (it's not what we're proving); every stage gate,
 * file mutation, rollback, and report write is real.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProvider } from "@litt/agent-core";
import { repairCommand, type RepairPipelineDeps } from "../commands/repair.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RepairReport } from "../lib/repair/contracts.js";
import type { RepairProviderHandle, RepairProviderOutcome } from "../lib/repair/provider.js";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function stubProvider(proposal: object): RepairProviderOutcome {
  const provider: ModelProvider = {
    stream: async (_m, emit) => {
      const text = JSON.stringify(proposal);
      emit({ type: "delta", text });
      return {
        content: text,
        model: "stub-coder",
        provider: "stub",
        usage: { total_tokens: 1 },
        timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
        profile: "smart" as const,
      };
    },
    health: async () => 0,
  };
  const handle: RepairProviderHandle = { provider, modelId: "stub", label: "stub", providerId: "stub", local: true };
  return { ok: true, handle };
}

const noTTY = () => false;

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litt-repair-e2e-"));
  scratch.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "src", "state.txt"), "status=BROKEN\n", "utf8");
  await writeFile(
    join(root, "repro.cjs"),
    "const fs=require('fs');const s=fs.readFileSync('src/state.txt','utf8');if(s.includes('BROKEN')){console.error('BROKEN-SIGNATURE: state is broken');process.exit(1)}console.log('healthy');\n",
    "utf8",
  );
  await writeFile(
    join(root, "tests", "regression.cjs"),
    "const fs=require('fs');const s=fs.readFileSync('src/state.txt','utf8');process.exit(s.includes('BROKEN')?1:0);\n",
    "utf8",
  );
  return root;
}

function jobFile(root: string): Promise<string> {
  const job = {
    version: 1,
    incident: "state.txt contains a BROKEN marker that crashes the CLI.",
    reproduction: {
      command: { command: "node", args: ["repro.cjs"], timeoutMs: 5_000 },
      expectedFailure: { stream: "stderr", includes: "BROKEN-SIGNATURE" },
    },
    regression: {
      path: "tests/regression.cjs",
      command: { command: "node", args: ["tests/regression.cjs"], timeoutMs: 5_000 },
    },
    editablePaths: ["src", "tests"],
    checks: [{
      name: "regression",
      kind: "focused",
      required: true,
      command: { command: "node", args: ["tests/regression.cjs"], timeoutMs: 5_000 },
    }],
  };
  return writeFile(join(root, "repair-job.json"), JSON.stringify(job), "utf8").then(() => "repair-job.json");
}

const FIX_PROPOSAL = {
  rootCause: "state.txt holds a BROKEN marker; flip it to a healthy status.",
  patches: [{ operation: "replace", path: "src/state.txt", search: "status=BROKEN", replacement: "status=HEALTHY" }],
};

const NOOP_PROPOSAL = {
  rootCause: "A comment explains the broken marker but does not remove it.",
  patches: [{ operation: "replace", path: "src/state.txt", search: "status=BROKEN", replacement: "status=BROKEN # noted" }],
};

async function reports(root: string) {
  const dir = join(root, ".litt", "repairs");
  const runs = await readdir(dir).catch(() => [] as string[]);
  const out = [] as { runId: string; report: RepairReport }[];
  for (const runId of runs) {
    const raw = await readFile(join(dir, runId, "report.json"), "utf8").catch(() => null);
    if (raw) out.push({ runId, report: JSON.parse(raw) });
  }
  return out;
}

describe("repair pipeline end-to-end", () => {
  it("reproduce → diagnose → approve → patch → verify → complete", async () => {
    const root = await workspace();
    const jobArg = await jobFile(root);
    const deps: RepairPipelineDeps = {
      resolveProvider: async () => stubProvider(FIX_PROPOSAL),
      isTTY: noTTY,
    };
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", jobArg, "--yes"], session, undefined, deps);
    expect(code).toBe(0);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=HEALTHY\n");
    const [run] = await reports(root);
    expect(run.report.stage).toBe("complete");
    expect(run.report.filesChanged).toEqual(["src/state.txt"]);
    expect(run.report.independentVerification[0].exitCode).toBe(0);
  }, 60_000);

  it("parks at partially-verified without approval, then resume completes it", async () => {
    const root = await workspace();
    const jobArg = await jobFile(root);
    const deps: RepairPipelineDeps = {
      resolveProvider: async () => stubProvider(FIX_PROPOSAL),
      isTTY: noTTY,
    };
    const session = { getCwd: () => root } as RuntimeSession;
    const code1 = await repairCommand(["start", "--job", jobArg], session, undefined, deps);
    expect(code1).toBe(3);
    // No patch applied while parked.
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
    const [run] = await reports(root);
    expect(run.report.stage).toBe("partially-verified");
    const code2 = await repairCommand(
      ["resume", "--run", run.runId, "--job", jobArg, "--yes"],
      session,
      undefined,
      deps,
    );
    expect(code2).toBe(0);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=HEALTHY\n");
  }, 60_000);

  it("restores the original file when verification still reproduces the failure", async () => {
    const root = await workspace();
    const jobArg = await jobFile(root);
    const deps: RepairPipelineDeps = {
      resolveProvider: async () => stubProvider(NOOP_PROPOSAL),
      isTTY: noTTY,
    };
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", jobArg, "--yes"], session, undefined, deps);
    expect(code).toBe(4);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
    const [run] = await reports(root);
    expect(run.report.stage).toBe("failed");
    expect(run.report.remainingRisks.join(" ")).toContain("restored");
  }, 60_000);

  it("provider exhaustion blocks truthfully — never looks like a failed repair", async () => {
    const root = await workspace();
    const jobArg = await jobFile(root);
    const deps: RepairPipelineDeps = {
      resolveProvider: async () => ({
        ok: false,
        reason: "billing",
        error: "OpenRouter returned insufficient credits",
      }),
      isTTY: noTTY,
    };
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", jobArg, "--yes"], session, undefined, deps);
    expect(code).toBe(3);
    const [run] = await reports(root);
    expect(run.report.stage).toBe("blocked");
    expect(run.report.blockReason).toBe("billing");
    expect(run.report.filesChanged).toEqual([]);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe("status=BROKEN\n");
  }, 60_000);

  it("blocks when the reproduction does not produce the expected failure", async () => {
    const root = await workspace();
    const jobArg = await jobFile(root);
    await writeFile(join(root, "src", "state.txt"), "status=HEALTHY\n", "utf8");
    const deps: RepairPipelineDeps = {
      resolveProvider: async () => stubProvider(FIX_PROPOSAL),
      isTTY: noTTY,
    };
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", jobArg, "--yes"], session, undefined, deps);
    expect(code).toBe(1);
    const [run] = await reports(root);
    expect(run.report.stage).toBe("blocked");
    expect(run.report.blockReason).toBe("reproduction");
  }, 60_000);

  it("rejects a malformed job before touching the workspace", async () => {
    const root = await workspace();
    await writeFile(join(root, "bad-job.json"), JSON.stringify({ version: 2 }), "utf8");
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", "bad-job.json", "--yes"], session, undefined, {
      resolveProvider: async () => stubProvider(FIX_PROPOSAL),
      isTTY: noTTY,
    });
    expect(code).toBe(2);
    expect(await reports(root)).toEqual([]);
  }, 30_000);
});
