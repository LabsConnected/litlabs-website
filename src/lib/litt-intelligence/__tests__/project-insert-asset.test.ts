/**
 * project.insert_asset — closes the "generate → site" loop.
 *
 * Regression tests for: generated images only ever rendered in chat
 * (image.generate returns a downloadUrl for inline chat rendering) and
 * never landed in the website project, because the agent had no binary
 * write path and no instruction to insert them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import { handleProjectInsertAsset, insertAssetFromUrl } from "../tool-handlers-v2";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function mockImageResponse(opts?: {
  contentType?: string;
  bytes?: Buffer;
  status?: number;
}) {
  const bytes = opts?.bytes ?? PNG_BYTES;
  const status = opts?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? (opts?.contentType ?? "image/png")
          : null,
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function spyTransport() {
  return {
    workspaceId: "ws-1",
    userId: "u-1",
    projectId: "p-1",
    writeBinaryFile: vi.fn(async () => ({ saved: true })),
  } as unknown as WorkspaceTransport & {
    writeBinaryFile: ReturnType<typeof vi.fn>;
  };
}

describe("handleProjectInsertAsset", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("downloads an image and writes it into public/assets/images, returning the site path", async () => {
    globalThis.fetch = vi.fn(async () => mockImageResponse()) as unknown as typeof fetch;
    const t = spyTransport();

    const res = await handleProjectInsertAsset(
      { url: "https://example.com/hero.png", name: "hero-sunset" },
      t,
    );

    expect(res.success).toBe(true);
    expect(t.writeBinaryFile).toHaveBeenCalledTimes(1);
    const [path, base64] = t.writeBinaryFile.mock.calls[0];
    expect(path).toMatch(/^public\/assets\/images\/hero-sunset-[a-z0-9]+\.png$/);
    expect(Buffer.from(base64, "base64").length).toBe(PNG_BYTES.length);
    expect(res.sitePath).toBe(`/${(path as string).replace(/^public\//, "")}`);
    expect(res.hint).toContain(res.sitePath as string);
  });

  it("rejects non-HTTPS URLs", async () => {
    const t = spyTransport();
    const res = await handleProjectInsertAsset({ url: "http://example.com/x.png" }, t);
    expect(res.success).toBe(false);
    expect(res.error).toContain("HTTPS");
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("saves a data:image/* URL — the free-provider downloadUrl shape", async () => {
    const t = spyTransport();
    const res = await handleProjectInsertAsset(
      { url: `data:image/png;base64,${PNG_BYTES.toString("base64")}`, name: "hero-sunset" },
      t,
    );
    expect(res.success).toBe(true);
    expect(t.writeBinaryFile).toHaveBeenCalledTimes(1);
    const [path, base64] = t.writeBinaryFile.mock.calls[0];
    expect(path).toMatch(/^public\/assets\/images\/hero-sunset-[a-z0-9]+\.png$/);
    expect(Buffer.from(base64, "base64")).toEqual(PNG_BYTES);
    expect(res.sitePath).toBe(`/${(path as string).replace(/^public\//, "")}`);
  });

  it("rejects a missing url", async () => {
    const t = spyTransport();
    const res = await handleProjectInsertAsset({}, t);
    expect(res.success).toBe(false);
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("rejects non-image content types", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ contentType: "text/html" }),
    ) as unknown as typeof fetch;
    const t = spyTransport();
    const res = await handleProjectInsertAsset({ url: "https://example.com/x" }, t);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Not an image");
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("rejects unsafe directories", async () => {
    const t = spyTransport();
    const res = await handleProjectInsertAsset(
      { url: "https://example.com/x.png", directory: "../secrets" },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid directory");
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("fails closed when the download fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const t = spyTransport();
    const res = await handleProjectInsertAsset({ url: "https://example.com/x.png" }, t);
    expect(res.success).toBe(false);
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("fails closed on HTTP errors", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ status: 404 }),
    ) as unknown as typeof fetch;
    const t = spyTransport();
    const res = await handleProjectInsertAsset({ url: "https://example.com/x.png" }, t);
    expect(res.success).toBe(false);
    expect(res.error).toContain("404");
    expect(t.writeBinaryFile).not.toHaveBeenCalled();
  });
});

describe("project.insert_asset — registration", () => {
  it("is registered in the tool registry with files:write permission", async () => {
    const { toolRegistry, registerInternalTools } = await import("../tool-registry");
    registerInternalTools();
    const def = toolRegistry.get("project.insert_asset");
    expect(def).toBeDefined();
    expect(def?.requiredPermissions).toContain("files:write");
    expect(def?.enabled).toBe(true);
    expect(def?.readOnly).toBe(false);
  });

  it("appears in the runtime manifest, gated on an active project", async () => {
    const { buildToolManifest } = await import("../runtime-context-injector");
    const base = {
      projectId: "p-1",
      projectName: "Test Project",
      repositoryConnected: false,
      repositoryName: null,
      activeBranch: null,
      workspaceStatus: null,
      workspaceReady: false,
      terminalConnected: false,
      terminalStatus: null,
      terminalSessionId: null,
      deploymentStatus: null,
      deploymentUrl: null,
      writeAccess: false,
      approvalRequired: true,
      selectedModelLabel: null,
      selectedModelId: null,
      activeAgentMode: "builder",
      activeAgentSlug: "builder",
      recentHealthResults: [],
    } as const;
    const withProject = buildToolManifest({ ...base } as never);
    const tool = withProject.tools.find((t) => t.id === "project.insert_asset");
    expect(tool).toBeDefined();
    expect(tool?.available).toBe(true);

    const withoutProject = buildToolManifest({ ...base, projectId: null } as never);
    const gated = withoutProject.tools.find((t) => t.id === "project.insert_asset");
    expect(gated?.available).toBe(false);
    expect(gated?.unavailableReason).toContain("No active project");
  });

  it("builder and standard prompts teach the generate → insert → reference loop", async () => {
    const { AGENT_PROFILES } = await import("../agent-profiles");
    for (const mode of ["builder", "standard"] as const) {
      const prompt = AGENT_PROFILES[mode].systemPrompt;
      expect(prompt).toContain("project.insert_asset");
      expect(prompt).toContain("image.generate");
    }
  });
});

describe("insertAssetFromUrl (shared core)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("saves the image and returns the exact sitePath the agent must reference", async () => {
    globalThis.fetch = vi.fn(async () => mockImageResponse()) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/hero.png", { nameHint: "hero" }, transport);
    expect(result.success).toBe(true);
    expect(result.sitePath).toMatch(/^\/assets\/images\/hero-[a-z0-9]+\.png$/);
    expect(transport.writeBinaryFile).toHaveBeenCalledTimes(1);
    const [writtenPath, b64] = transport.writeBinaryFile.mock.calls[0];
    expect(writtenPath).toBe(`public${result.sitePath}`);
    expect(Buffer.from(b64 as string, "base64").length).toBe(PNG_BYTES.length);
  });

  it("rejects non-HTTPS URLs", async () => {
    globalThis.fetch = vi.fn(async () => mockImageResponse()) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("http://cdn.example.com/hero.png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("saves a data:image/* URL inline — no network fetch", async () => {
    const fetchSpy = vi.fn(async () => mockImageResponse());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl(
      `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      { nameHint: "hero" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(result.sitePath).toMatch(/^\/assets\/images\/hero-[a-z0-9]+\.png$/);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [writtenPath, b64] = transport.writeBinaryFile.mock.calls[0];
    expect(writtenPath).toBe(`public${result.sitePath}`);
    expect(Buffer.from(b64 as string, "base64")).toEqual(PNG_BYTES);
  });

  it("derives the file extension from the data URL MIME type", async () => {
    const transport = spyTransport();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const result = await insertAssetFromUrl(
      `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      { nameHint: "hero" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(result.sitePath).toMatch(/\.jpeg$/);
  });

  it("rejects non-image data URLs", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl(
      `data:text/html;base64,${Buffer.from("<html></html>").toString("base64")}`,
      {},
      transport,
    );
    expect(result.success).toBe(false);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("rejects malformed data:image URLs", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl("data:image/png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Malformed/i);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("rejects unsafe directories", async () => {
    globalThis.fetch = vi.fn(async () => mockImageResponse()) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl(
      "https://cdn.example.com/hero.png",
      { directory: "../../etc" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid directory/i);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("rejects non-image content types", async () => {
    globalThis.fetch = vi.fn(
      async () => mockImageResponse({ contentType: "text/html" }),
    ) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/page", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not an image/i);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("surfaces download failures as errors, never exceptions", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/hero.png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });
});
