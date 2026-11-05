import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsertAssetFromUrl } = vi.hoisted(() => ({
  mockInsertAssetFromUrl: vi.fn(),
}));
vi.mock("@/lib/litt-intelligence/tool-handlers-v2", () => ({
  insertAssetFromUrl: (...args: unknown[]) => mockInsertAssetFromUrl(...args),
}));

import { auditStaticSiteHtml } from "./audit";
import { enrichStaticSiteVisuals } from "./enrich";
import { resolveSlotImage } from "./resolver";

// A tiny valid JPEG header so nothing downstream complains about content.
function fakeImageResponse(url = "https://img.example/photo.jpg") {
  const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "image/jpeg"]]),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    url,
  };
}

interface FakeTransport {
  files: Map<string, string>;
  binary: Map<string, string>;
  listFiles: (p: string) => Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile: (p: string) => Promise<{ content: string; size: number }>;
  writeFile: (p: string, c: string) => Promise<{ saved: boolean }>;
  writeBinaryFile: (p: string, b64: string) => Promise<{ saved: boolean }>;
  projectId: string;
  workspaceId: string;
  userId: string;
}

function makeTransport(files: Record<string, string>): FakeTransport {
  const map = new Map(Object.entries(files));
  const binary = new Map<string, string>();
  return {
    files: map,
    binary,
    projectId: "p1",
    workspaceId: "w1",
    userId: "u1",
    async listFiles(dir) {
      const prefix = dir ? `${dir}/` : "";
      const names = new Map<string, string>();
      for (const k of [...map.keys(), ...binary.keys()]) {
        if (dir && !k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const seg = rest.split("/")[0];
        names.set(seg, rest.includes("/") ? "directory" : "file");
      }
      if (!dir) names.delete(""); // root
      return { entries: [...names].map(([name, type]) => ({ name, type })) };
    },
    async readFile(p) {
      const c = map.get(p);
      if (c === undefined) throw new Error(`ENOENT ${p}`);
      return { content: c, size: c.length };
    },
    async writeFile(p, c) {
      map.set(p, c);
      return { saved: true };
    },
    async writeBinaryFile(p, b64) {
      binary.set(p, b64);
      return { saved: true };
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockInsertAssetFromUrl.mockReset();
  delete process.env.PEXELS_API_KEY;
});

describe("audit", () => {
  it("extracts data-litt-image slots and reports missing imagery", () => {
    const html = `<html><body><section class="hero"><h1>Ember Roast</h1></section>
      <img data-litt-image="coffee beans" alt="beans"></body></html>`;
    const audit = auditStaticSiteHtml(html, new Set(["index.html"]));
    expect(audit.slotCount).toBe(1);
    // An unmaterialized data-litt-image slot in the hero slice counts as
    // intended hero imagery — the gate fires only when nothing exists.
    expect(audit.hasHeroImagery).toBe(true);
  });

  it("flags broken relative refs, hotlinks and placeholders", () => {
    const html = `<img src="assets/images/missing.jpg">
      <img src="https://cdn.example.com/photo.jpg">
      <img src="https://via.placeholder.com/600x400">
      <img src="assets/images/real.jpg">`;
    const audit = auditStaticSiteHtml(html, new Set(["index.html", "assets/images/real.jpg"]));
    expect(audit.brokenRefs).toEqual(["assets/images/missing.jpg"]);
    expect(audit.externalRefs).toEqual(["https://cdn.example.com/photo.jpg"]);
    expect(audit.placeholderRefs).toContain("https://via.placeholder.com/600x400");
  });

  it("treats existing assets as resolved", () => {
    const audit = auditStaticSiteHtml(
      `<div class="hero"><img src="assets/images/hero.jpg"></div>`,
      new Set(["index.html", "assets/images/hero.jpg"]),
    );
    expect(audit.brokenRefs).toEqual([]);
    expect(audit.hasHeroImagery).toBe(true);
  });
});

describe("resolveSlotImage", () => {
  it("returns the first probed free provider URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => fakeImageResponse(String(url))));
    const resolved = await resolveSlotImage("coffee beans", 1);
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe("pollinations");
    expect(resolved!.url).toContain("pollinations.ai");
  });

  it("falls through to the next provider when a probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("pollinations")) return { ok: false, status: 503, headers: new Map() };
      return fakeImageResponse(u);
    }));
    const resolved = await resolveSlotImage("coffee", 2);
    expect(resolved?.provider).toBe("loremflickr");
  });
});

