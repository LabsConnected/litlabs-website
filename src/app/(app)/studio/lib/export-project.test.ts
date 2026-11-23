// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZip } from "@/lib/studio/zip";
import { downloadProjectExport } from "./export-project";

/**
 * ACC-01 F5 regression coverage for the canonical export client.
 *
 * The acceptance run found both ZIP buttons inert. The Files panel had
 * drifted onto a private copy of this logic that revoked the object
 * URL synchronously after click() — which can cancel the download
 * before the browser commits it — and was hard-disabled unless the
 * terminal workspace reported "ready". These tests pin the canonical
 * behavior both buttons now share: a real download on success
 * (revocation deferred), and the server's honest error otherwise.
 */

const zipResponse = (init?: { filename?: string; fileCount?: string }) => {
  const zip = buildZip([
    { name: "index.html", data: Buffer.from("<h1>ok</h1>") },
    { name: "css/style.css", data: Buffer.from("body{}") },
    { name: "js/app.js", data: Buffer.from("console.log(1)") },
  ]);
  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${init?.filename ?? "my-project-export.zip"}"`,
      ...(init?.fileCount ? { "X-Export-File-Count": init.fileCount } : {}),
    },
  });
};

describe("downloadProjectExport (ACC-01 F5)", () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    createObjectURLSpy = vi.fn(() => "blob:export-url");
    revokeObjectURLSpy = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads the archive with the server's filename and defers URL revocation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => zipResponse({ fileCount: "3" })));

    const result = await downloadProjectExport("proj-1");

    expect(result).toEqual({
      ok: true,
      filename: "my-project-export.zip",
      fileCount: 3,
      truncated: false,
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Revocation must NOT happen synchronously — that is the exact
    // failure the Files panel's private copy had.
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message on a failed export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "The project workspace has no files to export yet." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await downloadProjectExport("proj-1");

    expect(result).toEqual({
      ok: false,
      error: "The project workspace has no files to export yet.",
    });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("treats an empty archive as an honest error, not a download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );

    const result = await downloadProjectExport("proj-1");

    expect(result.ok).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("reports a network failure honestly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket closed");
      }),
    );

    const result = await downloadProjectExport("proj-1");

    expect(result).toEqual({
      ok: false,
      error: "Export request failed — check your connection and retry.",
    });
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe("downloadProjectExport archive validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubDownloadUrl() {
    const objectUrl = vi.fn(() => "blob:test");
    vi.stubGlobal("URL", Object.assign(class extends URL {}, {
      createObjectURL: objectUrl,
      revokeObjectURL: vi.fn(),
    }));
    return objectUrl;
  }

  it("rejects a successful HTTP response with a broken archive before starting a download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not a ZIP", {
      status: 200, headers: { "Content-Type": "application/zip" },
    })));
    const objectUrl = stubDownloadUrl();

    const result = await downloadProjectExport("project-1");

    expect(result).toMatchObject({ ok: false });
    expect(objectUrl).not.toHaveBeenCalled();
  });

  it("rejects an archive that reports skipped files", async () => {
    stubDownloadUrl();
    const zip = buildZip([{ name: "index.html", data: Buffer.from("ok") }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(zip), {
      status: 200,
      headers: { "Content-Type": "application/zip", "X-Export-Skipped": "1" },
    })));
    const result = await downloadProjectExport("project-1");
    expect(result).toMatchObject({ ok: false });
  });

  it("downloads a complete archive and reports its actual file count", async () => {
    const zip = buildZip([
      { name: "index.html", data: Buffer.from("<h1>Saved</h1>") },
      { name: "css/style.css", data: Buffer.from("body { color: red }" ) },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="site-export.zip"',
        "X-Export-File-Count": "2",
      },
    })));
    const objectUrl = stubDownloadUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const result = await downloadProjectExport("project-1");

    expect(result).toEqual({ ok: true, filename: "site-export.zip", fileCount: 2, truncated: false });
    expect(objectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});
