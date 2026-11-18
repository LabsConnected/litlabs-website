/**
 * Code scanner tests — VS Code-style codebase analysis model.
 *
 * Ported from Litlabsos (June 2026) alongside src/lib/code-scanner.ts.
 * The source repo had no tests for this module; these cover the pure
 * helpers (icons, size formatting, tree counting/search/lookup) and the
 * demo fixtures' shape.
 */

import { describe, it, expect } from "vitest";

import {
  DEMO_FILE_TREE,
  countFiles,
  formatFileSize,
  getFileByPath,
  getFileIcon,
  getFolderIcon,
  searchFileTree,
} from "@/lib/code-scanner";

describe("getFileIcon", () => {
  it("maps known extensions through their categories", () => {
    expect(getFileIcon("ts")).toBe("📘");
    expect(getFileIcon("tsx")).toBe("📘");
    expect(getFileIcon("js")).toBe("📒");
    expect(getFileIcon("py")).toBe("🐍");
    expect(getFileIcon("md")).toBe("📝");
  });

  it("falls back to the default icon for unknown or missing extensions", () => {
    expect(getFileIcon("xyz")).toBe("📄");
    expect(getFileIcon()).toBe("📄");
    expect(getFileIcon("")).toBe("📄");
  });
});

describe("getFolderIcon", () => {
  it("reflects open state", () => {
    expect(getFolderIcon(true)).toBe("📂");
    expect(getFolderIcon(false)).toBe("📁");
  });
});

describe("formatFileSize", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(1024)).toBe("1.0KB");
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0MB");
  });
});

describe("file tree helpers", () => {
  it("counts every file in the demo tree", () => {
    // 7 under src/app (incl. api + studio), 3 components, 4 lib,
    // 2 context, 4 at the root = 20 files.
    expect(countFiles(DEMO_FILE_TREE)).toBe(20);
  });

  it("counts a lone file node as 1 and an empty directory as 0", () => {
    expect(countFiles({ path: "/a.ts", name: "a.ts", type: "file" })).toBe(1);
    expect(countFiles({ path: "/d", name: "d", type: "directory", children: [] })).toBe(0);
  });

  it("finds nodes by path and misses cleanly", () => {
    const found = getFileByPath(DEMO_FILE_TREE, "/src/lib/agents.ts");
    expect(found?.name).toBe("agents.ts");
    expect(found?.type).toBe("file");
    expect(getFileByPath(DEMO_FILE_TREE, "/nope/missing.ts")).toBeUndefined();
  });

  it("searches names case-insensitively across the tree", () => {
    const results = searchFileTree(DEMO_FILE_TREE, "PAGE.TSX");
    expect(results.map((n) => n.path)).toEqual(
      expect.arrayContaining(["/src/app/page.tsx", "/src/app/studio/page.tsx"]),
    );
    expect(searchFileTree(DEMO_FILE_TREE, "zzz-no-match")).toEqual([]);
  });
});
