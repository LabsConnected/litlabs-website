import { describe, it, expect } from "vitest";
import {
  buildFileTree,
  searchFileTree,
  getFileByPath,
  countFiles,
  formatFileSize,
  getFileIcon,
  type ScannedFile,
} from "@/lib/code-scanner";

describe("code-scanner helpers", () => {
  const files: ScannedFile[] = [
    { path: "/src/app/page.tsx", type: "tsx", size: 1024, lineCount: 40 },
    { path: "/src/lib/utils.ts", type: "ts", size: 512, lineCount: 20 },
    { path: "/public/favicon.ico", type: "ico", size: 64, lineCount: 0 },
  ];

  it("builds a sorted nested tree from a flat file list", () => {
    const tree = buildFileTree("project", files);
    expect(tree.type).toBe("directory");
    expect(tree.name).toBe("project");
    expect(countFiles(tree)).toBe(3);

    const appDir = tree.children?.find((c) => c.name === "src")?.children?.find((c) => c.name === "app");
    expect(appDir?.type).toBe("directory");
    expect(appDir?.children?.map((c) => c.name)).toEqual(["page.tsx"]);
  });

  it("searches the tree by name", () => {
    const tree = buildFileTree("project", files);
    const results = searchFileTree(tree, "utils");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("utils.ts");
  });

  it("retrieves a file node by path", () => {
    const tree = buildFileTree("project", files);
    const file = getFileByPath(tree, "/src/lib/utils.ts");
    expect(file?.type).toBe("file");
    expect(file?.size).toBe(512);
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(1024 * 1024 * 2)).toBe("2.0MB");
  });

  it("returns the correct icon for known extensions", () => {
    expect(getFileIcon("ts")).toBe("📘");
    expect(getFileIcon("tsx")).toBe("📘");
    expect(getFileIcon("unknown")).toBe("📄");
  });
});
