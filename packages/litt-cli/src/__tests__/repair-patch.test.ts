import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyContextPatches } from "../lib/repair/patch.js";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litt-patch-"));
  scratch.push(root);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n", "utf8");
  return root;
}

describe("repair contextual patches", () => {
  it("applies an authorized unique replacement", async () => {
    const root = await fixture();
    const changed = await applyContextPatches(root, [{
      operation: "replace",
      path: "src/value.ts",
      search: "value = 1",
      replacement: "value = 2",
    }], ["src"]);
    expect(changed).toEqual(["src/value.ts"]);
    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain("value = 2");
  });

  it("creates a regression file inside an authorized scope", async () => {
    const root = await fixture();
    await applyContextPatches(root, [{
      operation: "create",
      path: "tests/regression.test.ts",
      content: "export {};\n",
    }], ["tests"]);
    expect(await readFile(join(root, "tests", "regression.test.ts"), "utf8")).toBe("export {};\n");
  });

  it.each([
    ["traversal", "../outside.ts"],
    ["protected evidence", ".litt/repairs/run/report.json"],
    ["outside scope", "docs/note.md"],
  ])("rejects %s", async (_name, path) => {
    const root = await fixture();
    await expect(applyContextPatches(root, [{
      operation: "create",
      path,
      content: "unsafe",
    }], ["src"])).rejects.toThrow();
  });

  it("rejects a directory symlink escape", async () => {
    const root = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "litt-patch-outside-"));
    scratch.push(outside);
    try {
      await symlink(outside, join(root, "src", "escape"), "junction");
    } catch {
      return;
    }
    await expect(applyContextPatches(root, [{
      operation: "create",
      path: "src/escape/owned.ts",
      content: "unsafe",
    }], ["src"])).rejects.toThrow(/outside workspace/i);
  });

  it("validates every patch before mutating any file", async () => {
    const root = await fixture();
    await expect(applyContextPatches(root, [
      {
        operation: "replace",
        path: "src/value.ts",
        search: "value = 1",
        replacement: "value = 2",
      },
      {
        operation: "replace",
        path: "src/value.ts",
        search: "missing context",
        replacement: "never",
      },
    ], ["src"])).rejects.toThrow(/context not found/i);
    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain("value = 1");
  });
});
