import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadMediaFile } from "./download-media";

// Pins the fix for "Studio won't save a generated image": generated media
// lives on cross-origin provider URLs, where a bare <a download> is
// ignored by the browser. The download must go through a blob: URL.

describe("downloadMediaFile", () => {
  let clicked: { href: string; download: string } | null;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    clicked = null;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock-object-url");
    URL.revokeObjectURL = vi.fn(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked = { href: this.href, download: this.download };
      },
    );
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("downloads a cross-origin image through a blob URL, not the raw URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["png-bytes"], { type: "image/png" }),
      })),
    );

    await downloadMediaFile("https://image.pollinations.ai/prompt/cat", "my-cat");

    expect(clicked).not.toBeNull();
    expect(clicked!.href).toContain("blob:mock-object-url");
    // Extension inferred from the fetched blob's MIME type.
    expect(clicked!.download).toBe("my-cat.png");
  });

  it("keeps an explicit filename extension", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["jpg-bytes"], { type: "image/jpeg" }),
      })),
    );

    await downloadMediaFile("https://cdn.example.com/gen.png", "lion.jpg");

    expect(clicked!.download).toBe("lion.jpg");
  });

  it("falls back to a direct anchor (no _blank) when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("CORS blocked");
      }),
    );

    await downloadMediaFile("https://example.com/no-cors.png", "pic.png");

    expect(clicked).not.toBeNull();
    expect(clicked!.href).toBe("https://example.com/no-cors.png");
    expect(clicked!.download).toBe("pic.png");
  });
});
