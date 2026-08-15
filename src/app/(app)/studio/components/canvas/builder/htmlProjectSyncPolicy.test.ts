import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Real tests for the HTML project sync policy module.
 * These test the actual pure functions, not mocked fetch itself.
 */

import {
  fetchServerFile,
  writeServerFile,
  loadServerFiles,
  reconcileLoad,
  saveServerFiles,
  readLocalCache,
  writeLocalCache,
  HTML_FILES,
  CACHE_KEY_PREFIX,
  type HtmlFile,
  type HtmlProject,
  type LoadResult,
} from "./htmlProjectSyncPolicy";

// Helper: create an HtmlFile with the correct language field
function file(name: string, content: string): HtmlFile {
  const language = name.endsWith(".css") ? "css" : name.endsWith(".js") ? "javascript" : "html";
  return { name, content, language };
}

// Helper: create a mock fetch that returns different responses per URL/call
function mockFetch(responses: Array<{
  status?: number;
  ok?: boolean;
  json?: () => Promise<unknown>;
  throw?: Error;
}>): typeof fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++];
    if (resp.throw) throw resp.throw;
    const status = resp.status ?? 200;
    const ok = resp.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      json: resp.json ?? (async () => ({})),
    } as Response;
  }) as unknown as typeof fetch;
}

const freshTemplate: HtmlProject = {
  files: [
    file("index.html", "<html><body>fresh</body></html>"),
    file("style.css", "body { margin: 0; }"),
    file("script.js", "console.log('fresh');"),
  ],
  activeFile: "index.html",
};

describe("fetchServerFile", () => {
  it("returns exists=true with content on HTTP 200", async () => {
    const f = mockFetch([{
      status: 200,
      json: async () => ({ content: "<html></html>" }),
    }]);
    const result = await fetchServerFile(f, "proj-A", "index.html");
    expect(result.exists).toBe(true);
    expect(result.content).toBe("<html></html>");
  });

  it("returns exists=true with empty string content on HTTP 200", async () => {
    const f = mockFetch([{
      status: 200,
      json: async () => ({ content: "" }),
    }]);
    const result = await fetchServerFile(f, "proj-A", "index.html");
    expect(result.exists).toBe(true);
    expect(result.content).toBe("");
  });

  it("returns exists=false on HTTP 404 (file not found)", async () => {
    const f = mockFetch([{ status: 404 }]);
    const result = await fetchServerFile(f, "proj-A", "index.html");
    expect(result.exists).toBe(false);
    expect(result.content).toBeNull();
  });

  it("throws on HTTP 500 (hard load failure)", async () => {
    const f = mockFetch([{
      status: 500,
      json: async () => ({ error: "Workspace not ready" }),
    }]);
    await expect(fetchServerFile(f, "proj-A", "index.html")).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws on HTTP 401 (hard load failure)", async () => {
    const f = mockFetch([{ status: 401 }]);
    await expect(fetchServerFile(f, "proj-A", "index.html")).rejects.toThrow(
      /HTTP 401/,
    );
  });

  it("throws on network error (hard load failure)", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(fetchServerFile(f, "proj-A", "index.html")).rejects.toThrow(
      /Network error/,
    );
  });
});

describe("writeServerFile", () => {
  it("succeeds silently on HTTP 200", async () => {
    const f = mockFetch([{ status: 200 }]);
    await expect(writeServerFile(f, "proj-A", "index.html", "<html></html>")).resolves.toBeUndefined();
  });

  it("throws on HTTP 500", async () => {
    const f = mockFetch([{
      status: 500,
      json: async () => ({ error: "Workspace not ready" }),
    }]);
    await expect(writeServerFile(f, "proj-A", "index.html", "x")).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws on network error", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(writeServerFile(f, "proj-A", "index.html", "x")).rejects.toThrow(
      /Network error/,
    );
  });
});

describe("loadServerFiles", () => {
  it("loads all 3 files when they exist on server", async () => {
    const f = mockFetch([
      { status: 200, json: async () => ({ content: "<html>A</html>" }) },
      { status: 200, json: async () => ({ content: "body{}" }) },
      { status: 200, json: async () => ({ content: "console.log('a');" }) },
    ]);
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("ok");
    expect(result.anyExists).toBe(true);
    expect(result.files).toHaveLength(3);
    expect(result.files[0].content).toBe("<html>A</html>");
  });

  it("reports anyExists=false when all files are 404", async () => {
    const f = mockFetch([
      { status: 404 },
      { status: 404 },
      { status: 404 },
    ]);
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("ok");
    expect(result.anyExists).toBe(false);
    expect(result.files).toHaveLength(0);
  });

  it("treats empty-content files as existing", async () => {
    const f = mockFetch([
      { status: 200, json: async () => ({ content: "" }) },
      { status: 200, json: async () => ({ content: "" }) },
      { status: 200, json: async () => ({ content: "" }) },
    ]);
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("ok");
    expect(result.anyExists).toBe(true);
    expect(result.files).toHaveLength(3);
    expect(result.files[0].content).toBe("");
  });

  it("aborts load with status=error when one file returns 500", async () => {
    const f = mockFetch([
      { status: 200, json: async () => ({ content: "<html>A</html>" }) },
      { status: 500, json: async () => ({ error: "Internal error" }) },
      { status: 200, json: async () => ({ content: "console.log('a');" }) },
    ]);
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/HTTP 500/);
    expect(result.files).toHaveLength(0);
  });

  it("aborts load with status=error on network failure", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Network error/);
  });

  it("mixed 200 + 404 loads successfully (some files missing)", async () => {
    const f = mockFetch([
      { status: 200, json: async () => ({ content: "<html>A</html>" }) },
      { status: 404 },
      { status: 200, json: async () => ({ content: "console.log('a');" }) },
    ]);
    const result = await loadServerFiles(f, "proj-A");
    expect(result.status).toBe("ok");
    expect(result.anyExists).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.name)).toEqual(["index.html", "script.js"]);
  });
});

