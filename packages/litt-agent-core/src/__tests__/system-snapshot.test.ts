/**
 * system.snapshot tool — bounded, read-only, honest-failure contract.
 * Also proves the registry's permission metadata keeps mutation tools
 * marked non-readOnly regardless of any model's instructions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDefaultRegistry } from "../tools.js";
import type { ToolContext } from "../types.js";

const ctx = {
  cwd: process.cwd(),
  shell: {} as never,
  projectId: "test-project",
  userId: "test-user",
} as ToolContext;

describe("system.snapshot", () => {
  it("is registered read-only", () => {
    const def = createDefaultRegistry().get("system.snapshot")?.definition;
    assert.equal(def?.readOnly, true);
  });

  it("returns cpu/memory/platform truthfully and fails honestly", async () => {
    const res = await createDefaultRegistry().execute("system.snapshot", ctx, {});
    assert.equal(res.success, true);
    const d = res.data as Record<string, any>;
    assert.ok(d.cpu.cores > 0);
    assert.ok(d.memory.totalMb > 0);
    assert.equal(typeof d.platform, "string");
    assert.ok(d.gpu);
    assert.ok(d.ollama);
    if (d.ollama.reachable === false) assert.equal(typeof d.ollama.reason, "string");
    if (d.gpu.available === false) assert.equal(typeof d.gpu.reason, "string");
  });
});

describe("permission boundaries are structural, not model-decided", () => {
  it("project.write_file remains mutating/non-readOnly in the registry", () => {
    const reg = createDefaultRegistry();
    const entry = reg.get("project.write_file");
    assert.equal(entry?.definition.readOnly, false);
    assert.equal(entry?.metadata.mutating, true);
    assert.equal(entry?.metadata.readOnly, false);
  });

  it("all read-only tools carry mutating:false metadata", () => {
    const reg = createDefaultRegistry();
    for (const def of reg.list()) {
      const entry = reg.get(def.id);
      if (def.readOnly) assert.equal(entry?.metadata.mutating, false);
    }
  });
});