describe("enrichStaticSiteVisuals", () => {
  it("materializes data-litt-image slots into project asset paths", async () => {
    const transport = makeTransport({
      "index.html": `<html><body><img data-litt-image="coffee beans roast" alt="Beans"></body></html>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({
      success: true,
      path: "assets/images/coffee-beans.jpg",
      sitePath: "assets/images/coffee-beans.jpg",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(report.imagesResolved).toBe(1);
    expect(html).toContain('src="assets/images/coffee-beans.jpg"');
    expect(html).not.toContain("data-litt-image");
    expect(report.audit?.slotCount ?? 0).toBe(0);
  });

  it("injects a hero background for data-litt-bg", async () => {
    const transport = makeTransport({
      "index.html": `<section class="hero" data-litt-bg="espresso pour"><h1>Ember</h1></section>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({
      success: true,
      path: "assets/images/espresso.jpg",
      sitePath: "assets/images/espresso.jpg",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).toContain("background-image:url('assets/images/espresso.jpg')");
  });

  it("repairs a broken relative ref using alt-text keywords", async () => {
    const transport = makeTransport({
      "index.html": `<img src="assets/images/missing.jpg" alt="fresh roasted coffee">`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({
      success: true,
      path: "assets/images/repaired.jpg",
      sitePath: "assets/images/repaired.jpg",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    expect(transport.files.get("index.html")).toContain('src="assets/images/repaired.jpg"');
    expect(mockInsertAssetFromUrl).toHaveBeenCalledWith(
      expect.stringContaining("http"),
      expect.objectContaining({ nameHint: "fresh roasted coffee" }),
      transport,
    );
  });

  it("rehosts external hotlinks into the project", async () => {
    const transport = makeTransport({
      "index.html": `<img src="https://cdn.example.com/hero.jpg">`,
    });
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      url === "https://cdn.example.com/hero.jpg"
        ? { success: true, path: "assets/images/hero.jpg", sitePath: "assets/images/hero.jpg" }
        : { success: true, path: "assets/images/x.jpg", sitePath: "assets/images/x.jpg" });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    expect(transport.files.get("index.html")).toContain('src="assets/images/hero.jpg"');
    expect(transport.files.get("index.html")).not.toContain("cdn.example.com");
  });

  it("falls back to a local SVG placeholder when every provider fails", async () => {
    const transport = makeTransport({
      "index.html": `<img data-litt-image="anything" alt="x">`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "download failed" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Map() })));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(report.imagesResolved).toBe(0);
    expect(report.placeholdersUsed).toBe(1);
    expect(html).toContain('src="assets/images/placeholder.svg"');
    expect(html).not.toContain("data-litt-image");
  });

  it("leaves a healthy page untouched", async () => {
    const transport = makeTransport({
      "index.html": `<div class="hero"><img src="assets/images/hero.jpg"></div>`,
      "assets/images/hero.jpg": "binary-stub",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));
    const report = await enrichStaticSiteVisuals(transport as never, {});
    expect(report.filesChanged).toEqual([]);
    expect(mockInsertAssetFromUrl).not.toHaveBeenCalled();
  });

  it("never throws when the workspace is empty", async () => {
    const transport = makeTransport({});
    const report = await enrichStaticSiteVisuals(transport as never, {});
    expect(report.filesScanned).toBe(0);
  });
});
