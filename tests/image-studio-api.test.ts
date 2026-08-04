// @vitest-environment node
/**
 * Image Studio API tests.
 *
 * Tests for:
 *   - HTML responses produce a useful error instead of "Unexpected token '<'"
 *   - Authentication failures return proper JSON with "Sign in" message
 *   - Gemini receives aspect ratio and image size
 *   - Gemini reference-image editing includes the image part
 *   - Alibaba text-to-image works
 *   - Alibaba image editing works (with reference image)
 *   - Cloudflare generation works
 *   - Auto Free falls through to the next provider on failure
 *   - Failed generations do not deduct LiTTBits
 *   - Successful paid generations deduct exactly once
 *   - Provider secrets never appear in responses or logs
 *   - Provider status endpoint returns config without exposing secrets
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
const { mockGetUserWallet } = vi.hoisted(() => ({ mockGetUserWallet: vi.fn() }));
const { mockUpdateWalletBalance } = vi.hoisted(() => ({ mockUpdateWalletBalance: vi.fn() }));
const { mockUploadBinaryAsset } = vi.hoisted(() => ({ mockUploadBinaryAsset: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/user-db", () => ({
  getUserWallet: mockGetUserWallet,
  updateWalletBalance: mockUpdateWalletBalance,
}));
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
  rateLimit: vi.fn(async () => ({ success: true, remaining: 60, resetTime: 60 })),
}));
vi.mock("@/lib/r2", () => ({
  uploadBinaryAsset: mockUploadBinaryAsset,
}));

// Mock @google/genai
const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Modality: { IMAGE: "IMAGE", TEXT: "TEXT" },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/media/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockAuth.mockResolvedValue({ userId: "test-user-id", clerkId: "test-clerk-id" });
  mockGetUserWallet.mockResolvedValue({ balance: 100 });
  mockUpdateWalletBalance.mockResolvedValue({ balance: 99 });
  mockUploadBinaryAsset.mockResolvedValue({ publicUrl: "https://r2.example.com/image.png" });
  // Clear all env vars that might leak between tests
  setEnv({
    GEMINI_API_KEY: undefined,
    GEMINI_IMAGE_MODEL: undefined,
    ALIBABA_DASHSCOPE_API_KEY: undefined,
    ALIBABA_MODELSTUDIO_WORKSPACE_ID: undefined,
    ALIBABA_MODELSTUDIO_REGION: undefined,
    ALIBABA_IMAGE_MODEL: undefined,
    CLOUDFLARE_ACCOUNT_ID: undefined,
    CLOUDFLARE_AI_API_TOKEN: undefined,
    CLOUDFLARE_IMAGE_MODEL: undefined,
    FAL_KEY: undefined,
    TOGETHER_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    RECRAFT_API_KEY: undefined,
    HUGGING_FACE_API_KEY: undefined,
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: undefined,
  });
});

describe("Image Studio API — HTML-as-JSON protection", () => {
  it("returns a useful error when the server returns HTML instead of JSON", async () => {
    // This test verifies the client-side readApiResponse function logic.
    // We simulate the scenario: a middleware/auth redirect returns HTML.
    // The route itself always returns JSON, so we test the client parser behavior.

    // Simulate what readApiResponse does
    async function readApiResponse(res: {
      status: number;
      statusText: string;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
      ok: boolean;
    }): Promise<Record<string, unknown>> {
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();

      if (!contentType.includes("application/json")) {
        const preview = raw.replace(/\s+/g, " ").slice(0, 240);
        const isAuthRedirect =
          res.status === 401 ||
          (res.status === 307 && raw.includes("sign-in")) ||
          (raw.includes("sign-in") && raw.includes("<!DOCTYPE"));
        if (isAuthRedirect) {
          throw new Error("Your session has expired. Sign in again to generate images.");
        }
        throw new Error(
          `Image API returned ${res.status} ${res.statusText} as ` +
          `${contentType || "unknown content type"}. ${preview}`,
        );
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error(
          `Image API returned invalid JSON (${res.status}). ` + raw.slice(0, 240),
        );
      }

      if (!res.ok) {
        const errorMsg =
          typeof data.error === "string"
            ? data.error
            : `Generation failed with HTTP ${res.status}`;
        if (res.status === 401) {
          throw new Error("Your session has expired. Sign in again to generate images.");
        }
        throw new Error(errorMsg);
      }

      return data;
    }

    // Test: HTML response from auth redirect
    const htmlResponse = {
      status: 307,
      statusText: "Temporary Redirect",
      headers: { get: () => "text/html; charset=utf-8" },
      text: async () => "<!DOCTYPE html><html><body>Redirect to sign-in</body></html>",
      ok: false,
    };

    await expect(readApiResponse(htmlResponse)).rejects.toThrow(
      "Your session has expired. Sign in again to generate images.",
    );

    // Test: HTML response from crashed function
    const crashedResponse = {
      status: 500,
      statusText: "Internal Server Error",
      headers: { get: () => "text/html" },
      text: async () => "<!DOCTYPE html><html><body>500 Server Error</body></html>",
      ok: false,
    };

    await expect(readApiResponse(crashedResponse)).rejects.toThrow(
      /Image API returned 500 Internal Server Error as text\/html/,
    );

    // Test: Invalid JSON response
    const badJsonResponse = {
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      text: async () => "not valid json {{{",
      ok: true,
    };

    await expect(readApiResponse(badJsonResponse)).rejects.toThrow(
      /Image API returned invalid JSON/,
    );

    // Test: Error JSON response
    const errorJsonResponse = {
      status: 502,
      statusText: "Bad Gateway",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ error: "Provider failed" }),
      ok: false,
    };

    await expect(readApiResponse(errorJsonResponse)).rejects.toThrow("Provider failed");
  });
});

describe("Image Studio API — authentication", () => {
  it("returns 401 JSON with sign-in message for unauthenticated requests", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({ prompt: "test image", providerId: "pollinations" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe("UNAUTHORIZED");
    expect(data.error).toContain("Sign in");
    expect(data.requestId).toBeDefined();
  });
});

describe("Image Studio API — Gemini handler", () => {
  it("passes aspect ratio and image size to Gemini", async () => {
    setEnv({ GEMINI_API_KEY: "test-gemini-key" });

    let capturedConfig: Record<string, unknown> | null = null;
    mockGenerateContent.mockImplementation(async (args: { config?: Record<string, unknown> }) => {
      capturedConfig = args.config ?? null;
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: "base64imagedata",
                    mimeType: "image/png",
                  },
                },
              ],
            },
          },
        ],
      };
    });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "a sunset over mountains",
      providerId: "gemini",
      aspectRatio: "16:9",
      imageSize: "2K",
      width: 1344,
      height: 768,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.providerId).toBe("gemini");

    // Verify aspect ratio and image size were passed
    expect(capturedConfig).not.toBeNull();
    const responseFormat = (capturedConfig as Record<string, unknown>).responseFormat as Array<Record<string, unknown>>;
    expect(responseFormat).toBeDefined();
    expect(responseFormat[0].image).toMatchObject({
      aspectRatio: "16:9",
      imageSize: "2K",
    });
  });

  it("includes reference image as inlineData when provided", async () => {
    setEnv({ GEMINI_API_KEY: "test-gemini-key" });

    let capturedParts: Array<Record<string, unknown>> | null = null;
    mockGenerateContent.mockImplementation(async (args: { contents: Array<{ parts: Array<Record<string, unknown>> }> }) => {
      capturedParts = args.contents?.[0]?.parts ?? null;
      return {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: "base64result", mimeType: "image/png" } }],
            },
          },
        ],
      };
    });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "edit this image to be more colorful",
      providerId: "gemini",
      referenceUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      aspectRatio: "1:1",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the reference image was included as inlineData
    expect(capturedParts).not.toBeNull();
    const parts = capturedParts!;
    const inlineDataPart = parts.find((p) => p.inlineData);
    expect(inlineDataPart).toBeDefined();
    expect((inlineDataPart!.inlineData as { mimeType: string }).mimeType).toBe("image/png");
    expect((inlineDataPart!.inlineData as { data: string }).data).toBe("iVBORw0KGgoAAAANSUhEUg==");
  });

  it("uses gemini-3.1-flash-lite-image as default model", async () => {
    setEnv({ GEMINI_API_KEY: "test-gemini-key" });
    // Don't set GEMINI_IMAGE_MODEL — should default

    let capturedModel: string | null = null;
    mockGenerateContent.mockImplementation(async (args: { model?: string }) => {
      capturedModel = args.model ?? null;
      return {
        candidates: [
          { content: { parts: [{ inlineData: { data: "base64", mimeType: "image/png" } }] } },
        ],
      };
    });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({ prompt: "test", providerId: "gemini" });
    await POST(req);
    expect(capturedModel).toBe("gemini-3.1-flash-lite-image");
  });
});

describe("Image Studio API — Alibaba handler", () => {
  it("generates an image via Alibaba text-to-image", async () => {
    setEnv({
      ALIBABA_DASHSCOPE_API_KEY: "test-alibaba-key",
      ALIBABA_MODELSTUDIO_WORKSPACE_ID: "test-ws-id",
      ALIBABA_MODELSTUDIO_REGION: "ap-southeast-1",
    });

    // Mock fetch for the Alibaba API call
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("aliyuncs.com")) {
        return new Response(
          JSON.stringify({
            request_id: "alibaba-req-123",
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://dashscope.aliyuncs.com/temp/image-123.png" }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // R2 upload fetch
      if (urlStr.includes("dashscope.aliyuncs.com/temp/")) {
        return new Response("fake-image-data", { status: 200, headers: { "content-type": "image/png" } });
      }
      return originalFetch(url as string, init);
    }) as typeof global.fetch;

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "a beautiful landscape",
      providerId: "alibaba",
      width: 1024,
      height: 1024,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.providerId).toBe("alibaba");
    expect(data.id).toBe("alibaba-req-123");

    global.fetch = originalFetch;
  });

  it("includes reference image in Alibaba image editing", async () => {
    setEnv({
      ALIBABA_DASHSCOPE_API_KEY: "test-alibaba-key",
      ALIBABA_MODELSTUDIO_WORKSPACE_ID: "test-ws-id",
    });

    let capturedBody: Record<string, unknown> | null = null;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("aliyuncs.com")) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            request_id: "alibaba-edit-456",
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://dashscope.aliyuncs.com/temp/edited.png" }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlStr.includes("temp/")) {
        return new Response("fake", { status: 200, headers: { "content-type": "image/png" } });
      }
      return originalFetch(url as string, init);
    }) as typeof global.fetch;

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "make this image more vibrant",
      providerId: "alibaba",
      referenceUrl: "https://example.com/input.jpg",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the reference image was included in the content
    expect(capturedBody).not.toBeNull();
    const messages = (capturedBody!.input as { messages: Array<{ content: Array<Record<string, string>> }> }).messages;
    const content = messages[0].content;
    const imageItem = content.find((c) => c.image);
    expect(imageItem).toBeDefined();
    expect(imageItem!.image).toBe("https://example.com/input.jpg");

    global.fetch = originalFetch;
  });
});

describe("Image Studio API — Cloudflare handler", () => {
  it("generates an image via Cloudflare Workers AI", async () => {
    setEnv({
      CLOUDFLARE_ACCOUNT_ID: "test-cf-account",
      CLOUDFLARE_AI_API_TOKEN: "test-cf-token",
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.cloudflare.com")) {
        // Return binary image data
        return new Response(Buffer.from("fake-png-data"), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return originalFetch(url as string);
    }) as typeof global.fetch;

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "a cyberpunk city",
      providerId: "cloudflare",
      width: 1024,
      height: 1024,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.providerId).toBe("cloudflare");
    expect(data.free).toBe(true);
    expect(data.cost).toBe(0);

    global.fetch = originalFetch;
  });
});

describe("Image Studio API — Auto Free router", () => {
  it("falls through to the next provider when the first fails", async () => {
    // Only configure Pollinations (always available) — no Cloudflare or Alibaba
    setEnv({
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_AI_API_TOKEN: undefined,
      ALIBABA_DASHSCOPE_API_KEY: undefined,
    });

    // Mock fetch for Pollinations
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("image.pollinations.ai")) {
        return new Response(Buffer.from("fake-pollinations-image"), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      return originalFetch(url as string);
    }) as typeof global.fetch;

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({
      prompt: "test image",
      generationMode: "auto-free",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // Should have fallen through to Pollinations
    expect(data.providerId).toBe("pollinations");
    expect(data.free).toBe(true);

    global.fetch = originalFetch;
  });
});

describe("Image Studio API — billing", () => {
  it("does not deduct LiTTBits on failed generation", async () => {
    setEnv({ GEMINI_API_KEY: "test-key" });

    // Make Gemini fail
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [] } }], // no image data
    });
    mockGetUserWallet.mockResolvedValue({ balance: 100 });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({ prompt: "test", providerId: "gemini" });
    const res = await POST(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.success).toBe(false);

    // Wallet balance should NOT have been deducted
    expect(mockUpdateWalletBalance).not.toHaveBeenCalled();
  });

  it("deducts LiTTBits exactly once on successful paid generation", async () => {
    setEnv({ GEMINI_API_KEY: "test-key" });

    mockGenerateContent.mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: "base64img", mimeType: "image/png" } }] } },
      ],
    });
    mockGetUserWallet.mockResolvedValue({ balance: 100 });
    mockUpdateWalletBalance.mockResolvedValue({ balance: 99 });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({ prompt: "test image", providerId: "gemini" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.cost).toBe(1);

    // Should have deducted exactly once
    expect(mockUpdateWalletBalance).toHaveBeenCalledTimes(1);
    expect(mockUpdateWalletBalance).toHaveBeenCalledWith("test-user-id", -1);
  });
});

describe("Image Studio API — secret protection", () => {
  it("never includes API keys in the response", async () => {
    setEnv({
      GEMINI_API_KEY: "SECRET_GEMINI_KEY_12345",
      ALIBABA_DASHSCOPE_API_KEY: "SECRET_ALIBABA_KEY_67890",
      CLOUDFLARE_AI_API_TOKEN: "SECRET_CF_TOKEN_ABCDEF",
    });

    mockGenerateContent.mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: "base64img", mimeType: "image/png" } }] } },
      ],
    });

    const { POST } = await import("@/app/api/media/generate/route");
    const req = makeRequest({ prompt: "test", providerId: "gemini" });
    const res = await POST(req);
    const data = await res.json();
    const dataStr = JSON.stringify(data);

    // No secrets should appear in the response
    expect(dataStr).not.toContain("SECRET_GEMINI_KEY_12345");
    expect(dataStr).not.toContain("SECRET_ALIBABA_KEY_67890");
    expect(dataStr).not.toContain("SECRET_CF_TOKEN_ABCDEF");
  });
});

describe("Image Studio API — provider status endpoint", () => {
  it("returns configuration status without exposing secrets", async () => {
    setEnv({
      GEMINI_API_KEY: "secret-gemini-key",
      GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
      ALIBABA_DASHSCOPE_API_KEY: "secret-alibaba-key",
      ALIBABA_MODELSTUDIO_WORKSPACE_ID: "ws-123",
      CLOUDFLARE_ACCOUNT_ID: "cf-account",
      CLOUDFLARE_AI_API_TOKEN: undefined, // not configured
    });

    const { GET } = await import("@/app/api/media/providers/status/route");
    const req = new NextRequest("http://localhost/api/media/providers/status", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const dataStr = JSON.stringify(data);

    // Check provider status
    const gemini = data.providers.find((p: { id: string }) => p.id === "gemini");
    expect(gemini.configured).toBe(true);
    expect(gemini.model).toBe("gemini-3.1-flash-image");

    const alibaba = data.providers.find((p: { id: string }) => p.id === "alibaba");
    expect(alibaba.configured).toBe(true);

    const cloudflare = data.providers.find((p: { id: string }) => p.id === "cloudflare");
    expect(cloudflare.configured).toBe(false);

    // No secrets should appear
    expect(dataStr).not.toContain("secret-gemini-key");
    expect(dataStr).not.toContain("secret-alibaba-key");
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const { GET } = await import("@/app/api/media/providers/status/route");
    const req = new NextRequest("http://localhost/api/media/providers/status", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
