/**
 * Incident evaluation dataset harness — the cross-platform repair eval.
 *
 * Each case in fixtures/repair-incidents/cases.json declares a workspace
 * fixture, a repair job, a provider outcome, and an expected outcome
 * contract. The harness materializes the workspace in a temp dir, runs the
 * REAL repair pipeline (only the model call is stubbed — stage gates,
 * command execution, patching, rollback, and reports are real), and asserts
 * the contract plus one invariant: files outside the declared blast radius
 * are byte-identical before and after the run.
 *
 * Cross-platform by construction:
 *  - every command is `node <script>` — PATH-resolved, no shell syntax;
 *  - job paths are forward-slash relative (contracts normalize \\ → /);
 *  - temp workspaces come from os.tmpdir(); no platform conditionals;
 *  - timeouts cover slow Windows/Termux spawn times.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@litt/agent-core";
import { repairCommand, type RepairPipelineDeps } from "../commands/repair.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RepairReport } from "../lib/repair/contracts.js";
import type { RepairProviderHandle, RepairProviderOutcome } from "../lib/repair/provider.js";

interface IncidentCase {
  id: string;
  /** Only "cli" cases run here; studio/infra incidents live in integration-incidents.json. */
  scope: "cli";
  description: string;
  workspaceFiles: Record<string, string>;
  job: object;
  provider: { outcome: "proposal"; proposal: object } | { outcome: "billing" };
  startArgs: string[];
  resumeArgs?: string[];
  expect: CaseExpectation;
  resumeExpect?: CaseExpectation;
}

interface CaseExpectation {
  exitCode: number;
  stage: string;
  blockReason?: string;
  filesChanged: string[];
  fileContents?: Record<string, string>;
  absentPaths?: string[];
  risksContain?: string[];
}

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/repair-incidents/cases.json", import.meta.url)), "utf8"),
) as IncidentCase[];

interface IntegrationManifest {
  incidents: { id: string; scope: "studio" | "infra"; description: string; requires: string[] }[];
}

const integration = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/repair-incidents/integration-incidents.json", import.meta.url)), "utf8"),
) as IntegrationManifest;

/** The incident classes the mission requires. CLI-reproducible ones must be runnable cases. */
const REQUIRED_CLI_INCIDENTS = [
  "ollama-cold-start-timeout",
  "incorrect-model-selection",
  "tailscale-lan-fallback",
  "powershell-process-overhead",
  "cli-tool-execution-failure",
  "approval-resume-interruption",
  "cancellation-stalled-process",
  "file-persistence-failure",
];
const REQUIRED_INTEGRATION_INCIDENTS = ["backup-watchdog-failure"];

const scratch: string[] = [];

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

function depsFor(incident: IncidentCase): RepairPipelineDeps {
  if (incident.provider.outcome === "billing") {
    return {
      resolveProvider: async () => ({ ok: false, reason: "billing", error: "provider billing limit reached" }),
      isTTY: () => false,
    };
  }
  return {
    resolveProvider: async () => stubProvider(incident.provider.proposal),
    isTTY: () => false,
  };
}

async function materialize(incident: IncidentCase): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litt-incident-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(incident.workspaceFiles)) {
    const target = join(root, ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await writeFile(join(root, "job.json"), JSON.stringify(incident.job, null, 2), "utf8");
  return root;
}

/** Byte-map every workspace file except .litt/ and job.json — the change ledger. */
async function fileMap(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (rel === ".litt") continue;
        await walk(full);
      } else if (entry.isFile() && rel !== "job.json") {
        map.set(rel, await readFile(full, "utf8"));
      }
    }
  };
  await walk(root);
  return map;
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [path, content] of after) {
    if (before.get(path) !== content) changed.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(path);
  }
  return changed.sort();
}

async function latestReport(root: string): Promise<{ runId: string; report: RepairReport }> {
  const dir = join(root, ".litt", "repairs");
  const runs = (await readdir(dir).catch(() => [] as string[])).sort();
  const runId = runs[runs.length - 1];
  const report = JSON.parse(await readFile(join(dir, runId, "report.json"), "utf8")) as RepairReport;
  return { runId, report };
}

