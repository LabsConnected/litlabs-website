/**
 * Install freshness stamp (preview start fix, 2026-11-14).
 *
 * The stamp is what lets a preview start (and the background
 * prepare-install) skip a dependency install that is already done
 * AND current: node_modules alone never proved freshness, because
 * it says nothing about which lockfile it was installed against —
 * and it never crosses the sync boundary, so the volume's copy
 * proves nothing about the sandbox at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  INSTALL_STAMP_PATH,
  computeInstallStamp,
  readVolumeInstallStamp,
  sandboxInstallIsFresh,
  writeSandboxInstallStamp,
} from "../sandbox/install-stamp";
import type { SandboxProvider } from "../sandbox/provider";

describe("computeInstallStamp", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeInstallStamp(["lock", "pkg"])).toBe(computeInstallStamp(["lock", "pkg"]));
  });

  it("changes when any input changes", () => {
    const base = computeInstallStamp(["lock-v1", "pkg"]);
    expect(computeInstallStamp(["lock-v2", "pkg"])).not.toBe(base);
    expect(computeInstallStamp(["lock-v1", "pkg-v2"])).not.toBe(base);
  });

  it("is order-sensitive (lockfile and package.json are not interchangeable)", () => {
    expect(computeInstallStamp(["a", "b"])).not.toBe(computeInstallStamp(["b", "a"]));
  });
});

describe("readVolumeInstallStamp", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "litt-stamp-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the volume has no package.json", () => {
    expect(readVolumeInstallStamp(dir)).toBeNull();
  });

  it("hashes package.json alone when no lockfile exists", () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    expect(readVolumeInstallStamp(dir)).toBe(computeInstallStamp(['{"name":"x"}']));
  });

  it("includes the lockfile, preferring pnpm-lock.yaml", () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
    writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}');
    expect(readVolumeInstallStamp(dir)).toBe(
      computeInstallStamp(["lockfileVersion: '9.0'", '{"name":"x"}']),
    );
  });

  it("changes when the lockfile changes", () => {
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    writeFileSync(join(dir, "pnpm-lock.yaml"), "v1");
    const before = readVolumeInstallStamp(dir);
    writeFileSync(join(dir, "pnpm-lock.yaml"), "v2");
    expect(readVolumeInstallStamp(dir)).not.toBe(before);
  });
});

/** Fake provider whose file transfer is an in-memory path→bytes map. */
function makeProvider(files: Map<string, Uint8Array>): SandboxProvider {
  return {
    name: "stub",
    fileTransfer: {
      readFile: vi.fn(async (_id: string, path: string) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`not found: ${path}`);
        return bytes;
      }),
      writeFile: vi.fn(async (_id: string, path: string, data: Uint8Array) => {
        files.set(path, data);
      }),
      listDir: vi.fn(async () => []),
      listTree: vi.fn(async () => []),
      removePath: vi.fn(async () => {}),
      makeDir: vi.fn(async () => {}),
      renamePath: vi.fn(async () => {}),
    },
  } as unknown as SandboxProvider;
}

describe("sandboxInstallIsFresh / writeSandboxInstallStamp", () => {
  it("is not fresh when no stamp was requested or the stamp file is absent", async () => {
    const provider = makeProvider(new Map());
    expect(await sandboxInstallIsFresh(provider, "sbx", null)).toBe(false);
    expect(await sandboxInstallIsFresh(provider, "sbx", "abc123")).toBe(false);
  });

  it("round-trips: a written stamp reads back fresh, a different stamp does not", async () => {
    const files = new Map<string, Uint8Array>();
    const provider = makeProvider(files);
    await writeSandboxInstallStamp(provider, "sbx", "stamp-1");
    expect(files.has(INSTALL_STAMP_PATH)).toBe(true);
    expect(await sandboxInstallIsFresh(provider, "sbx", "stamp-1")).toBe(true);
    expect(await sandboxInstallIsFresh(provider, "sbx", "stamp-2")).toBe(false);
  });

  it("write failures are swallowed (best effort) and null stamps write nothing", async () => {
    const files = new Map<string, Uint8Array>();
    const provider = makeProvider(files);
    await writeSandboxInstallStamp(provider, "sbx", null);
    expect(files.size).toBe(0);

    const broken = {
      name: "stub",
      fileTransfer: {
        writeFile: vi.fn(async () => {
          throw new Error("disk gone");
        }),
        readFile: vi.fn(async () => {
          throw new Error("disk gone");
        }),
      },
    } as unknown as SandboxProvider;
    await expect(writeSandboxInstallStamp(broken, "sbx", "s")).resolves.toBeUndefined();
    expect(await sandboxInstallIsFresh(broken, "sbx", "s")).toBe(false);
  });
});
