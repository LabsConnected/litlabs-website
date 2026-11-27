/**
 * Regression tests for the symlink sandbox-bypass fix in resolveSandboxedPath().
 *
 * Before this fix, resolveSandboxedPath() computed realTarget (the fully
 * resolved, symlink-free path) ONLY to decide ok/not-ok, then returned
 * resolvedPath — the original, symlink-laden string — for callers (listFiles,
 * readFile, writeFile) to actually read/write. Any later fs.* syscall on
 * resolvedPath re-resolves symlinks itself, so a symlink swapped after the
 * containment check (a TOCTOU race) would be followed silently, landing the
 * real I/O outside the sandbox the check had just validated.
 *
 * The fix: resolveSandboxedPath() also returns realTarget, and all three
 * callers now perform their actual I/O against realTarget — a plain,
 * symlink-free absolute path that cannot be redirected by swapping a
 * symlink elsewhere after the check returns. writeFile() additionally opens
 * with O_NOFOLLOW (where the platform defines it) so a symlink planted
 * exactly at the leaf between check and write still fails closed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { resolveSandboxedPath, writeFile, readFile, listFiles } from "../project.js";
import { createShellExecutor } from "../shell.js";

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litt-sandbox-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-outside-"));
  return { root, outside };
}

describe("resolveSandboxedPath — symlink containment", () => {
  it("resolvedPath and realTarget are identical when no symlink is involved", () => {
    const { root, outside } = makeSandbox();
    try {
      const resolved = resolveSandboxedPath(root, "plain.txt");
      assert.ok(resolved.ok);
      if (resolved.ok) {
        assert.equal(resolved.realTarget, resolved.resolvedPath);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects an existing symlink whose target resolves outside the sandbox", () => {
    const { root, outside } = makeSandbox();
    try {
      const externalFile = path.join(outside, "secret.txt");
      fs.writeFileSync(externalFile, "outside content");
      const leafLink = path.join(root, "escape.txt");
      fs.symlinkSync(externalFile, leafLink, "file");

      const resolved = resolveSandboxedPath(root, "escape.txt");
      assert.equal(resolved.ok, false);
      if (!resolved.ok) {
        assert.match(resolved.reason, /resolves outside the project sandbox/);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("realTarget resolves THROUGH a symlink that stays inside the sandbox, differing from resolvedPath", () => {
    const { root, outside } = makeSandbox();
    try {
      const realDir = path.join(root, "real-dir");
      fs.mkdirSync(realDir);
      const linkedDir = path.join(root, "linked-dir");
      fs.symlinkSync(realDir, linkedDir, "dir");

      const resolved = resolveSandboxedPath(root, "linked-dir/file.txt");
      assert.ok(resolved.ok);
      if (resolved.ok) {
        assert.equal(resolved.resolvedPath, path.join(linkedDir, "file.txt"));
        assert.equal(resolved.realTarget, path.join(fs.realpathSync(realDir), "file.txt"));
        assert.notEqual(resolved.realTarget, resolved.resolvedPath);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("a realTarget captured before a symlink swap is unaffected by swapping the symlink afterward", () => {
    // Simulates the TOCTOU window: the check runs while the symlink points
    // safely inside the sandbox; the symlink is then swapped to point
    // outside; a caller that already captured realTarget (as writeFile does,
    // in the same call before doing I/O) must still land at the originally
    // validated location, not the swapped-to target.
    const { root, outside } = makeSandbox();
    try {
      const safeDir = path.join(root, "safe-dir");
      fs.mkdirSync(safeDir);
      const link = path.join(root, "swap-link");
      fs.symlinkSync(safeDir, link, "dir");

      const resolved = resolveSandboxedPath(root, "swap-link/payload.txt");
      assert.ok(resolved.ok);
      if (!resolved.ok) return;
      const capturedRealTarget = resolved.realTarget;

      // Swap the symlink to point outside the sandbox.
      fs.unlinkSync(link);
      fs.symlinkSync(outside, link, "dir");

      // A caller using the captured, already-resolved realTarget (not the
      // symlink path again) still writes inside the original sandbox dir.
      fs.writeFileSync(capturedRealTarget, "safe content", "utf8");
      assert.ok(capturedRealTarget.startsWith(fs.realpathSync(root) + path.sep));
      assert.equal(fs.readFileSync(path.join(safeDir, "payload.txt"), "utf8"), "safe content");
      assert.ok(!fs.existsSync(path.join(outside, "payload.txt")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("writeFile / readFile / listFiles — use the resolved realTarget for I/O", () => {
  it("writeFile() through a symlinked directory writes to the real target, not the nominal symlink path", async () => {
    const { root, outside } = makeSandbox();
    try {
      const realDir = path.join(root, "real-dir");
      fs.mkdirSync(realDir);
      const linkedDir = path.join(root, "linked-dir");
      fs.symlinkSync(realDir, linkedDir, "dir");

      const shell = createShellExecutor(root);
      const result = await writeFile(shell, "linked-dir/out.txt", "hello sandbox");
      assert.equal(result.success, true);
      assert.equal(fs.readFileSync(path.join(realDir, "out.txt"), "utf8"), "hello sandbox");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("writeFile() refuses to write through an existing symlink pointing outside the sandbox", async () => {
    const { root, outside } = makeSandbox();
    try {
      const externalFile = path.join(outside, "pwned.txt");
      const leafLink = path.join(root, "escape.txt");
      fs.symlinkSync(externalFile, leafLink, "file");

      const shell = createShellExecutor(root);
      const result = await writeFile(shell, "escape.txt", "malicious content");
      assert.equal(result.success, false);
      assert.ok(!fs.existsSync(externalFile), "the outside-sandbox target must never be written");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("readFile() reads through a symlinked directory from the real target", async () => {
    const { root, outside } = makeSandbox();
    try {
      const realDir = path.join(root, "real-dir");
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(realDir, "in.txt"), "read me");
      const linkedDir = path.join(root, "linked-dir");
      fs.symlinkSync(realDir, linkedDir, "dir");

      const shell = createShellExecutor(root);
      const result = await readFile(shell, "linked-dir/in.txt");
      assert.equal(result.success, true);
      assert.equal(result.data.content, "read me");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("readFile() refuses to read through an existing symlink pointing outside the sandbox", async () => {
    const { root, outside } = makeSandbox();
    try {
      const externalFile = path.join(outside, "secret.txt");
      fs.writeFileSync(externalFile, "top secret");
      const leafLink = path.join(root, "escape.txt");
      fs.symlinkSync(externalFile, leafLink, "file");

      const shell = createShellExecutor(root);
      const result = await readFile(shell, "escape.txt");
      assert.equal(result.success, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("listFiles() lists through a symlinked directory from the real target", async () => {
    const { root, outside } = makeSandbox();
    try {
      const realDir = path.join(root, "real-dir");
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(realDir, "a.txt"), "a");
      const linkedDir = path.join(root, "linked-dir");
      fs.symlinkSync(realDir, linkedDir, "dir");

      const shell = createShellExecutor(root);
      const result = await listFiles(shell, "linked-dir");
      assert.equal(result.success, true);
      const names = (result.data.files as Array<{ name: string }>).map((f) => f.name);
      assert.ok(names.includes("a.txt"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
