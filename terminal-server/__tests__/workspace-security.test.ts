/**
 * Regression tests for WorkspaceSecurity.resolveWorkspacePath hardening.
 *
 * Covers the symlink-escape gap previously present in the terminal-server
 * HTTP file endpoints (/files/*, /ws-files/*), which used lexical-only
 * path checks: `ln -s /etc link` + read `link/passwd` escaped the workspace.
 * The hardened resolver canonicalizes the nearest existing ancestor, so
 * even writes of NEW files through a symlinked parent directory are rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveWorkspacePath, validateWritePayload, MAX_BINARY_WRITE_SIZE } from "../workspace/WorkspaceSecurity";

describe("resolveWorkspacePath", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ws-root-"));
    outside = mkdtempSync(join(tmpdir(), "ws-outside-"));
    writeFileSync(join(outside, "secret.txt"), "top secret");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("allows a normal nested path", () => {
    mkdirSync(join(root, "sub"), { recursive: true });
    const target = resolveWorkspacePath(root, "sub/file.txt");
    expect(target).toBe(join(root, "sub", "file.txt"));
  });

  it("rejects parent-directory escape", () => {
    expect(() => resolveWorkspacePath(root, "../evil.txt")).toThrow();
  });

  it("rejects absolute paths", () => {
    expect(() => resolveWorkspacePath(root, "/etc/passwd")).toThrow();
  });

  it("rejects empty paths", () => {
    expect(() => resolveWorkspacePath(root, "")).toThrow();
  });

  it("rejects symlink escape when the target exists", () => {
    symlinkSync(outside, join(root, "link"));
    expect(() => resolveWorkspacePath(root, "link/secret.txt")).toThrow(
      "Symlink escapes workspace root",
    );
  });

  it("rejects writes of new files through a symlinked parent directory", () => {
    // The exact bypass shape: the file does not exist yet, so a
    // target-only realpath check would miss the symlinked parent.
    symlinkSync(outside, join(root, "link"));
    expect(() => resolveWorkspacePath(root, "link/evil-new-file.txt")).toThrow(
      "Symlink escapes workspace root",
    );
  });

  it("rejects symlink escape through a nested symlinked directory", () => {
    mkdirSync(join(root, "a", "b"), { recursive: true });
    symlinkSync(outside, join(root, "a", "b", "deep-link"));
    expect(() => resolveWorkspacePath(root, "a/b/deep-link/new.txt")).toThrow(
      "Symlink escapes workspace root",
    );
  });

  it("allows symlinks that stay inside the workspace", () => {
    mkdirSync(join(root, "real"), { recursive: true });
    writeFileSync(join(root, "real", "ok.txt"), "fine");
    symlinkSync(join(root, "real"), join(root, "safe-link"));
    const target = resolveWorkspacePath(root, "safe-link/ok.txt");
    expect(target).toBe(join(root, "safe-link", "ok.txt"));
  });

  it("allows creating new files in normal subdirectories", () => {
    mkdirSync(join(root, "newdir"), { recursive: true });
    const target = resolveWorkspacePath(root, "newdir/created.txt");
    expect(target).toBe(join(root, "newdir", "created.txt"));
  });
});

describe("validateWritePayload", () => {
  it("accepts text writes under the 1MB cap", () => {
    const check = validateWritePayload("utf-8", "hello world");
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.binary).toBeNull();
  });

  it("rejects text writes over the 1MB cap with 413", () => {
    const check = validateWritePayload("utf-8", "x".repeat(1024 * 1024 + 1));
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(413);
      expect(check.error).toMatch(/max write size/i);
    }
  });

  it("accepts a 2MB image: the binary cap is measured on decoded bytes, not the base64 string", () => {
    // Regression: the old /ws-files/write route measured the base64 STRING
    // against 1MB, silently rejecting every generated image over ~750KB —
    // the 2026-09-17 acceptance P0 (broken hero image, file never saved).
    const binary = Buffer.alloc(2 * 1024 * 1024, 0x89);
    const check = validateWritePayload("base64", binary.toString("base64"));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.binary).toBeInstanceOf(Buffer);
      expect(check.binary!.length).toBe(2 * 1024 * 1024);
    }
  });

  it("accepts a binary write at exactly the 50MB advertised cap", () => {
    const binary = Buffer.alloc(MAX_BINARY_WRITE_SIZE, 0x89);
    const check = validateWritePayload("base64", binary.toString("base64"));
    expect(check.ok).toBe(true);
  });

  it("rejects decoded binaries over the 50MB cap with 413", () => {
    const binary = Buffer.alloc(MAX_BINARY_WRITE_SIZE + 1, 0x89);
    const check = validateWritePayload("base64", binary.toString("base64"));
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(413);
      expect(check.error).toMatch(/exceeds max write size/i);
    }
  });

  it("rejects empty base64 payloads with 400", () => {
    const check = validateWritePayload("base64", "");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.status).toBe(400);
  });
});