async function assertExpectation(
  root: string,
  exitCode: number,
  expectation: CaseExpectation,
  before: Map<string, string>,
  allowedChanges: string[],
): Promise<void> {
  expect(exitCode).toBe(expectation.exitCode);
  const { report } = await latestReport(root);
  expect(report.stage).toBe(expectation.stage);
  if (expectation.blockReason !== undefined) {
    expect(report.blockReason ?? null).toBe(expectation.blockReason);
  }
  expect([...report.filesChanged].sort()).toEqual([...expectation.filesChanged].sort());
  for (const [path, content] of Object.entries(expectation.fileContents ?? {})) {
    expect(await readFile(join(root, ...path.split("/")), "utf8")).toBe(content);
  }
  for (const path of expectation.absentPaths ?? []) {
    await expect(readFile(join(root, ...path.split("/")), "utf8")).rejects.toThrow();
  }
  for (const fragment of expectation.risksContain ?? []) {
    expect(report.remainingRisks.join(" ")).toContain(fragment);
  }
  // The blast-radius invariant: nothing outside the allowed change set moved.
  // (A restored file reports in filesChanged but nets to no diff.)
  const allowed = new Set([...allowedChanges, ...Object.keys(expectation.fileContents ?? {})]);
  const changed = changedFiles(before, await fileMap(root));
  expect(changed.filter((path) => !allowed.has(path))).toEqual([]);
}

describe("repair incident evaluation dataset", () => {
  it("dataset is well-formed and unique", () => {
    const ids = dataset.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of dataset) {
      expect(c.workspaceFiles["job.json"]).toBeUndefined();
      expect(c.expect.exitCode).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers every required CLI incident class with a runnable case", () => {
    const ids = new Set(dataset.map((c) => c.id));
    for (const id of REQUIRED_CLI_INCIDENTS) expect(ids.has(id), id).toBe(true);
  });

  it("keeps studio and infrastructure incidents out of the CLI dataset", () => {
    const cliIds = new Set(dataset.map((c) => c.id));
    for (const c of dataset) expect(c.scope).toBe("cli");
    for (const entry of integration.incidents) {
      expect(["studio", "infra"]).toContain(entry.scope);
      expect(cliIds.has(entry.id), entry.id).toBe(false);
      expect(entry.requires.length).toBeGreaterThan(0);
    }
    const integrationIds = new Set(integration.incidents.map((e) => e.id));
    for (const id of REQUIRED_INTEGRATION_INCIDENTS) expect(integrationIds.has(id), id).toBe(true);
  });

  for (const incident of dataset) {
    it(`${incident.id}: ${incident.description}`, async () => {
      const root = await materialize(incident);
      const before = await fileMap(root);
      const session = { getCwd: () => root } as RuntimeSession;
      const deps = depsFor(incident);

      const startCode = await repairCommand(
        ["start", "--job", "job.json", ...incident.startArgs],
        session,
        undefined,
        deps,
      );
      // The declared blast radius bounds every net diff — blocked runs allow
      // nothing, restored runs may net to a subset.
      await assertExpectation(root, startCode, incident.expect, before, incident.expect.filesChanged);

      if (incident.resumeExpect) {
        const midState = await fileMap(root);
        const { runId } = await latestReport(root);
        const resumeCode = await repairCommand(
          ["resume", "--run", runId, "--job", "job.json", ...(incident.resumeArgs ?? [])],
          session,
          undefined,
          deps,
        );
        await assertExpectation(root, resumeCode, incident.resumeExpect, midState, incident.resumeExpect.filesChanged);
      }

      await rm(root, { recursive: true, force: true });
    }, 60_000);
  }

  it("cleans up every temp workspace", async () => {
    await Promise.all(scratch.splice(0).map((p) => rm(p, { recursive: true, force: true })));
  });
});
