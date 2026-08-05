// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { readApiResponse, apiFetch, ApiResponseError } from "@/lib/api-response";

/**
 * Helper: create a Response object with the given properties.
 * Node's Response requires headers as an iterable.
 */
function makeResponse(opts: {
  status?: number;
  contentType?: string;
  body?: string;
  requestId?: string;
  requestIdHeader?: string;
  url?: string;
}): Response {
  const status = opts.status ?? 200;
  const headers: [string, string][] = [];
  if (opts.contentType) headers.push(["content-type", opts.contentType]);
  if (opts.requestId) headers.push(["x-request-id", opts.requestId]);
  if (opts.requestIdHeader) headers.push([opts.requestIdHeader.split(":")[0], opts.requestIdHeader.split(":")[1]]);
  const res = new Response(opts.body ?? "", {
    status,
    headers,
  });
  // Response.url is read-only and normally set by fetch(), not the constructor.
  // Override it for testing so readApiResponse can read the endpoint.
  const url = opts.url ?? "https://litlabs.net/api/test";
  Object.defineProperty(res, "url", { value: url, configurable: true });
  return res;
}

describe("readApiResponse", () => {
  it("returns parsed JSON for a successful response", async () => {
    const res = makeResponse({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "hello world" }),
    });
    const data = await readApiResponse<{ text: string }>(res);
    expect(data.text).toBe("hello world");
  });

  it("throws ApiResponseError with responseType 'json' for a 401", async () => {
    const res = makeResponse({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Authentication required" }),
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(401);
      expect(e.responseType).toBe("json");
      expect(e.message).toBe("Authentication required");
    }
  });

  it("throws ApiResponseError with responseType 'json' for a 500", async () => {
    const res = makeResponse({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Internal server error" }),
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(500);
      expect(e.responseType).toBe("json");
      expect(e.message).toBe("Internal server error");
    }
  });

  it("throws ApiResponseError with responseType 'html' for a 404 HTML page", async () => {
    const res = makeResponse({
      status: 404,
      contentType: "text/html; charset=utf-8",
      body: "<!DOCTYPE html><html><head><title>404</title></head><body>Not found</body></html>",
      requestId: "req_abc123",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(404);
      expect(e.responseType).toBe("html");
      expect(e.requestId).toBe("req_abc123");
      // The raw HTML must never appear in the error message
      expect(e.message).not.toContain("<!DOCTYPE");
      expect(e.message).not.toContain("<html>");
    }
  });

  it("throws ApiResponseError with responseType 'html' for an auth redirect page", async () => {
    const res = makeResponse({
      status: 302,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=/sign-in\"></head></html>",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(302);
      expect(e.responseType).toBe("html");
    }
  });

  it("throws ApiResponseError with responseType 'invalid-json' for malformed JSON", async () => {
    const res = makeResponse({
      status: 200,
      contentType: "application/json",
      body: "{broken json",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(200);
      expect(e.responseType).toBe("invalid-json");
    }
  });

  it("throws ApiResponseError with responseType 'empty' for an empty error response", async () => {
    const res = makeResponse({
      status: 502,
      contentType: "",
      body: "",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(502);
      expect(e.responseType).toBe("empty");
    }
  });

  it("returns undefined for an empty 200 response (legitimate empty success)", async () => {
    const res = makeResponse({
      status: 200,
      contentType: "",
      body: "",
    });
    const data = await readApiResponse(res);
    expect(data).toBeUndefined();
  });

  it("includes endpoint and request ID in diagnostics", async () => {
    const res = makeResponse({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Failed" }),
      requestId: "req_xyz789",
      url: "https://litlabs.net/api/ai-chat",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      const diag = e.toDiagnostic();
      expect(diag).toContain("Status: 500");
      expect(diag).toContain("Endpoint: https://litlabs.net/api/ai-chat");
      expect(diag).toContain("Request ID: req_xyz789");
      expect(diag).toContain("Response type: json");
    }
  });

  it("detects HTML even without text/html content-type (DOCTYPE check)", async () => {
    const res = makeResponse({
      status: 500,
      contentType: "application/json",
      body: "<!DOCTYPE html><html><body>Vercel error page</body></html>",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.responseType).toBe("html");
      expect(e.message).not.toContain("Vercel error page");
    }
  });

  it("handles JSON without explicit content-type (content inference)", async () => {
    const res = makeResponse({
      status: 200,
      contentType: "",
      body: JSON.stringify({ text: "works" }),
    });
    const data = await readApiResponse<{ text: string }>(res);
    expect(data.text).toBe("works");
  });

  it("preserves the endpoint URL in the error", async () => {
    const res = makeResponse({
      status: 404,
      contentType: "text/html",
      body: "<!DOCTYPE html><html>Not found</html>",
      url: "https://litlabs.net/api/missing",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.endpoint).toBe("https://litlabs.net/api/missing");
    }
  });
});

describe("ApiResponseError", () => {
  it("creates an error with all fields", () => {
    const err = new ApiResponseError({
      status: 503,
      endpoint: "https://litlabs.net/api/test",
      requestId: "req_123",
      responseType: "html",
    });
    expect(err.name).toBe("ApiResponseError");
    expect(err.status).toBe(503);
    expect(err.endpoint).toBe("https://litlabs.net/api/test");
    expect(err.requestId).toBe("req_123");
    expect(err.responseType).toBe("html");
  });

  it("toDiagnostic never includes raw HTML", () => {
    const err = new ApiResponseError({
      status: 404,
      endpoint: "https://litlabs.net/api/test",
      requestId: null,
      responseType: "html",
    });
    const diag = err.toDiagnostic();
    expect(diag).not.toContain("<");
    expect(diag).not.toContain("DOCTYPE");
  });

  it("toDiagnostic handles null request ID gracefully", () => {
    const err = new ApiResponseError({
      status: 500,
      endpoint: "https://litlabs.net/api/test",
      requestId: null,
      responseType: "json",
    });
    const diag = err.toDiagnostic();
    expect(diag).toContain("Status: 500");
    expect(diag).not.toContain("Request ID");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// HTML <title> extraction
// ──────────────────────────────────────────────────────────────────────────
describe("readApiResponse — HTML title extraction", () => {
  it("extracts the <title> from a Vercel 502 error page", async () => {
    const res = makeResponse({
      status: 502,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><head><title>502: Bad Gateway</title></head><body>...</body></html>",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.responseType).toBe("html");
      expect(e.pageTitle).toBe("502: Bad Gateway");
      expect(e.toDiagnostic()).toContain("Page: 502: Bad Gateway");
    }
  });

  it("extracts title even with attributes on the <title> tag", async () => {
    const res = makeResponse({
      status: 500,
      contentType: "text/html",
      body: '<html><head><title id="err">Application Error</title></head></html>',
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.pageTitle).toBe("Application Error");
    }
  });

  it("returns null pageTitle when HTML has no <title>", async () => {
    const res = makeResponse({
      status: 404,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><body>Not found</body></html>",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.pageTitle).toBeNull();
      expect(e.toDiagnostic()).not.toContain("Page:");
    }
  });

  it("truncates very long titles", async () => {
    const longTitle = "A".repeat(200);
    const res = makeResponse({
      status: 500,
      contentType: "text/html",
      body: `<html><head><title>${longTitle}</title></head></html>`,
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.pageTitle).toHaveLength(121); // 120 chars + "…" (1 char)
      expect(e.pageTitle).toContain("…");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// cf-ray header support
// ──────────────────────────────────────────────────────────────────────────
describe("readApiResponse — cf-ray header", () => {
  it("uses cf-ray as request ID when x-request-id and x-vercel-id are absent", async () => {
    const res = makeResponse({
      status: 502,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><head><title>502</title></head></html>",
      requestIdHeader: "cf-ray: 89abc123def",
    });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.requestId).toBe("89abc123def");
    }
  });

  it("prefers x-request-id over cf-ray", async () => {
    const headers: [string, string][] = [
      ["content-type", "text/html"],
      ["x-request-id", "req_priority"],
      ["cf-ray", "cf_secondary"],
    ];
    const res = new Response("<!DOCTYPE html><html></html>", { status: 500, headers });
    Object.defineProperty(res, "url", { value: "https://test/api", configurable: true });
    try {
      await readApiResponse(res);
      expect.fail("Should have thrown");
    } catch (err) {
      const e = err as ApiResponseError;
      expect(e.requestId).toBe("req_priority");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// apiFetch — timeout, retry, JSON parsing
// ──────────────────────────────────────────────────────────────────────────
describe("apiFetch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** Helper: create a fresh JSON Response (body can only be read once). */
  function jsonRes(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("returns parsed JSON for a successful response", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    const data = await apiFetch<{ ok: boolean }>("/api/test");
    expect(data.ok).toBe(true);
  });

  it("sets Accept and Content-Type headers for JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    global.fetch = fetchMock;
    await apiFetch("/api/test", { method: "POST", body: JSON.stringify({ x: 1 }) });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Accept).toBe("application/json");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("does not set Content-Type for FormData body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    global.fetch = fetchMock;
    const form = new FormData();
    form.append("file", new Blob(["x"]), "test.txt");
    await apiFetch("/api/upload", { method: "POST", body: form });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Accept).toBe("application/json");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("retries on 502 then succeeds", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: "bad gateway" }, 502))
      .mockResolvedValueOnce(jsonRes({ ok: true }));

    const data = await apiFetch<{ ok: boolean }>("/api/test", { retries: 1, retryDelayMs: 1 });
    expect(data.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws ApiResponseError after exhausting retries on 503", async () => {
    // Each call needs a fresh Response — body can only be read once
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonRes({ error: "unavailable" }, 503)),
    );

    try {
      await apiFetch("/api/test", { retries: 1, retryDelayMs: 1 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(503);
    }
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401 (non-retryable)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ error: "auth required" }, 401));
    try {
      await apiFetch("/api/test", { retries: 3 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(401);
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces network errors as ApiResponseError with status 0", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    try {
      await apiFetch("/api/test", { retries: 0 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(0);
      expect(e.responseType).toBe("empty");
      expect(e.message).toContain("Network error");
    }
  });

  it("surfaces timeout as ApiResponseError with status 0", async () => {
    // fetch that never resolves — the timeout will abort it
    global.fetch = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    try {
      await apiFetch("/api/test", { timeoutMs: 50, retries: 0 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.status).toBe(0);
      expect(e.message).toContain("timed out");
    }
  });

  it("detects HTML response and throws with page title", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        "<!DOCTYPE html><html><head><title>500: Server Error</title></head></html>",
        { status: 500, headers: { "content-type": "text/html" } },
      ),
    );
    try {
      await apiFetch("/api/test", { retries: 0 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const e = err as ApiResponseError;
      expect(e.responseType).toBe("html");
      expect(e.pageTitle).toBe("500: Server Error");
      expect(e.message).not.toContain("<!DOCTYPE");
    }
  });
});
