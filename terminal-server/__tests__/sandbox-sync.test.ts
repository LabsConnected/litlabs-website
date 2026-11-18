/**
 * Sandbox workspace sync (Phase 2 lifecycle, design note §1.3/§3.3).
 *
 * Proves the manifest diff, the sync-back round trip (including
 * deletions and .git carrying while node_modules never crosses), the
 * symlink safety rules, the whole-plan quota gate, and the
 * volume-to-sandbox mirror / single-path forward push — all against
 * the fake provider's in-memory filesystem and a real temp volume.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, lstatSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import {
  diffManifests,
  isSandboxOnlyPath,
  listSandboxTree,
  listVolumeTree,
  mirrorVolumeToSandbox,
  pushVolumePath,
  syncBack,
  SyncQuotaError,
  type SyncManifest,
} from "../sandbox/sync";

const ROOT = "/workspace";
let volume: string;
let provider: FakeSandboxProvider;
let sandboxId: string;

beforeEach(async () => {
  volume = mkdtempSync(join(tmpdir(), "litt-sync-"));
  provider = new FakeSandboxProvider();
  const instance = await provider.create({ timeoutMs: 60_000 });
  sandboxId = instance.sandboxId;
});

afterEach(() => {
  rmSync(volume, { recursive: true, force: true });
});

function transfer() {
  if (!provider.fileTransfer) throw new Error("fake provider must expose fileTransfer");
  return provider.fileTransfer;
}

async function seedSandbox() {
  const t = transfer();
  await t.writeFile(sandboxId, `${ROOT}/a.txt`, new TextEncoder().encode("alpha"));
  await t.writeFile(sandboxId, `${ROOT}/dir/b.txt`, new TextEncoder().encode("beta"));
  await t.writeFile(sandboxId, `${ROOT}/.git/config`, new TextEncoder().encode("[core]\n"));
  await t.writeFile(sandboxId, `${ROOT}/node_modules/junk/index.js`, new TextEncoder().encode("junk"));
}

describe("isSandboxOnlyPath", () => {
  it("excludes dependency/build trees but carries .git and .litt", () => {
    expect(isSandboxOnlyPath("node_modules/x.js")).toBe(true);
    expect(isSandboxOnlyPath("src/node_modules/y.js")).toBe(true);
    expect(isSandboxOnlyPath(".next/static/chunk.js")).toBe(true);
    expect(isSandboxOnlyPath(".git/config")).toBe(false);
    expect(isSandboxOnlyPath(".litt/scaffold.json")).toBe(false);
    expect(isSandboxOnlyPath("src/app.ts")).toBe(false);
  });
});

describe("diffManifests", () => {
  const base: SyncManifest = new Map([
    ["a.txt", { path: "a.txt", type: "file", size: 3, mtimeMs: 1, mode: 0o644 }],
    ["gone.txt", { path: "gone.txt", type: "file", size: 1, mtimeMs: 1, mode: 0o644 }],
    ["link", { path: "link", type: "symlink", size: 0, mtimeMs: 1, mode: 0o777, linkTarget: "a.txt" }],
  ]);

  it("detects adds, changes, deletes, and symlink target changes", () => {
    const next: SyncManifest = new Map([
      ["a.txt", { path: "a.txt", type: "file", size: 4, mtimeMs: 2, mode: 0o644 }],
      ["new.txt", { path: "new.txt", type: "file", size: 1, mtimeMs: 1, mode: 0o644 }],
      ["link", { path: "link", type: "symlink", size: 0, mtimeMs: 1, mode: 0o777, linkTarget: "other.txt" }],
    ]);
    const diff = diffManifests(base, next);
    expect(diff.upserts.map((e) => e.path).sort()).toEqual(["a.txt", "link", "new.txt"]);
    expect(diff.deletes.map((e) => e.path)).toEqual(["gone.txt"]);
  });

  it("is empty for identical manifests", () => {
    const diff = diffManifests(base, new Map(base));
    expect(diff.upserts).toHaveLength(0);
    expect(diff.deletes).toHaveLength(0);
  });
});

describe("syncBack", () => {
  it("bootstrap: copies files and .git, never node_modules", async () => {
    await seedSandbox();
    const result = await syncBack(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, previous: null });
    expect(readFileSync(join(volume, "a.txt"), "utf-8")).toBe("alpha");
    expect(readFileSync(join(volume, "dir", "b.txt"), "utf-8")).toBe("beta");
    expect(existsSync(join(volume, ".git", "config"))).toBe(true);
    expect(existsSync(join(volume, "node_modules"))).toBe(false);
    expect(result.manifest.has("node_modules/junk/index.js")).toBe(false);
  });

  it("incremental: applies changes and deletions against the baseline", async () => {
    await seedSandbox();
    const first = await syncBack(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, previous: null });
    const t = transfer();
    await t.writeFile(sandboxId, `${ROOT}/a.txt`, new TextEncoder().encode("alpha-v2-longer"));
    await t.writeFile(sandboxId, `${ROOT}/c.txt`, new TextEncoder().encode("gamma"));
    await t.removePath(sandboxId, `${ROOT}/dir/b.txt`);

    const second = await syncBack(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, previous: first.manifest });
    expect(readFileSync(join(volume, "a.txt"), "utf-8")).toBe("alpha-v2-longer");
    expect(readFileSync(join(volume, "c.txt"), "utf-8")).toBe("gamma");
    expect(existsSync(join(volume, "dir", "b.txt"))).toBe(false);
    expect(second.stats.filesCopied).toBe(2);
    expect(second.stats.filesDeleted).toBe(1);
  });

  it("skips symlinks that escape the workspace root and records them", async () => {
    await seedSandbox();
    await provider.execute(sandboxId, { command: `ln -sfn /etc/passwd ${ROOT}/escape` });
    await provider.execute(sandboxId, { command: `ln -sfn a.txt ${ROOT}/inside-link` });
    const result = await syncBack(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, previous: null });
    expect(result.stats.skipped.map((s) => s.path)).toContain("escape");
    expect(existsSync(join(volume, "escape"))).toBe(false);
    expect(lstatSync(join(volume, "inside-link")).isSymbolicLink()).toBe(true);
  });

  it("refuses the whole plan when a file exceeds the per-file quota", async () => {
    await seedSandbox();
    await expect(
      syncBack(provider, sandboxId, {
        sandboxRoot: ROOT, volumeRoot: volume, previous: null,
        quotas: { maxFileBytes: 4, maxTotalBytes: 1 << 30 },
      }),
    ).rejects.toBeInstanceOf(SyncQuotaError);
    // Nothing was written — the gate runs before any byte moves.
    expect(existsSync(join(volume, "a.txt"))).toBe(false);
  });

  it("refuses the whole plan when the total exceeds the workspace quota", async () => {
    await seedSandbox();
    await expect(
      syncBack(provider, sandboxId, {
        sandboxRoot: ROOT, volumeRoot: volume, previous: null,
        quotas: { maxFileBytes: 1 << 30, maxTotalBytes: 5 },
      }),
    ).rejects.toBeInstanceOf(SyncQuotaError);
    expect(existsSync(join(volume, "a.txt"))).toBe(false);
  });
});

describe("mirrorVolumeToSandbox + pushVolumePath", () => {
  it("mirror: volume wins, sandbox extras are removed, .git is not treated as sandbox-only", async () => {
    writeFileSync(join(volume, "v.txt"), "volume-wins-content");
    mkdirSync(join(volume, ".git"), { recursive: true });
    writeFileSync(join(volume, ".git", "config"), "[core]\n");
    const t = transfer();
    await t.writeFile(sandboxId, `${ROOT}/v.txt`, new TextEncoder().encode("stale"));
    await t.writeFile(sandboxId, `${ROOT}/extra.txt`, new TextEncoder().encode("extra"));

    await mirrorVolumeToSandbox(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume });
    const after = await listSandboxTree(provider, sandboxId, ROOT);
    expect(after.has("v.txt")).toBe(true);
    expect(after.has("extra.txt")).toBe(false);
    expect(after.has(".git/config")).toBe(true);
    const bytes = await t.readFile(sandboxId, `${ROOT}/v.txt`);
    expect(new TextDecoder().decode(bytes)).toBe("volume-wins-content");
  });

  it("pushVolumePath forwards a single file write and a delete", async () => {
    writeFileSync(join(volume, "one.txt"), "pushed");
    await pushVolumePath(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, relPath: "one.txt" });
    const t = transfer();
    const bytes = await t.readFile(sandboxId, `${ROOT}/one.txt`);
    expect(new TextDecoder().decode(bytes)).toBe("pushed");

    rmSync(join(volume, "one.txt"));
    await pushVolumePath(provider, sandboxId, { sandboxRoot: ROOT, volumeRoot: volume, relPath: "one.txt" });
    const tree = await listSandboxTree(provider, sandboxId, ROOT);
    expect(tree.has("one.txt")).toBe(false);
  });

  it("listVolumeTree never includes sandbox-only dirs", () => {
    mkdirSync(join(volume, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(volume, "node_modules", "pkg", "i.js"), "x");
    writeFileSync(join(volume, "keep.txt"), "y");
    const tree = listVolumeTree(volume);
    expect(tree.has("keep.txt")).toBe(true);
    expect([...tree.keys()].some((p) => p.includes("node_modules"))).toBe(false);
  });
});
