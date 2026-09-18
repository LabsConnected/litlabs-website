/**
 * Registry auto-insert — deterministic close of the generate → site loop.
 *
 * Regression for the 2026-09-17 production acceptance P0: image.generate
 * succeeded but the model never called project.insert_asset and shipped an
 * <img> tag pointing at a file that was never saved (broken hero image,
 * agent claiming "deployment verified with a 200 response"). The registry
 * now persists every project-context image itself and hands the agent the
 * exact sitePath to reference.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { maybeAutoInsertGeneratedImage } from "../tool-registry";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function projectTransport(writeBinaryFile?: ReturnType<typeof vi.fn>) {
  return {
    workspaceId: "ws-1",
    userId: "u-1",
    projectId: "p-1",
    writeBinaryFile: writeBinaryFile ?? vi.fn(async () => ({ saved: true })),
  };
}

function generateResult() {
  return {
    success: true,
    downloadUrl: "https://cdn.example.com/gen-abc.png",
    title: "hero dog",
    markdown: "![hero](https://cdn.example.com/gen-abc.png)",
    insertHint: "call project.insert_asset with this downloadUrl",
  };
}

describe("maybeAutoInsertGeneratedImage", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: async () =>
        PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("saves the generated image into the project and returns the exact sitePath", async () => {
    const writeBinaryFile = vi.fn(async () => ({ saved: true }));
    const out = (await maybeAutoInsertGeneratedImage(
      "image.generate",
      generateResult(),
      projectTransport(writeBinaryFile),
    )) as Record<string, unknown>;

    expect(out.savedToProject).toBe(true);
    expect(out.sitePath).toMatch(/^\/assets\/images\/hero-dog-[a-z0-9]+\.png$/);
    expect(out.siteReference).toContain(out.sitePath as string);
    // Chat rendering is preserved alongside the project save.
    expect(out.downloadUrl).toBe("https://cdn.example.com/gen-abc.png");
    // The save already happened — the result must not still tell the model
    // to insert the image itself or hand it a payload to re-emit.
    expect(out.insertHint).toBeUndefined();
    expect(out.markdown).toBeUndefined();
    expect(out.siteReference).toContain("do NOT call project.insert_asset");
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
  });

  it("leaves chat-only generations untouched (no project workspace)", async () => {
    const result = generateResult();
    const out = await maybeAutoInsertGeneratedImage("image.generate", result, undefined);
    expect(out).toBe(result);
  });

  it("leaves other tools untouched", async () => {
    const result = { success: true, saved: true };
    const out = await maybeAutoInsertGeneratedImage("files.write", result, projectTransport());
    expect(out).toBe(result);
  });

  it("leaves failed generations untouched", async () => {
    const result = { success: false, error: "provider down" };
    const out = await maybeAutoInsertGeneratedImage("image.generate", result, projectTransport());
    expect(out).toBe(result);
  });

  it("reports a failed save loudly instead of swallowing it", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("download failed");
    }) as unknown as typeof fetch;
    const out = (await maybeAutoInsertGeneratedImage(
      "image.generate",
      generateResult(),
      projectTransport(),
    )) as Record<string, unknown>;

    expect(out.savedToProject).toBe(false);
    expect(out.saveError).toBe("download failed");
    expect(out.sitePath).toBeUndefined();
    // The chat URL still works even when the project save failed.
    expect(out.downloadUrl).toBe("https://cdn.example.com/gen-abc.png");
  });

  it("propagates a transport write failure as a loud saveError", async () => {
    const out = (await maybeAutoInsertGeneratedImage(
      "image.generate",
      generateResult(),
      projectTransport(vi.fn(async () => {
        throw new Error("terminal 413");
      })),
    )) as Record<string, unknown>;

    expect(out.savedToProject).toBe(false);
    expect(out.saveError).toBe("terminal 413");
  });
});
