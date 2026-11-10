import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCanvasFileSync } from "./useCanvasFileSync";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";

/**
 * P0-1 regression: saving the canvas must compile it into the real
 * index.html — not just persist .litt/canvas.json. Before the fix the
 * autosave wrote only the canvas document, so the workspace preview and
 * the publish pipeline kept serving the starter scaffold.
 */

const BASE_TS = 9_999_999_999_000;

function makeDoc(text: string, updatedAt: number): CanvasDocument {
  return {
    id: "doc-1",
    route: "/",
    nodes: {
      n1: {
        id: "n1",
        type: "heading",
        props: { text },
        styles: {},
        children: [],
      },
    },
    rootNodeIds: ["n1"],
    version: 1,
    updatedAt,
  } as unknown as CanvasDocument;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCanvasFileSync — autosave compiles canvas to index.html", () => {
  it("writes rendered site HTML to index.html after a canvas edit is saved", async () => {
    const files: Record<string, string | null> = {
      ".litt/canvas.json": JSON.stringify(makeDoc("Version one", BASE_TS)),
      "index.html": "<!-- LITT-WELCOME-SCREEN: blank-state --><html></html>",
    };
    const writes: Array<{ path: string; content: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        action?: string;
        path?: string;
        content?: string;
      };
      if (body.action === "read") {
        const content = body.path ? files[body.path] : null;
        return new Response(
          JSON.stringify(content == null ? { error: "not found" } : { content }),
          { status: content == null ? 404 : 200 },
        );
      }
      if (body.action === "write") {
        writes.push({ path: String(body.path), content: String(body.content ?? "") });
        if (body.path) files[body.path] = String(body.content ?? "");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "bad action" }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useCanvasFileSync("proj-1"));

    // Let the load effect adopt the server document.
    await waitFor(() => {
      expect(useCanvasBuilderStore.getState().document.updatedAt).toBe(BASE_TS);
    });

    act(() => {
      useCanvasBuilderStore.getState().setDocument(makeDoc("Edited headline", BASE_TS + 1000));
    });

    // Debounced autosave (1200ms) must write BOTH the canvas document and
    // the compiled site entry file.
    await waitFor(
      () => {
        const siteWrite = writes.find((w) => w.path === "index.html");
        expect(siteWrite?.content).toContain("Edited headline");
        expect(siteWrite?.content).toContain("LITT-GENERATED-SITE");
      },
      { timeout: 5000 },
    );
    expect(writes.some((w) => w.path === ".litt/canvas.json")).toBe(true);
  });
});
