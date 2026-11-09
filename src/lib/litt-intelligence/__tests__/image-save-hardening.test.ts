/**
 * Image-save hardening — the follow-up to the image-save diagnosis
 * (2026-11-09). The approval-loop diagnosis proved image.generate's
 * output generates but the project save fails, yet the saveError could
 * not say WHICH step failed; separately, the structural completeness
 * check rejected valid payloads whose terminal marker was not the
 * exact final byte, and the registry's 60s deadline wrapped generation
 * AND the save in one budget. These tests pin the three hardenings:
 *
 *  1. Every insert failure carries its step (saveStep), and the
 *     registry's saveError names it ("[validate] …").
 *  2. JPEG EOI / PNG IEND are located within the payload tail —
 *     trailing bytes after the terminal marker are tolerated, while a
 *     payload with no terminal marker at all still fails.
 *  3. The auto-insert save runs under its own deadline, decoupled from
 *     the generation deadline (executeHandlerThenAutoInsert seam).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import { insertAssetFromUrl } from "../tool-handlers-v2";
import {
  executeHandlerThenAutoInsert,
  maybeAutoInsertGeneratedImage,
  ToolExecutionTimeoutError,
} from "../tool-registry";

const JPEG_CLEAN = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
// Same image with provider-appended bytes after the EOI marker.
const JPEG_TRAILING = Buffer.concat([
  JPEG_CLEAN,
  Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]),
  Buffer.from("trailing-padding", "ascii"),
]);
// Valid SOI/header, no EOI anywhere — the truncated-stub case.
const JPEG_NO_EOI = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);

const PNG_CLEAN = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_TRAILING = Buffer.concat([
  PNG_CLEAN,
  Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]),
]);
// Signature + IHDR only — no IEND trailer at all.
const PNG_NO_IEND = PNG_CLEAN.subarray(0, 24);

function spyTransport(writeBinaryFile?: ReturnType<typeof vi.fn>) {
  return {
    workspaceId: "ws-1",
    userId: "u-1",
    projectId: "p-1",
    writeBinaryFile: writeBinaryFile ?? vi.fn(async () => ({ saved: true })),
  } as unknown as WorkspaceTransport & {
    writeBinaryFile: ReturnType<typeof vi.fn>;
  };
}

function dataUrl(buffer: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function mockImageResponse(opts?: { contentType?: string; bytes?: Buffer; status?: number }) {
  const bytes = opts?.bytes ?? PNG_CLEAN;
  const status = opts?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? (opts?.contentType ?? "image/png") : null,
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("imagePayloadLooksComplete — terminal-marker tolerance (via insertAssetFromUrl)", () => {
  it("saves a JPEG with trailing bytes after the EOI marker", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl(dataUrl(JPEG_TRAILING), { nameHint: "hero" }, transport);
    expect(result.success).toBe(true);
    expect(transport.writeBinaryFile).toHaveBeenCalledTimes(1);
    const [, b64] = transport.writeBinaryFile.mock.calls[0];
    expect(Buffer.from(b64 as string, "base64")).toEqual(JPEG_TRAILING);
  });

  it("still rejects a JPEG with no EOI marker", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl(dataUrl(JPEG_NO_EOI), { nameHint: "hero" }, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/truncated|corrupt/i);
    expect(result.saveStep).toBe("validate");
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("saves a PNG with trailing bytes after the IEND trailer", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl(
      dataUrl(PNG_TRAILING, "image/png"),
      { nameHint: "hero" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(transport.writeBinaryFile).toHaveBeenCalledTimes(1);
  });

  it("still rejects a PNG with no IEND trailer", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl(
      dataUrl(PNG_NO_IEND, "image/png"),
      { nameHint: "hero" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/truncated|corrupt/i);
    expect(result.saveStep).toBe("validate");
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });
});

describe("insertAssetFromUrl — step-tagged failures", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("tags a malformed data URL as the decode step", async () => {
    const transport = spyTransport();
    const result = await insertAssetFromUrl("data:image/png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Malformed/i);
    expect(result.saveStep).toBe("decode");
  });

  it("tags a failed download as the decode step", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/hero.png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.saveStep).toBe("decode");
  });

  it("tags an empty download as the decode step", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ bytes: Buffer.alloc(0) }),
    ) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/hero.png", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(result.saveStep).toBe("decode");
  });

  it("tags a non-image payload as the validate step", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ contentType: "text/html" }),
    ) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/page", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not an image/i);
    expect(result.saveStep).toBe("validate");
  });

  it("tags an over-cap payload as the size step", async () => {
    // Structurally complete (SOI + EOI) but over the 50MB insert cap —
    // must reach the size check, not die at validation.
    const big = Buffer.alloc(50 * 1024 * 1024 + 4096, 0x11);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[big.length - 2] = 0xff;
    big[big.length - 1] = 0xd9;
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ contentType: "image/jpeg", bytes: big }),
    ) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://cdn.example.com/huge.jpg", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/max size/i);
    expect(result.saveStep).toBe("size");
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("tags an unfittable image as the fit step", async () => {
    // Structurally complete GIF over the 2MB publish cap that the fit
    // step cannot reduce (GIF payload passes through unresized).
    const gif = Buffer.concat([
      Buffer.from("GIF89a", "ascii"),
      Buffer.alloc(2 * 1024 * 1024 + 2048, 0x41),
      Buffer.from([0x3b]),
    ]);
    globalThis.fetch = vi.fn(async () =>
      mockImageResponse({ contentType: "image/gif", bytes: gif }),
    ) as unknown as typeof fetch;
    const transport = spyTransport();
    const result = await insertAssetFromUrl("https://example.com/huge.gif", {}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/publish limit/i);
    expect(result.saveStep).toBe("fit");
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("tags a transport write failure as the write step", async () => {
    const transport = spyTransport(
      vi.fn(async () => {
        throw new Error("terminal 413");
      }),
    );
    const result = await insertAssetFromUrl(
      dataUrl(PNG_CLEAN, "image/png"),
      { nameHint: "hero" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("terminal 413");
    expect(result.saveStep).toBe("write");
  });
});

describe("maybeAutoInsertGeneratedImage — saveError names the step", () => {
  it("prefixes the saveError with the failed step and exposes saveStep", async () => {
    const transport = spyTransport();
    const out = (await maybeAutoInsertGeneratedImage(
      "image.generate",
      { success: true, downloadUrl: dataUrl(JPEG_NO_EOI), title: "hero" },
      transport,
    )) as Record<string, unknown>;
    expect(out.savedToProject).toBe(false);
    expect(out.saveStep).toBe("validate");
    expect(out.saveError).toBe("[validate] Image data is truncated or corrupt");
    expect(out.recovery).toContain("[validate]");
  });
});

describe("executeHandlerThenAutoInsert — save decoupled from the generation deadline", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("a slow save after a fast generation is NOT cut off by the generation deadline", async () => {
    const writeBinaryFile = vi.fn(async () => {
      await sleep(300);
      return { saved: true };
    });
    const transport = spyTransport(writeBinaryFile);
    const out = (await executeHandlerThenAutoInsert(
      "image.generate",
      async () => ({ success: true, downloadUrl: dataUrl(PNG_CLEAN, "image/png"), title: "hero" }),
      transport,
      { handlerTimeoutMs: 50 },
    )) as Record<string, unknown>;
    // Under the old combined budget this rejected at 50ms with a
    // ToolExecutionTimeoutError; the save now runs on its own budget.
    expect(out.savedToProject).toBe(true);
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
  });

  it("the generation deadline still governs the handler itself", async () => {
    const transport = spyTransport();
    await expect(
      executeHandlerThenAutoInsert(
        "image.generate",
        async () => {
          await sleep(300);
          return { success: true, downloadUrl: dataUrl(PNG_CLEAN, "image/png") };
        },
        transport,
        { handlerTimeoutMs: 50 },
      ),
    ).rejects.toBeInstanceOf(ToolExecutionTimeoutError);
    expect(transport.writeBinaryFile).not.toHaveBeenCalled();
  });

  it("the save runs under its own deadline, not an unbounded one", async () => {
    const writeBinaryFile = vi.fn(async () => {
      await sleep(300);
      return { saved: true };
    });
    const transport = spyTransport(writeBinaryFile);
    await expect(
      executeHandlerThenAutoInsert(
        "image.generate",
        async () => ({ success: true, downloadUrl: dataUrl(PNG_CLEAN, "image/png"), title: "hero" }),
        transport,
        { handlerTimeoutMs: 5_000, saveTimeoutMs: 50 },
      ),
    ).rejects.toBeInstanceOf(ToolExecutionTimeoutError);
  });
});
