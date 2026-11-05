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
  it("prefers a real-photo provider before the AI generator", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => fakeImageResponse(String(url))));
    const resolved = await resolveSlotImage("coffee beans", 1);
    expect(resolved).not.toBeNull();
    // Real photography first — pollinations (AI generation) is the
    // last-resort backstop, never the first pick.
    expect(resolved!.provider).toBe("loremflickr");
    expect(resolved!.url).toContain("loremflickr");
  });

  it("falls through to the next provider when a probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("loremflickr") || u.includes("picsum")) return { ok: false, status: 503, headers: new Map() };
      return fakeImageResponse(u);
    }));
    const resolved = await resolveSlotImage("coffee", 2);
    expect(resolved?.provider).toBe("pollinations");
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
    // 1 slot + 2 real-photo floor injections.
    expect(report.imagesResolved).toBe(3);
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
      "index.html": `<div class="hero"><img src="assets/images/hero.jpg"></div>
        <img src="assets/images/b.jpg"><img src="assets/images/c.jpg">`,
      "assets/images/hero.jpg": "binary-stub",
      "assets/images/b.jpg": "binary-stub",
      "assets/images/c.jpg": "binary-stub",
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

  // ── Golden 41948852260 regressions ──────────────────────────────
  // A forged/unreachable external image URL (the hallucinated Unsplash
  // 404) must never survive enrichment — rehost failure replaces the
  // reference, it is never left in the shipped HTML.

  it("replaces an external hotlink that fails rehosting (HTTP 404) instead of shipping it", async () => {
    const transport = makeTransport({
      "index.html": `<img src="https://images.unsplash.com/photo-1447933601403-0c666a8787e1?w=1200&q=80" alt="coffee">`,
    });
    // The external download fails (404) — the stock-chain downloads land.
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      url.includes("unsplash")
        ? { success: false, error: "HTTP 404" }
        : { success: true, path: `assets/images/r${++n}.jpg`, sitePath: `assets/images/r${n}.jpg` });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).not.toContain("unsplash.com");
    expect(html).not.toContain("photo-1447933601403");
    expect(html).toContain('src="assets/images/r1.jpg"');
  });

  it("replaces an external hotlink whose payload is not an image (content-type rejection)", async () => {
    const transport = makeTransport({
      "index.html": `<img src="https://cdn.evil.example/track.gif" alt="x">`,
    });
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      url.includes("evil.example")
        ? { success: false, error: "Not an image content-type: text/html" }
        : { success: true, path: "assets/images/ok.jpg", sitePath: "assets/images/ok.jpg" });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).not.toContain("evil.example");
    expect(html).toContain('src="assets/images/ok.jpg"');
  });

  it("falls back to the local SVG when the external hotlink fails AND providers are down", async () => {
    const transport = makeTransport({
      "index.html": `<img src="https://images.unsplash.com/photo-dead" alt="coffee">`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "HTTP 404" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Map() })));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).not.toContain("unsplash.com");
    expect(html).toContain('src="assets/images/placeholder.svg"');
    expect(report.placeholdersUsed).toBe(1);
  });

  it("injects a real-photo gallery when the entry page is short of the ≥3-photo floor", async () => {
    const transport = makeTransport({
      "index.html": `<html><head><title>Ember Roast</title></head><body>
        <h1>Ember Roast Coffee</h1><img src="assets/images/hero.jpg"></body></html>`,
      "assets/images/hero.jpg": "binary-stub",
    });
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async () => {
      n += 1;
      return { success: true, path: `assets/images/g${n}.jpg`, sitePath: `assets/images/g${n}.jpg`, sizeBytes: 120_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    // 1 existing photo → 2 resolved injections to reach the floor.
    expect(report.imagesResolved).toBe(2);
    expect(html).toContain("litt-gallery");
    expect(html).toContain('src="assets/images/g1.jpg"');
    expect(html).toContain('src="assets/images/g2.jpg"');
    expect(html).toContain("</body>");
  });

  it("an undersized image is kept but does not count toward the photo floor", async () => {
    const transport = makeTransport({
      "index.html": `<html><body><img src="https://cdn.example.com/tiny.png" alt="logo"></body></html>`,
    });
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async (url: string) => {
      if (url.includes("cdn.example.com")) {
        return { success: true, path: "assets/images/tiny.png", sitePath: "assets/images/tiny.png", sizeBytes: 3_200 };
      }
      n += 1;
      return { success: true, path: `assets/images/f${n}.jpg`, sitePath: `assets/images/f${n}.jpg`, sizeBytes: 200_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    // The 3.2 KB rehost is real content and stays — but the floor still
    // demands 3 full-size photos, so the gallery supplies all three.
    expect(html).toContain('src="assets/images/tiny.png"');
    expect(report.imagesResolved).toBe(3);
    expect(html).toContain('src="assets/images/f3.jpg"');
  });

  it("does not fabricate gallery images when every provider is down", async () => {
    const transport = makeTransport({
      "index.html": `<html><body><h1>Ember</h1></body></html>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "download failed" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Map() })));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    // Honest shortfall — no fake <img> tags, no placeholder spam in a
    // gallery; the audit still reports zero photos truthfully.
    expect(html).not.toContain("<img");
    expect(report.imagesResolved).toBe(0);
    expect(report.imagesFailed).toBeGreaterThan(0);
  });
});
