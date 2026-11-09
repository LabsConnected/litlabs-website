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

  it("retries a transient probe failure inside the same provider first", async () => {
    // The 2026-11 golden 503s: free hosts blip constantly — one retry heals
    // most probes, so the provider is skipped only on a repeat failure.
    let fetches = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      fetches += 1;
      if (fetches === 1) return { ok: false, status: 503, headers: new Map() };
      return fakeImageResponse(String(url));
    }));
    const resolved = await resolveSlotImage("coffee", 1);
    expect(resolved?.provider).toBe("loremflickr");
    expect(fetches).toBe(2);
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
    // download failure — picsum (next provider) serves them.
    expect(report.imagesResolved).toBeGreaterThanOrEqual(1);
    expect(report.providersUsed).toContain("picsum");
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
    // Fail every provider lane for the first resolve — a single dead
    // resolve must not starve the floor, but probe-ok download failures
    // now fall through to the next provider before counting as failed.
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
    expect(report.imagesFailed).toBe(1);
    expect(html).toContain("litt-gallery");
    expect(html).toContain('src="assets/images/g4.jpg"');
  });
});
