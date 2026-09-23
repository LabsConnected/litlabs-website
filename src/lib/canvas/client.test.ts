import { describe, expect, it } from "vitest";
import {
  blockToFile,
  diffFilesAgainstBlocks,
  fileToBlockInput,
} from "./client";
import type { CanvasBlock } from "./types";

function fileBlock(
  overrides: Partial<CanvasBlock> & { content?: Record<string, unknown> } = {},
): CanvasBlock {
  return {
    id: "block-1",
    canvasId: "canvas-1",
    userId: "user-1",
    type: "file",
    content: { path: "index.html", content: "<h1>hi</h1>", language: "html" },
    position: 0,
    metadata: {},
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
    ...overrides,
  } as CanvasBlock;
}

describe("blockToFile", () => {
  it("maps a file block to a CanvasFile", () => {
    expect(blockToFile(fileBlock())).toEqual({
      name: "index.html",
      content: "<h1>hi</h1>",
      language: "html",
      blockId: "block-1",
    });
  });

  it("returns null for non-file blocks (never managed or deleted by CanvasTool)", () => {
    expect(blockToFile(fileBlock({ type: "note", content: { text: "x" } }))).toBeNull();
    expect(blockToFile(fileBlock({ type: "code", content: { code: "x", language: "ts" } }))).toBeNull();
  });

  it("returns null for malformed file content", () => {
    expect(blockToFile(fileBlock({ content: {} }))).toBeNull();
    expect(blockToFile(fileBlock({ content: { path: "a.html" } }))).toBeNull();
    expect(blockToFile(fileBlock({ content: null as unknown as Record<string, unknown> }))).toBeNull();
  });

  it("defaults a missing language to text", () => {
    const f = blockToFile(fileBlock({ content: { path: "a", content: "b" } }));
    expect(f?.language).toBe("text");
  });
});

describe("fileToBlockInput", () => {
  it("builds the file block payload", () => {
    expect(
      fileToBlockInput({ name: "app.js", content: "console.log(1)", language: "js" }, 2),
    ).toEqual({
      type: "file",
      content: { path: "app.js", content: "console.log(1)", language: "js" },
      position: 2,
    });
  });
});

describe("diffFilesAgainstBlocks", () => {
  it("reports no ops when files match blocks", () => {
    const blocks = [fileBlock()];
    const diff = diffFilesAgainstBlocks(
      [{ name: "index.html", content: "<h1>hi</h1>", language: "html" }],
      blocks,
    );
    expect(diff).toEqual({ toAdd: [], toUpdate: [], toDelete: [] });
  });

  it("queues new files for add with their position", () => {
    const diff = diffFilesAgainstBlocks(
      [
        { name: "a.html", content: "a", language: "html" },
        { name: "b.css", content: "b", language: "css" },
      ],
      [],
    );
    expect(diff.toAdd).toEqual([
      { file: { name: "a.html", content: "a", language: "html" }, position: 0 },
      { file: { name: "b.css", content: "b", language: "css" }, position: 1 },
    ]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
  });

  it("queues changed content for update (not add)", () => {
    const diff = diffFilesAgainstBlocks(
      [{ name: "index.html", content: "<h1>CHANGED</h1>", language: "html" }],
      [fileBlock()],
    );
    expect(diff.toAdd).toEqual([]);
    expect(diff.toDelete).toEqual([]);
    expect(diff.toUpdate).toEqual([
      {
        blockId: "block-1",
        file: { name: "index.html", content: "<h1>CHANGED</h1>", language: "html" },
      },
    ]);
  });

  it("queues removed files for delete by block id", () => {
    const diff = diffFilesAgainstBlocks([], [fileBlock()]);
    expect(diff.toAdd).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual(["block-1"]);
  });

  it("never deletes non-file blocks", () => {
    const note = fileBlock({ id: "block-note", type: "note", content: { text: "keep me" } });
    const diff = diffFilesAgainstBlocks([], [note]);
    expect(diff.toDelete).toEqual([]);
  });

  it("handles a mixed add/update/delete in one pass", () => {
    const blocks = [
      fileBlock({ id: "b-keep", content: { path: "keep.html", content: "same", language: "html" } }),
      fileBlock({ id: "b-edit", content: { path: "edit.html", content: "old", language: "html" } }),
      fileBlock({ id: "b-gone", content: { path: "gone.html", content: "x", language: "html" } }),
    ];
    const diff = diffFilesAgainstBlocks(
      [
        { name: "keep.html", content: "same", language: "html" },
        { name: "edit.html", content: "new", language: "html" },
        { name: "fresh.html", content: "fresh", language: "html" },
      ],
      blocks,
    );
    expect(diff.toAdd.map((a) => a.file.name)).toEqual(["fresh.html"]);
    expect(diff.toUpdate.map((u) => u.blockId)).toEqual(["b-edit"]);
    expect(diff.toDelete).toEqual(["b-gone"]);
  });

  it("matches on path: a renamed file is add + delete", () => {
    const diff = diffFilesAgainstBlocks(
      [{ name: "renamed.html", content: "<h1>hi</h1>", language: "html" }],
      [fileBlock()],
    );
    expect(diff.toAdd.map((a) => a.file.name)).toEqual(["renamed.html"]);
    expect(diff.toDelete).toEqual(["block-1"]);
  });
});
