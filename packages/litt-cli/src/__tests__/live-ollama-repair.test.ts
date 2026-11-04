/**
 * LIVE repair against a real local Ollama model — no stubbed provider.
 *
 * Run: LITT_RUN_LIVE_OLLAMA=1 pnpm exec vitest run src/__tests__/live-ollama-repair.test.ts
 *
 * Two scenarios, both through the real pipeline (real provider resolution,
 * real model call, real patching, real validation):
 *
 *   solvable    — a trivial one-line fix the model can plausibly propose.
 *                 PASS means the pipeline reached `complete` with independent
 *                 verification, OR the model's proposal was wrong and the
 *                 pipeline rolled back cleanly. Which one happened is printed;
 *                 only `complete` demonstrates a live repair.
 *   unfixable   — the regression demands a value the model cannot know, so a
 *                 patch is proposed, applied, rejected by validation, and MUST
 *                 be rolled back byte-for-byte. This proves rollback after a
 *                 real unsuccessful repair.
 *
 * If the daemon or model is unavailable the tests are skipped and the reason
 * is printed as BLOCKED — a skipped live test is never a pass.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairCommand } from "../commands/repair.js";
import { probeLocalLane } from "../lib/local-lane.js";
import type { RepairReport } from "../lib/repair/contracts.js";
import type { RuntimeSession } from "../lib/runtime-session.js";

const LIVE = process.env.LITT_RUN_LIVE_OLLAMA === "1";
const MODEL = process.env.LITT_LIVE_OLLAMA_MODEL ?? "litt-coder:8k";
const ORIGINAL = "status=BROKEN\n";

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function liveWorkspace(regressionExpr: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litt-live-ollama-"));
  scratch.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "src", "state.txt"), ORIGINAL, "utf8");
  await writeFile(join(root, "bystander.txt"), "must never change\n", "utf8");
  await writeFile(
    join(root, "repro.cjs"),
    "const s=require('fs').readFileSync('src/state.txt','utf8');if(s.includes('BROKEN')){console.error('BROKEN-SIGNATURE: state is broken');process.exit(1)}\n",
    "utf8",
  );
  await writeFile(
    join(root, "tests", "regression.cjs"),
    `const s=require('fs').readFileSync('src/state.txt','utf8');process.exit((${regressionExpr})?0:1);\n`,
    "utf8",
  );
  const node = (script: string) => ({ command: "node", args: [script], timeoutMs: 20_000 });
  await writeFile(join(root, "job.json"), JSON.stringify({
    version: 1,
    incident: "src/state.txt contains the word BROKEN and repro.cjs fails with BROKEN-SIGNATURE. The fix is to make the status healthy.",
    reproduction: { command: node("repro.cjs"), expectedFailure: { stream: "stderr", includes: "BROKEN-SIGNATURE" } },
    regression: { path: "tests/regression.cjs", command: node("tests/regression.cjs") },
    editablePaths: ["src"],
    checks: [{ name: "regression", kind: "focused", command: node("tests/regression.cjs") }],
    modelPolicy: { pinnedModel: `ollama:${MODEL}`, allowedModels: [], allowEscalation: false, offline: true },
  }), "utf8");
  return root;
}

async function latestReport(root: string): Promise<RepairReport> {
  const dir = join(root, ".litt", "repairs");
  const [runId] = (await readdir(dir)).sort().reverse();
  return JSON.parse(await readFile(join(dir, runId, "report.json"), "utf8")) as RepairReport;
}

async function liveAvailability(): Promise<string | null> {
  if (!LIVE) return "set LITT_RUN_LIVE_OLLAMA=1 to run";
  const lane = await probeLocalLane();
  if (!lane.available) return `Ollama daemon unavailable at ${lane.endpoint}: ${lane.reason ?? "unknown"}`;
  if (!lane.models.some((m) => m === MODEL || m === `${MODEL}:latest`)) return `model ${MODEL} is not installed`;
  return null;
}

describe("live Ollama repair (real model, no stubs)", () => {
  it("solvable: completes with verified evidence, or rolls back cleanly", async (context) => {
    const blocked = await liveAvailability();
    if (blocked) {
      console.log(`LIVE OLLAMA BLOCKED: ${blocked}`);
      return context.skip();
    }
    const root = await liveWorkspace("!s.includes('BROKEN')");
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", "job.json", "--yes"], session);
    const report = await latestReport(root);

    console.log(`LIVE SOLVABLE: exit=${code} stage=${report.stage} model=${report.diagnosis?.model ?? "none"} provider=${report.diagnosis?.providerId ?? "none"}`);
    console.log(`LIVE SOLVABLE: rootCause=${report.rootCause ?? "none"}`);
    console.log(`LIVE SOLVABLE: risks=${report.remainingRisks.join(" | ") || "none"}`);

    expect(report.reproduction?.exitCode).toBe(1);
    // The model call must have really happened on a local provider.
    expect(report.diagnosis?.providerId).toBe("ollama");
    expect(await readFile(join(root, "bystander.txt"), "utf8")).toBe("must never change\n");
    if (report.stage === "complete") {
      expect(code).toBe(0);
      expect(report.independentVerification.every((e) => e.status === "success" || e.exitCode === 0)).toBe(true);
      expect(await readFile(join(root, "src", "state.txt"), "utf8")).not.toContain("BROKEN");
    } else {
      // An unsuccessful live repair must leave the workspace untouched.
      expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe(ORIGINAL);
    }
  }, 600_000);

  it("unfixable: a real proposal that fails validation is rolled back byte-for-byte", async (context) => {
    const blocked = await liveAvailability();
    if (blocked) {
      console.log(`LIVE OLLAMA BLOCKED: ${blocked}`);
      return context.skip();
    }
    // The model cannot know this exact token, so no honest patch can satisfy the regression.
    const root = await liveWorkspace("s.trim() === 'status=HEALTHY-7f3a9c1e'");
    const session = { getCwd: () => root } as RuntimeSession;
    const code = await repairCommand(["start", "--job", "job.json", "--yes"], session);
    const report = await latestReport(root);

    console.log(`LIVE UNFIXABLE: exit=${code} stage=${report.stage} filesChanged=${report.filesChanged.join(",") || "none"}`);
    console.log(`LIVE UNFIXABLE: risks=${report.remainingRisks.join(" | ") || "none"}`);

    expect(report.stage).not.toBe("complete");
    expect(code).not.toBe(0);
    expect(await readFile(join(root, "src", "state.txt"), "utf8")).toBe(ORIGINAL);
    expect(await readFile(join(root, "bystander.txt"), "utf8")).toBe("must never change\n");
    if (report.filesChanged.length > 0) {
      // A patch really was applied, so this proves rollback, not just refusal.
      expect(report.stage).toBe("failed");
      expect(report.remainingRisks.join(" ")).toContain("workspace restored");
    }
  }, 600_000);
});
