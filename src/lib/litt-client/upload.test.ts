import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LITT_UPLOAD_PATH, LITT_UPLOAD_PURPOSE } from "./endpoints";
import { buildAttachmentUploadRequest, uploadAttachment } from "./upload";

describe("attachment upload request", () => {
  it("posts multipart file + studio-attachment purpose and does not set Content-Type", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
    const request = buildAttachmentUploadRequest(file, file.name);

    expect(request.url).toBe(LITT_UPLOAD_PATH);
    expect(request.url).toBe("/api/upload");
    expect(request.method).toBe("POST");
    expect(request.body.get("purpose")).toBe(LITT_UPLOAD_PURPOSE);
    expect(request.body.get("purpose")).toBe("studio-attachment");
    const uploaded = request.body.get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("photo.png");

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: "https://cdn.example/photo.png" }), { status: 200 })) as unknown as typeof fetch;
    const response = await uploadAttachment(file, { fetchImpl });
    expect(response.ok).toBe(true);
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe("/api/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });

  it("matches the request shape still inlined in useStudioAttachments", () => {
    const hook = readFileSync("src/app/(app)/studio/hooks/useStudioAttachments.ts", "utf8");
    expect(hook).toContain('formData.append("file", file)');
    expect(hook).toContain(`formData.append("purpose", "${LITT_UPLOAD_PURPOSE}")`);
    expect(hook).toContain(`fetch("${LITT_UPLOAD_PATH}"`);
  });
});
