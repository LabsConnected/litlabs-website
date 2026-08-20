/**
 * FileTree tests — project file discovery for the @ picker and /files.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverFiles } from "../lib/file-tree.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "litt-files-"));
  writeFileSync(join(dir, "package.json"), "{}", "utf8");
  mkdirSync(join(dir, "src", "ink"), { recursive: true });
  writeFileSync(join(dir, "src", "ink", "app.tsx"), "// app", "utf8");
  writeFileSync(join(dir, "src", "index.ts"), "// index", "utf8");
  // Vendored / generated dirs must be skipped.
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "x", "utf8");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "bundle.js"), "x", "utf8");
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "x", "utf8");
  // Hidden files are skipped except a small allowlist.
  writeFileSync(join(dir, ".env"), "SECRET=1", "utf8");
  writeFileSync(join(dir, ".gitignore"), "node_modules", "utf8");
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("file-tree", () => {
  it("discovers project files with forward-slash relative paths", () => {
    const files = discoverFiles(dir);
    expect(files).toContain("package.json");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/ink/app.tsx");
    expect(files).toContain(".gitignore");
  });

  it("skips node_modules, dist, .git, and hidden files", () => {
    const files = discoverFiles(dir);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
    expect(files).not.toContain(".env");
  });

  it("respects the cap", () => {
    const files = discoverFiles(dir, 2);
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it("returns [] for an unreadable path", () => {
    expect(discoverFiles(join(dir, "nope"))).toEqual([]);
  });
});
