/**
 * resolveLauncherTarget() — Windows launcher resolution regression.
 *
 * Bug: `where litt` lists every PATH match in PATH order, not the order
 * a real Windows shell resolves them in (PATHEXT: .cmd before an
 * extensionless file). The old code took matches[0] unconditionally; if
 * that happened to be an extensionless git-bash/WSL interop shim (no
 * ".cmd" suffix), it fell into the "Unix" branch and shelled out to
 * `readlink -f`. Git for Windows ships its OWN readlink.exe that
 * POSIX-translates the path ("C:\Users\..." -> "/c/Users/...");
 * existsSync() on Windows cannot see that path, so `litt doctor --paths`
 * (and collectBuildIdentity/checkStaleBuild) silently reported the
 * launcher as missing even though it was installed and working.
 *
 * This suite mocks only `execFileSync` (the "where"/"readlink" calls);
 * everything else operates on real temp files so existsSync/readFileSync
 * behave naturally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileSyncMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (...args: unknown[]) => execFileSyncMock(...args) };
});

describe("resolveLauncherTarget (Windows)", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock.mockReset();
    dir = mkdtempSync(join(tmpdir(), "litt-launcher-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers the .cmd shim over an earlier extensionless PATH match", async () => {
    if (process.platform !== "win32") return;
    const bareShim = join(dir, "litt");
    const cmdShim = join(dir, "litt.cmd");
    writeFileSync(bareShim, "#!/bin/sh\nexec node \"$0/../dist/index.js\" \"$@\"\n");
    writeFileSync(cmdShim, '@IF EXIST "%~dp0\\node.exe" (\n  "%~dp0\\node.exe" "C:\\real\\dist\\index.js" %*\n) ELSE (\n  node "C:\\real\\dist\\index.js" %*\n)\n');

    // `where` lists the extensionless match FIRST — the order that
    // triggered the bug — then the .cmd shim second.
    execFileSyncMock.mockReturnValueOnce(`${bareShim}\r\n${cmdShim}\r\n`);

    const { resolveLauncherTarget } = await import("../lib/build-metadata.js");
    const target = resolveLauncherTarget();

    expect(target).toBe("C:\\real\\dist\\index.js");
    // readlink must NEVER be invoked on win32 — that's the exact path
    // that produced the POSIX-translated, existsSync-invisible result.
    const readlinkCalls = execFileSyncMock.mock.calls.filter((c) => c[0] === "readlink");
    expect(readlinkCalls).toHaveLength(0);
  });

  it("falls back to the bare shim when no .cmd match exists", async () => {
    if (process.platform !== "win32") return;
    const bareShim = join(dir, "litt");
    writeFileSync(bareShim, "#!/bin/sh\necho hi\n");
    execFileSyncMock.mockReturnValueOnce(`${bareShim}\r\n`);

    const { resolveLauncherTarget } = await import("../lib/build-metadata.js");
    expect(resolveLauncherTarget()).toBe(bareShim);
    expect(execFileSyncMock.mock.calls.some((c) => c[0] === "readlink")).toBe(false);
  });

  it("returns null when the resolved where-match doesn't exist on disk", async () => {
    if (process.platform !== "win32") return;
    execFileSyncMock.mockReturnValueOnce(`${join(dir, "nonexistent.cmd")}\r\n`);
    const { resolveLauncherTarget } = await import("../lib/build-metadata.js");
    expect(resolveLauncherTarget()).toBeNull();
  });

  it("returns null when `where` finds nothing", async () => {
    if (process.platform !== "win32") return;
    execFileSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("not found"), { status: 1 });
    });
    const { resolveLauncherTarget } = await import("../lib/build-metadata.js");
    expect(resolveLauncherTarget()).toBeNull();
  });

  it("handles a .cmd shim whose target path contains spaces and an apostrophe", async () => {
    if (process.platform !== "win32") return;
    const cmdShim = join(dir, "litt.cmd");
    const spacedTarget = "C:\\LiTT\\My Projects\\o'brien's repo\\dist\\index.js";
    writeFileSync(cmdShim, `node "${spacedTarget}" %*\n`);
    execFileSyncMock.mockReturnValueOnce(`${cmdShim}\r\n`);

    const { resolveLauncherTarget } = await import("../lib/build-metadata.js");
    expect(resolveLauncherTarget()).toBe(spacedTarget);
  });
});
