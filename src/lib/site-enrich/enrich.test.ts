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

// Openverse is a JSON API, not an image URL — default it to an empty
// result set so provider-order tests exercise the image lanes only.
function openverseEmpty() {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => ({ results: [] }),
  };
}
function isOpenverse(url: string) {
  return url.includes("api.openverse.org");
}

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
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) =>
      isOpenverse(String(url)) ? openverseEmpty() : fakeImageResponse(String(url))));
    const resolved = await resolveSlotImage("coffee beans", 1);
    expect(resolved).not.toBeNull();
    // Real photography first — pollinations (AI generation) is the
    // last-resort backstop, never the first pick.
    expect(resolved!.provider).toBe("loremflickr");
    expect(resolved!.url).toContain("loremflickr");
  });

  it("resolves via Openverse with commercial-license filtering and attribution", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (isOpenverse(u)) {
        expect(u).toContain("license_type=commercial");
        expect(u).toContain("size=large");
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            results: [
              { url: "https://live.staticflickr.com/abc.jpg", title: "Coffee", creator: "Jane", license: "by", license_version: "2.0" },
              { url: "http://insecure.example/x.jpg", title: "bad", license: "by" },
              { url: "https://commons.wikimedia.org/y.jpg", title: "Roast", creator: "John", license: "cc0" },
            ],
          }),
        };
      }
      return fakeImageResponse(u);
    }));
    const resolved = await resolveSlotImage("coffee", 0);
    expect(resolved?.provider).toBe("openverse");
    expect(resolved?.url).toBe("https://live.staticflickr.com/abc.jpg");
    expect(resolved?.attribution).toContain("by 2.0");
    expect(resolved?.attribution).toContain("Jane");
    expect(resolved?.attribution).toContain("openverse.org");
  });

  it("rotates Openverse results by seed and skips avoided URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (isOpenverse(u)) {
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            results: [
              { url: "https://a.example/1.jpg", license: "by" },
              { url: "https://b.example/2.jpg", license: "by" },
            ],
          }),
        };
      }
      return fakeImageResponse(u);
    }));
    const avoid = new Set(["https://a.example/1.jpg"]);
    const resolved = await resolveSlotImage("coffee", 0, undefined, undefined, undefined, avoid);
    expect(resolved?.provider).toBe("openverse");
    expect(resolved?.url).toBe("https://b.example/2.jpg");
  });

  it("falls through to the next provider when a probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (isOpenverse(u)) return openverseEmpty();
      if (u.includes("loremflickr") || u.includes("picsum")) return { ok: false, status: 503, headers: new Map() };
      return fakeImageResponse(u);
    }));
    const resolved = await resolveSlotImage("coffee", 2);
    expect(resolved?.provider).toBe("pollinations");
  });

  it("retries a transient probe failure inside the same provider first", async () => {
    // The 2026-11 golden 503s: free hosts blip constantly — one retry heals
    // most probes, so the provider is skipped only on a repeat failure.
    let fetches = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (isOpenverse(u)) {
        fetches += 1;
        return openverseEmpty();
      }
      fetches += 1;
      if (fetches === 2) return { ok: false, status: 503, headers: new Map() };
      return fakeImageResponse(u);
    }));
    const resolved = await resolveSlotImage("coffee", 1);
    expect(resolved?.provider).toBe("loremflickr");
    // openverse(1) + loremflickr transient(1) + loremflickr retry(1)
    expect(fetches).toBe(3);
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

  it("falls through to the next provider when a probe-ok download fails", async () => {
    // 2026-11-09 staging: picsum probes passed but downloads failed, and
    // the remaining providers were never tried — runs shipped 2/3 photos.
    const transport = makeTransport({
      "index.html": `<img data-litt-image="coffee beans" alt="Beans">`,
    });
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      String(url).includes("loremflickr")
        ? { success: false, error: "HTTP 502" }
        : { success: true, path: "assets/images/picsum.jpg", sitePath: "assets/images/picsum.jpg" });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    // Slot resolve + floor fills must not dead-end on the loremflickr
    // download failure — the next provider in chain (pollinations)
    // serves them.
    expect(report.imagesResolved).toBeGreaterThanOrEqual(1);
    expect(report.providersUsed).toContain("pollinations");
    expect(html).toContain('src="assets/images/picsum.jpg"');
    expect(html).not.toContain("data-litt-image");
  });

  it("falls through when insertAssetFromUrl throws instead of aborting enrichment", async () => {
    const transport = makeTransport({
      "index.html": `<img data-litt-image="coffee beans" alt="Beans">`,
    });
    let calls = 0;
    mockInsertAssetFromUrl.mockImplementation(async (url: string) => {
      calls += 1;
      if (String(url).includes("loremflickr")) throw new Error("socket hangup");
      return { success: true, path: "assets/images/picsum.jpg", sitePath: "assets/images/picsum.jpg" };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    expect(report.imagesResolved).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThan(1);
    expect(transport.files.get("index.html")).toContain('src="assets/images/picsum.jpg"');
  });

  it("gives up within its overall budget when providers never answer (CI #820)", async () => {
    // Pin a small budget — the mechanism under test is the abort, not the
    // default value (30s would outlast vitest's own 5s timeout).
    vi.stubEnv("ENRICH_TOTAL_TIMEOUT_MS", "1500");
    const transport = makeTransport({
      "index.html": `<img data-litt-image="anything" alt="x">`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "download failed" });
    // A provider that hangs forever unless aborted. Without the overall
    // deadline this test never returns (vitest 5s timeout) — that is the
    // #820 CI hang: the resume loop awaited enrichment while providers
    // never answered, and #820's retries multiplied the wait.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        await new Promise<void>((_resolve, reject) => {
          const sig = init?.signal;
          if (!sig) return; // hangs forever
          if (sig.aborted) reject(new DOMException("The operation was aborted", "AbortError"));
          else
            sig.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted", "AbortError")),
              { once: true },
            );
        });
        throw new Error("unreachable");
      }),
    );

    const start = Date.now();
    const report = await enrichStaticSiteVisuals(transport as never, {});
    const elapsed = Date.now() - start;
    expect(report.imagesResolved).toBe(0);
    expect(elapsed).toBeLessThan(4500);
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

  // ── Golden 41962554092 regressions ──────────────────────────────
  // Three hallucinated Unsplash photo-ids shipped as CSS background
  // url() refs — extractImageRefs audits css-kind refs but only img-kind
  // refs were repaired, so the dead hotlinks reached the live deployment.

  it("rehosts an external CSS url() background hotlink into the project", async () => {
    const transport = makeTransport({
      "index.html": `<section class="hero" style="background-image: url('https://cdn.example.com/hero.jpg');"><h1>x</h1></section>`,
    });
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      url === "https://cdn.example.com/hero.jpg"
        ? { success: true, path: "assets/images/hero.jpg", sitePath: "assets/images/hero.jpg" }
        : { success: true, path: "assets/images/x.jpg", sitePath: "assets/images/x.jpg" });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).toContain("url('assets/images/hero.jpg')");
    expect(html).not.toContain("cdn.example.com");
  });

  it("replaces a dead external CSS url() (hallucinated Unsplash id) instead of shipping it", async () => {
    const transport = makeTransport({
      "index.html": `<style>.hero{background-image:url('https://images.unsplash.com/photo-1507135547701-434797553377?q=80&w=2070');}</style>
        <div class="hero"><h1>Ember</h1></div>`,
    });
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async (url: string) =>
      url.includes("unsplash")
        ? { success: false, error: "Failed to download asset: HTTP 404" }
        : { success: true, path: `assets/images/r${++n}.jpg`, sitePath: `assets/images/r${n}.jpg` });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).not.toContain("unsplash.com");
    expect(html).not.toContain("photo-1507135547701");
    expect(html).toContain("url('assets/images/r1.jpg')");
  });

  it("repairs a missing relative CSS url() image ref", async () => {
    const transport = makeTransport({
      "index.html": `<div style="background: url(images/missing-hero.png) center/cover;"><h1>x</h1></div>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({
      success: true,
      path: "assets/images/fixed.jpg",
      sitePath: "assets/images/fixed.jpg",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).toContain("url(assets/images/fixed.jpg)");
    expect(html).not.toContain("images/missing-hero.png");
  });

  it("leaves an existing relative CSS url() and non-image url() refs untouched", async () => {
    const transport = makeTransport({
      "index.html": `<div style="background:url(assets/images/ok.jpg)"></div>
        <img src="assets/images/a.jpg"><img src="assets/images/b.jpg"><img src="assets/images/c.jpg">
        <svg><rect fill="url(#grad)"/></svg>
        <style>@font-face{src:url('fonts/x.woff2');}</style>`,
      "assets/images/ok.jpg": "binary-stub",
      "assets/images/a.jpg": "binary-stub",
      "assets/images/b.jpg": "binary-stub",
      "assets/images/c.jpg": "binary-stub",
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).toContain("url(assets/images/ok.jpg)");
    expect(html).toContain("url(#grad)");
    expect(html).toContain("fonts/x.woff2");
    expect(report.filesChanged).toEqual([]);
    expect(mockInsertAssetFromUrl).not.toHaveBeenCalled();
  });

  it("falls back to the local SVG for a dead CSS hotlink when providers are down", async () => {
    const transport = makeTransport({
      "index.html": `<div style="background-image:url('https://images.unsplash.com/photo-dead')"><h1>x</h1></div>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "HTTP 404" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Map() })));

    await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(html).not.toContain("unsplash.com");
    expect(html).toContain("url('assets/images/placeholder.svg')");
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

  it("never materializes the same provider URL for two identical-keyword slots", async () => {
    // The identical-MD5 defect: three generated images hashed identically
    // because identical keyword slots all resolved the first hit of the
    // provider chain. With Pexels live and two photos returned, slot 2
    // must take photo 2 — never a second copy of photo 1.
    process.env.PEXELS_API_KEY = "test-key";
    const transport = makeTransport({
      "index.html": `<html><body>
        <img data-litt-image="coffee beans"><img data-litt-image="coffee beans">
      </body></html>`,
    });
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async () => {
      n += 1;
      return { success: true, path: `assets/images/i${n}.jpg`, sitePath: `assets/images/i${n}.jpg`, sizeBytes: 150_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      const s = String(u);
      if (s.includes("api.pexels.com")) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            photos: [
              { src: { large2x: "https://images.example/a.jpg" }, photographer: "A" },
              { src: { large2x: "https://images.example/b.jpg" }, photographer: "B" },
            ],
          }),
        };
      }
      return fakeImageResponse(s);
    }));

    await enrichStaticSiteVisuals(transport as never, {});
    const urls = mockInsertAssetFromUrl.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://images.example/a.jpg");
    expect(urls).toContain("https://images.example/b.jpg");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("skips a provider URL that was already materialized this run", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));
    const used = new Set(["https://loremflickr.com/1600/900/coffee?lock=1"]);
    const resolved = await resolveSlotImage("coffee", 1, undefined, undefined, undefined, used);
    expect(resolved).not.toBeNull();
    expect(resolved!.url).not.toBe("https://loremflickr.com/1600/900/coffee?lock=1");
    // Two slots, same keyword, different seeds must not collide on the
    // deterministic fallback either.
    const second = await resolveSlotImage("coffee", 2, undefined, undefined, undefined, new Set([resolved!.url]));
    expect(second).not.toBeNull();
    expect(second!.url).not.toBe(resolved!.url);
  });

  it("names the failed provider lanes in the report (staging 2026-11-08 evidence)", async () => {
    // The staging acceptance run's status line could only say "1
    // unavailable (picsum)" — diagnosis needed provider-level evidence.
    // providersFailed records every lane that did not produce an image,
    // including a pexels key that is simply absent (unconfigured).
    const transport = makeTransport({
      "index.html": `<html><body><h1>Ember</h1></body></html>`,
    });
    mockInsertAssetFromUrl.mockResolvedValue({ success: false, error: "download failed" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: new Map() })));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    // No PEXELS_API_KEY in the test env → reported as unconfigured, not failed.
    expect(report.providersFailed).toContain("pexels(unconfigured)");
    expect(report.providersFailed).toContain("loremflickr");
    expect(report.providersFailed).toContain("picsum");
    expect(report.providersFailed).toContain("pollinations");
  });

  it("keeps filling the photo floor after a transient resolve failure", async () => {
    // Golden 2026-11-06: a single failed resolve used to abort the whole
    // floor pass, shipping sites with fewer than MIN_REAL_PHOTOS real
    // photos. One hiccup must not starve the floor.
    const transport = makeTransport({
      "index.html": `<html><head><title>Ember Roast</title></head><body><h1>Ember Roast</h1></body></html>`,
    });
    // Fail the first three downloads — a single dead lane must not
    // starve the floor: probe-ok download failures fall through to the
    // next provider before counting as failed. The floor buys its 3
    // owed photos as one concurrent batch, so the 3 failures land one
    // per in-flight resolve (each absorbs its failure as a lane
    // fallthrough and succeeds on the next lane) instead of
    // sequentially burning one whole resolve — hence imagesFailed is 0,
    // not the 1 the old sequential loop recorded.
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async () => {
      n += 1;
      if (n <= 3) return { success: false, error: "HTTP 503" };
      return { success: true, path: `assets/images/g${n}.jpg`, sitePath: `assets/images/g${n}.jpg`, sizeBytes: 120_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(report.imagesResolved).toBe(3);
    expect(report.imagesFailed).toBe(0);
    expect(html).toContain("litt-gallery");
    expect(html).toContain('src="assets/images/g4.jpg"');
  });

  it("gives the photo floor its own deadline when earlier phases burn the shared budget", async () => {
    // Golden run 42726578836: phases 1–3 share one deadline with the
    // floor, and a slow-failing provider lane (LoremFlickr's probe
    // retries alone can burn ~24s of the 30s) spent it before the floor
    // started — the floor inherited a nearly-dead signal and shipped
    // 2/3 photos. Here the slot phase's first probe hangs until the
    // shared deadline kills it; the floor must still resolve all of its
    // photos afterwards under a fresh deadline of its own.
    process.env.ENRICH_TOTAL_TIMEOUT_MS = "200";
    try {
      const transport = makeTransport({
        "index.html": `<html><head><title>Ember Roast</title></head><body>
          <h1>Ember Roast Coffee</h1><img data-litt-image="coffee beans" alt="beans"></body></html>`,
      });
      let n = 0;
      mockInsertAssetFromUrl.mockImplementation(async () => {
        n += 1;
        return { success: true, path: `assets/images/f${n}.jpg`, sitePath: `assets/images/f${n}.jpg`, sizeBytes: 120_000 };
      });
      let fetches = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: RequestInfo | URL, init?: { signal?: AbortSignal }) => {
          fetches += 1;
          if (fetches === 1) {
            // A stalled provider: never answers, dies only when the
            // caller's signal aborts it — exactly how real fetch behaves.
            return new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
            });
          }
          return Promise.resolve(fakeImageResponse(String(url)));
        }),
      );

      const report = await enrichStaticSiteVisuals(transport as never, {});
      const html = transport.files.get("index.html")!;
      // The slot burned the whole shared budget and fell back to the
      // placeholder SVG; the floor still delivered all 3 of its photos.
      expect(report.placeholdersUsed).toBe(1);
      expect(report.imagesResolved).toBe(3);
      expect(html).toContain("litt-gallery");
      expect(html).toContain('src="assets/images/f3.jpg"');
    } finally {
      delete process.env.ENRICH_TOTAL_TIMEOUT_MS;
    }
  });

  it("lets the photo floor retry beyond needed*2 attempts when resolves keep failing", async () => {
    // The other half of run 42726578836: needed=2 with the old needed*2
    // cap gave the floor only 4 attempts — 1 success + 3 flaky failures
    // shipped a 2-photo page. Each failed resolve below burns its 3
    // provider lanes (probe ok, download fails, fall through) before it
    // counts as failed. The floor buys the 2 owed photos in concurrent
    // batches of 2: two batches burn all 3 lanes each (12 failed
    // downloads, 4 failed resolves), and in the third batch the last
    // failed download (15th) is one resolve's first lane — the two
    // photos then land on downloads 16 and 17 as lane fallthroughs. The
    // floor must keep going past the old cap to get there.
    const transport = makeTransport({
      "index.html": `<html><head><title>Ember Roast</title></head><body>
        <h1>Ember Roast Coffee</h1><img src="assets/images/hero.jpg"></body></html>`,
      "assets/images/hero.jpg": "binary-stub",
    });
    let n = 0;
    mockInsertAssetFromUrl.mockImplementation(async () => {
      n += 1;
      if (n <= 15) return { success: false, error: "HTTP 503" };
      return { success: true, path: `assets/images/g${n}.jpg`, sitePath: `assets/images/g${n}.jpg`, sizeBytes: 120_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(report.imagesResolved).toBe(2);
    expect(report.imagesFailed).toBe(4);
    expect(html).toContain("litt-gallery");
    expect(html).toContain('src="assets/images/g16.jpg"');
    expect(html).toContain('src="assets/images/g17.jpg"');
  });

  it("tops the photo floor up from unreferenced workspace images before any network resolve", async () => {
    // Acceptance run 42744941482, iteration 4: the build took the
    // image.generate path, whose auto-insert persisted generated images
    // under assets/images — but the model's HTML referenced only one of
    // them, countPhotos counts HTML refs only, and the floor owed 2
    // network photos it could not buy inside its clock. Files already
    // on disk that are unreferenced, non-SVG and >8KB must be picked up
    // by the floor first, at zero network cost.
    const big = "x".repeat(12_000);
    const transport = makeTransport({
      "index.html": `<html><head><title>Ember Roast</title></head><body>
        <h1>Ember Roast Coffee</h1><img src="assets/images/hero.jpg"></body></html>`,
      "assets/images/hero.jpg": big,
      "assets/images/gen-a.jpg": big,
      "assets/images/gen-b.jpg": big,
      // Decoys the top-up must skip: undersized, SVG, and the placeholder.
      "assets/images/tiny.jpg": "x".repeat(100),
      "assets/images/icon.svg": big,
      "assets/images/placeholder.svg": big,
    });
    const fetchSpy = vi.fn(async (u: RequestInfo | URL) => fakeImageResponse(String(u)));
    vi.stubGlobal("fetch", fetchSpy);

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    // 1 referenced photo + 2 workspace top-ups = the floor of 3, with
    // zero network resolves/downloads spent on the topped-up count.
    expect(html).toContain("litt-gallery");
    expect(html).toContain('src="assets/images/gen-a.jpg"');
    expect(html).toContain('src="assets/images/gen-b.jpg"');
    expect(html).not.toContain("tiny.jpg");
    expect(html).not.toContain("icon.svg");
    expect(html.match(/hero\.jpg/g)).toHaveLength(1);
    expect(report.imagesResolved).toBe(0);
    expect(mockInsertAssetFromUrl).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("buys owed floor photos concurrently so two slow resolutions fit one base budget", async () => {
    // The other half of run 42744941482 iteration 4: #859 gave the floor
    // a fresh 30s clock, but with needed=2 one worst-case resolution
    // (LoremFlickr's probe gauntlet, then a download) can consume most
    // of a single base budget, so SEQUENTIAL buying starved the second
    // owed photo. v1 scaled the deadline by needed instead — that fixed
    // the shortfall but multiplied the run's worst-case in-flight time,
    // and the agent loop's 4000ms settle guard tripped on it in CI
    // (PR #861, three runs). The floor must fit BOTH owed photos inside
    // the single unscaled budget by resolving them concurrently.
    // Here the base budget is 200ms and EVERY resolution takes ~160ms:
    // sequential buying needs ~320ms+ (and on the flat #859 clock the
    // second photo dies outright at 200ms); concurrent buying lands
    // both in ~160ms.
    process.env.ENRICH_TOTAL_TIMEOUT_MS = "200";
    try {
      const transport = makeTransport({
        "index.html": `<html><head><title>Ember Roast</title></head><body>
          <h1>Ember Roast Coffee</h1><img src="assets/images/hero.jpg"></body></html>`,
        "assets/images/hero.jpg": "binary-stub",
      });
      let n = 0;
      mockInsertAssetFromUrl.mockImplementation(async () => {
        n += 1;
        return { success: true, path: `assets/images/f${n}.jpg`, sitePath: `assets/images/f${n}.jpg`, sizeBytes: 120_000 };
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((url: RequestInfo | URL, init?: { signal?: AbortSignal }) => {
          // Openverse is a JSON search API, not an image lane — answer
          // it empty at once (as the resolver tests above do) so the
          // ~160ms delay below measures only the image-lane probes the
          // floor is racing against its budget.
          if (isOpenverse(String(url))) return Promise.resolve(openverseEmpty());
          // Every image lane answers only after ~160ms, and — exactly
          // like real fetch — dies if the caller's signal aborts first.
          return new Promise((resolvePromise, reject) => {
            const timer = setTimeout(() => resolvePromise(fakeImageResponse(String(url))), 160);
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("AbortError"));
              },
              { once: true },
            );
          });
        }),
      );

      const start = Date.now();
      const report = await enrichStaticSiteVisuals(transport as never, {});
      const elapsed = Date.now() - start;
      const html = transport.files.get("index.html")!;
      expect(report.imagesResolved).toBe(2);
      expect(html).toContain("litt-gallery");
      expect(html).toContain('src="assets/images/f1.jpg"');
      expect(html).toContain('src="assets/images/f2.jpg"');
      expect(elapsed).toBeLessThan(300);
    } finally {
      delete process.env.ENRICH_TOTAL_TIMEOUT_MS;
    }
  });

  it("never exceeds the shared image budget when a floor batch runs concurrently", async () => {
    // MAX_IMAGES_PER_RUN is 8. Six slots burn 6 budget entries in
    // phase 1 — with images too small to count toward the photo floor,
    // so the floor still owes all 3 photos when it starts, but only 2
    // budget entries remain. The batch must claim that room
    // synchronously and launch at most 2 concurrent resolves: without
    // the claim, all 3 owed resolves would pass the entry check while
    // the counters still read 6 (they only move as resolves settle) and
    // the pass would end at 9 entries — over budget.
    const slots = Array.from({ length: 6 }, (_, i) => `<img data-litt-image="coffee ${i}" alt="s${i}">`).join("");
    const transport = makeTransport({
      "index.html": `<html><head><title>Ember Roast</title></head><body><h1>Ember Roast</h1>${slots}</body></html>`,
    });
    let inserts = 0;
    mockInsertAssetFromUrl.mockImplementation(async () => {
      inserts += 1;
      return {
        success: true,
        path: `assets/images/f${inserts}.jpg`,
        sitePath: `assets/images/f${inserts}.jpg`,
        // Slot images are persisted but undersized: real budget spend,
        // zero floor credit.
        sizeBytes: inserts <= 6 ? 100 : 120_000,
      };
    });
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) =>
      isOpenverse(String(u)) ? openverseEmpty() : fakeImageResponse(String(u))));

    const report = await enrichStaticSiteVisuals(transport as never, {});
    const html = transport.files.get("index.html")!;
    expect(report.imagesResolved + report.imagesFailed).toBeLessThanOrEqual(8);
    expect(report.imagesResolved).toBe(8);
    expect(inserts).toBe(8);
    // The floor landed exactly the 2 photos the remaining budget could
    // buy — no third batch member was ever launched.
    expect(html).toContain('src="assets/images/f7.jpg"');
    expect(html).toContain('src="assets/images/f8.jpg"');
    expect(html).not.toContain("f9.jpg");
  });

  it("settles the floor batch when the deadline aborts in-flight resolutions", async () => {
    // Cancellation: the floor deadline fires while both batch
    // resolutions are still in flight. The batch must settle — no
    // dangling promises, no unhandled rejections (vitest fails the run
    // on those) — and enrichment must return its report having
    // persisted nothing from the aborted batch.
    process.env.ENRICH_TOTAL_TIMEOUT_MS = "200";
    try {
      const transport = makeTransport({
        "index.html": `<html><head><title>Ember Roast</title></head><body>
          <h1>Ember Roast Coffee</h1><img src="assets/images/hero.jpg"></body></html>`,
        "assets/images/hero.jpg": "binary-stub",
      });
      mockInsertAssetFromUrl.mockResolvedValue({
        success: true,
        path: "assets/images/never.jpg",
        sitePath: "assets/images/never.jpg",
        sizeBytes: 120_000,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((url: RequestInfo | URL, init?: { signal?: AbortSignal }) => {
          // Openverse answered empty at once (see the concurrency test
          // above); the image lanes below are the slow ones.
          if (isOpenverse(String(url))) return Promise.resolve(openverseEmpty());
          // Answers only after 500ms — past the 200ms floor deadline —
          // and, like real fetch, rejects when the signal aborts.
          return new Promise((resolvePromise, reject) => {
            const timer = setTimeout(() => resolvePromise(fakeImageResponse(String(url))), 500);
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("AbortError"));
              },
              { once: true },
            );
          });
        }),
      );

      const start = Date.now();
      const report = await enrichStaticSiteVisuals(transport as never, {});
      const elapsed = Date.now() - start;
      // Settled by the deadline (~200ms), not by the 500ms stub.
      expect(elapsed).toBeLessThan(400);
      expect(report.imagesResolved).toBe(0);
      expect(report.imagesFailed).toBe(2);
      // Only completed inserts may reach filesChanged — the aborted
      // batch completed none, so nothing was written at all.
      expect(report.filesChanged).toEqual([]);
      expect(transport.files.get("index.html")).not.toContain("litt-gallery");
      expect(mockInsertAssetFromUrl).not.toHaveBeenCalled();
    } finally {
      delete process.env.ENRICH_TOTAL_TIMEOUT_MS;
    }
  });
});
