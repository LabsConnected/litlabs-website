import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isOverwritableByGenerator,
  buildSiteHtml,
  exportCanvasToSite,
  syncCanvasSiteFromFile,
  GENERATED_SITE_MARKER,
} from "./canvas-site-export";
import type { CanvasDocument } from "./types";

const doc = {
  id: "doc-1",
  route: "/",
  nodes: {
    n1: {
      id: "n1",
      type: "heading" as const,
      props: { text: "Hello site" },
      styles: {},
      children: [],
    },
  },
  rootNodeIds: ["n1"],
  version: 1,
  updatedAt: 1000,
} as unknown as CanvasDocument;

function mockFilesApi(existing: string | null, writeOk = true) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
    if (body.action === "read") {
      return new Response(
        JSON.stringify(existing == null ? { error: "not found" } : { content: existing }),
        { status: existing == null ? 404 : 200 },
      );
    }
    return new Response(JSON.stringify({ ok: writeOk }), { status: writeOk ? 200 : 500 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isOverwritableByGenerator", () => {
  it("allows absent/empty files", () => {
    expect(isOverwritableByGenerator(null)).toBe(true);
    expect(isOverwritableByGenerator("   ")).toBe(true);
  });
  it("allows previously generated output and starter scaffold", () => {
    expect(isOverwritableByGenerator(`<!-- ${GENERATED_SITE_MARKER} --><html></html>`)).toBe(true);
    expect(isOverwritableByGenerator(`<!-- LITT-WELCOME-SCREEN: blank-state --><html></html>`)).toBe(true);
  });
  it("refuses foreign user-authored content", () => {
    expect(isOverwritableByGenerator(`<!DOCTYPE html><html><body>my hand work</body></html>`)).toBe(false);
  });
});

describe("buildSiteHtml", () => {
  it("carries the generator marker so later exports stay idempotent", () => {
    const html = buildSiteHtml(doc);
    expect(html.startsWith(`<!-- ${GENERATED_SITE_MARKER}`)).toBe(true);
    expect(html).toContain("Hello site");
  });
});

describe("exportCanvasToSite", () => {
  it("writes index.html when the file is absent", async () => {
    const fetchMock = mockFilesApi(null);
    vi.stubGlobal("fetch", fetchMock);
    const res = await exportCanvasToSite("proj-1", doc);
    expect(res.status).toBe("written");
    const writeCall = fetchMock.mock.calls.find((c) => String(c[1]?.body).includes('"write"'));
    expect(String(writeCall?.[1]?.body)).toContain(GENERATED_SITE_MARKER);
  });

  it("returns conflict without writing when index.html is foreign", async () => {
    const fetchMock = mockFilesApi(`<!DOCTYPE html><html><body>hand-built</body></html>`);
    vi.stubGlobal("fetch", fetchMock);
    const res = await exportCanvasToSite("proj-1", doc);
    expect(res.status).toBe("conflict");
    expect(fetchMock.mock.calls.some((c) => String(c[1]?.body).includes('"write"'))).toBe(false);
  });

  it("overwrites previously generated content", async () => {
    const fetchMock = mockFilesApi(`<!-- ${GENERATED_SITE_MARKER} -->\n<html>old</html>`);
    vi.stubGlobal("fetch", fetchMock);
    const res = await exportCanvasToSite("proj-1", doc);
    expect(res.status).toBe("written");
  });

  it("surfaces a write failure as error, never as success", async () => {
    const fetchMock = mockFilesApi(null, false);
    vi.stubGlobal("fetch", fetchMock);
    const res = await exportCanvasToSite("proj-1", doc);
    expect(res.status).toBe("error");
  });
});

describe("syncCanvasSiteFromFile (publish/save compile path)", () => {
  function mockWorkspaceFiles(files: Record<string, string | null>) {
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
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "bad action" }), { status: 400 });
    });
    return { fetchMock, writes };
  }

  it("returns no-canvas and writes nothing when the project has no canvas document", async () => {
    const { fetchMock, writes } = mockWorkspaceFiles({
      ".litt/canvas.json": null,
      "index.html": null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await syncCanvasSiteFromFile("proj-1");
    expect(res.status).toBe("no-canvas");
    expect(writes).toHaveLength(0);
  });

  it("compiles the stored canvas into index.html over the starter scaffold", async () => {
    const { fetchMock, writes } = mockWorkspaceFiles({
      ".litt/canvas.json": JSON.stringify(doc),
      "index.html": "<!-- LITT-WELCOME-SCREEN: blank-state --><html></html>",
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await syncCanvasSiteFromFile("proj-1");
    expect(res.status).toBe("written");
    const siteWrite = writes.find((w) => w.path === "index.html");
    expect(siteWrite?.content).toContain(GENERATED_SITE_MARKER);
    expect(siteWrite?.content).toContain("Hello site");
  });

  it("returns conflict and writes nothing when index.html is user-authored", async () => {
    const { fetchMock, writes } = mockWorkspaceFiles({
      ".litt/canvas.json": JSON.stringify(doc),
      "index.html": "<!DOCTYPE html><html><body>hand-built</body></html>",
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await syncCanvasSiteFromFile("proj-1");
    expect(res.status).toBe("conflict");
    expect(writes).toHaveLength(0);
  });

  it("treats a malformed canvas document as no-canvas instead of throwing", async () => {
    const { fetchMock, writes } = mockWorkspaceFiles({
      ".litt/canvas.json": "{not json",
      "index.html": null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await syncCanvasSiteFromFile("proj-1");
    expect(res.status).toBe("no-canvas");
    expect(writes).toHaveLength(0);
  });
});