describe("reconcileLoad", () => {
  it("server has files → action=server", () => {
    const loadResult: LoadResult = {
      status: "ok",
      anyExists: true,
      files: [file("index.html", "<html>server</html>")],
    };
    const result = reconcileLoad(loadResult, null, freshTemplate);
    expect(result.action).toBe("server");
    expect(result.files).toEqual(loadResult.files);
  });

  it("server empty + no local cache → action=seed", () => {
    const loadResult: LoadResult = {
      status: "ok",
      anyExists: false,
      files: [],
    };
    const result = reconcileLoad(loadResult, null, freshTemplate);
    expect(result.action).toBe("seed");
    expect(result.files).toEqual(freshTemplate.files);
  });

  it("server empty + local cache exists → action=recovery (NOT silent)", () => {
    const loadResult: LoadResult = {
      status: "ok",
      anyExists: false,
      files: [],
    };
    const localCache: HtmlProject = {
      files: [file("index.html", "<html>cached</html>")],
      activeFile: "index.html",
    };
    const result = reconcileLoad(loadResult, localCache, freshTemplate);
    expect(result.action).toBe("recovery");
    expect(result.files).toEqual(localCache.files);
  });

  it("server wins over local cache when server has files", () => {
    const loadResult: LoadResult = {
      status: "ok",
      anyExists: true,
      files: [file("index.html", "<html>server</html>")],
    };
    const localCache: HtmlProject = {
      files: [file("index.html", "<html>cached</html>")],
      activeFile: "index.html",
    };
    const result = reconcileLoad(loadResult, localCache, freshTemplate);
    expect(result.action).toBe("server");
    expect(result.files).toEqual(loadResult.files);
  });
});

describe("saveServerFiles", () => {
  it("succeeds when all writes return 2xx", async () => {
    const f = mockFetch([
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ]);
    await expect(
      saveServerFiles(f, "proj-A", freshTemplate.files),
    ).resolves.toBeUndefined();
  });

  it("throws when any write returns 500", async () => {
    const f = mockFetch([
      { status: 200 },
      { status: 500, json: async () => ({ error: "Workspace error" }) },
      { status: 200 },
    ]);
    await expect(
      saveServerFiles(f, "proj-A", freshTemplate.files),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("localStorage cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readLocalCache returns null when no cache exists", () => {
    expect(readLocalCache("proj-A")).toBeNull();
  });

  it("writeLocalCache + readLocalCache round-trips a project", () => {
    const project: HtmlProject = {
      files: [file("index.html", "<html>cached</html>")],
      activeFile: "index.html",
    };
    writeLocalCache("proj-A", project);
    const result = readLocalCache("proj-A");
    expect(result).not.toBeNull();
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].content).toBe("<html>cached</html>");
  });

  it("caches are isolated per projectId", () => {
    const projectA: HtmlProject = {
      files: [file("index.html", "<html>A</html>")],
      activeFile: "index.html",
    };
    const projectB: HtmlProject = {
      files: [file("index.html", "<html>B</html>")],
      activeFile: "index.html",
    };
    writeLocalCache("proj-A", projectA);
    writeLocalCache("proj-B", projectB);
    expect(readLocalCache("proj-A")?.files[0].content).toBe("<html>A</html>");
    expect(readLocalCache("proj-B")?.files[0].content).toBe("<html>B</html>");
  });

  it("readLocalCache returns null for invalid cache", () => {
    localStorage.setItem(CACHE_KEY_PREFIX + "proj-A", "{invalid json");
    expect(readLocalCache("proj-A")).toBeNull();
  });

  it("readLocalCache returns null for cache with empty files array", () => {
    localStorage.setItem(
      CACHE_KEY_PREFIX + "proj-A",
      JSON.stringify({ files: [], activeFile: "index.html" }),
    );
    expect(readLocalCache("proj-A")).toBeNull();
  });
});

describe("cross-project isolation (policy-level)", () => {
  it("HTML_FILES has exactly 3 canonical files", () => {
    expect(HTML_FILES).toEqual(["index.html", "style.css", "script.js"]);
  });

  it("loadServerFiles for project A does not affect project B", async () => {
    const fA = mockFetch([
      { status: 200, json: async () => ({ content: "<html>A</html>" }) },
      { status: 200, json: async () => ({ content: "a{}" }) },
      { status: 200, json: async () => ({ content: "console.log('a');" }) },
    ]);
    const fB = mockFetch([
      { status: 200, json: async () => ({ content: "<html>B</html>" }) },
      { status: 200, json: async () => ({ content: "b{}" }) },
      { status: 200, json: async () => ({ content: "console.log('b');" }) },
    ]);

    const resultA = await loadServerFiles(fA, "proj-A");
    const resultB = await loadServerFiles(fB, "proj-B");

    expect(resultA.files[0].content).toBe("<html>A</html>");
    expect(resultB.files[0].content).toBe("<html>B</html>");
    expect(resultA.files[0].content).not.toBe(resultB.files[0].content);
  });
});
