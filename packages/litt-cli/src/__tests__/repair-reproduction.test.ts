import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvidenceCommand } from "../lib/repair/command-runner.js";
import { evaluateReproduction } from "../lib/repair/evidence.js";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "litt-repair-"));
  scratch.push(path);
  return path;
}

describe("repair failure reproduction", () => {
  it("accepts the expected non-zero failure with matching evidence", async () => {
    const cwd = await tempDirectory();
    const evidence = await runEvidenceCommand({
      command: process.execPath,
      args: ["-e", "console.error('known failure'); process.exit(7)"],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }, { cwd, name: "reproduction" });

    expect(evidence.exitCode).toBe(7);
    expect(evaluateReproduction(evidence, {
      stream: "stderr",
      includes: "known failure",
    })).toEqual({ reproduced: true, reason: "Expected failure reproduced" });
  });

  it("rejects an unrelated failure", async () => {
    const cwd = await tempDirectory();
    const evidence = await runEvidenceCommand({
      command: process.execPath,
      args: ["-e", "console.error('different failure'); process.exit(1)"],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }, { cwd, name: "reproduction" });

    expect(evaluateReproduction(evidence, {
      stream: "stderr",
      includes: "known failure",
    }).reproduced).toBe(false);
  });

  it("rejects a missing executable as a reproduction", async () => {
    const cwd = await tempDirectory();
    const evidence = await runEvidenceCommand({
      command: "litt-command-that-does-not-exist",
      args: [],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }, { cwd, name: "reproduction" });

    expect(evidence.status).toBe("spawn-error");
    expect(evaluateReproduction(evidence, {
      stream: "any",
      includes: "ENOENT",
    }).reproduced).toBe(false);
  });

  it("redacts secrets from persisted output", async () => {
    const cwd = await tempDirectory();
    const evidence = await runEvidenceCommand({
      command: process.execPath,
      args: ["-e", "console.error('Bearer abcdefghijklmnopqrstuvwxyz'); process.exit(1)"],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }, { cwd, name: "reproduction" });

    expect(evidence.stderr).toContain("Bearer ***");
    expect(evidence.stderr).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
