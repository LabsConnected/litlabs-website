/**
 * Safe API response reader for client-side fetch calls.
 *
 * Prevents the "Unexpected token '<'" crash that happens when an API
 * route returns HTML (Vercel error page, 404, redirect, middleware
 * interception) instead of the expected JSON.
 *
 * Usage:
 *   const res = await fetch("/api/ai-chat", { ... });
 *   const data = await readApiResponse(res);
 *   // data is parsed JSON, or ApiResponseError is thrown
 */

/** Generic JSON object returned by most API routes. */
export type ApiJson = Record<string, unknown>;

export class ApiResponseError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly requestId: string | null;
  readonly responseType: ResponseType;
  /** HTML page title, when available (e.g. "502: Bad Gateway"). Null for non-HTML. */
  readonly pageTitle: string | null;

  constructor(opts: {
    status: number;
    endpoint: string;
    requestId: string | null;
    responseType: ResponseType;
    message?: string;
    pageTitle?: string | null;
  }) {
    const label = opts.message ?? responseTypeLabel(opts.responseType, opts.status);
    super(label);
    this.name = "ApiResponseError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.requestId = opts.requestId;
    this.responseType = opts.responseType;
    this.pageTitle = opts.pageTitle ?? null;
  }

  /** A user-safe diagnostic string (never includes raw HTML). */
  toDiagnostic(): string {
    const parts = [
      `Status: ${this.status}`,
      `Endpoint: ${this.endpoint}`,
    ];
    if (this.requestId) parts.push(`Request ID: ${this.requestId}`);
    if (this.pageTitle) parts.push(`Page: ${this.pageTitle}`);
    parts.push(`Response type: ${this.responseType}`);
    return parts.join(" · ");
  }
}

/**
 * Extract the <title> from an HTML error page.
 * Returns null if no title is found. Never throws.
 * Strips tags/whitespace and caps length so it's safe to display.
 */
function extractHtmlTitle(html: string): string | null {
  // Case-insensitive, allows attributes on the <title> tag and whitespace
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = match[1]
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, "") // strip any nested tags
    .trim();
  if (!title) return null;
  return title.length > 120 ? title.slice(0, 120) + "…" : title;
}

export type ResponseType =
  | "json"
  | "html"
  | "invalid-json"
  | "empty"
  | "unknown";

function responseTypeLabel(type: ResponseType, status: number): string {
  switch (type) {
    case "html":
      return `Received HTML instead of JSON (HTTP ${status}). The endpoint may be down, redirecting, or returning an error page.`;
    case "invalid-json":
      return `Malformed JSON response (HTTP ${status}).`;
    case "empty":
      return `Empty response body (HTTP ${status}).`;
    case "unknown":
      return `Unexpected response type (HTTP ${status}).`;
    default:
      return `Request failed (HTTP ${status}).`;
  }
}

/**
 * Read an API response safely.
 *
 * 1. Records status, content-type, and request ID headers.
 * 2. Reads the body once with `response.text()`.
 * 3. Parses JSON only when content-type includes "application/json".
 * 4. Detects HTML responses (DOCTYPE or text/html content-type).
 * 5. Throws `ApiResponseError` for non-JSON responses.
 * 6. Never exposes raw HTML to the caller.
 *
 * @returns Parsed JSON body (for successful responses).
 * @throws ApiResponseError for HTML, malformed JSON, empty, or error responses.
 */
export async function readApiResponse<T = unknown>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-vercel-id") ??
    response.headers.get("cf-ray") ??
    null;
  const endpoint = response.url || "(unknown)";

  // Read the body once — calling .text() then .json() would fail
  const raw = await response.text();

  // Empty response
  if (raw.length === 0) {
    if (response.ok) {
      // Some endpoints legitimately return empty 200/204
      return undefined as T;
    }
    throw new ApiResponseError({
      status: response.status,
      endpoint,
      requestId,
      responseType: "empty",
    });
  }

  const looksLikeHtml =
    contentType.includes("text/html") ||
    raw.trimStart().startsWith("<!DOCTYPE") ||
    raw.trimStart().startsWith("<html");

  // HTML response — never expose the raw HTML, but capture the page title
  // (e.g. "502: Bad Gateway") for diagnostics.
  if (looksLikeHtml) {
    throw new ApiResponseError({
      status: response.status,
      endpoint,
      requestId,
      responseType: "html",
      pageTitle: extractHtmlTitle(raw),
    });
  }

  // Content-Type says JSON (or doesn't say HTML) — try to parse
  if (contentType.includes("application/json") || !looksLikeHtml) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiResponseError({
        status: response.status,
        endpoint,
        requestId,
        responseType: "invalid-json",
      });
    }

    // Check for application-level error
    if (!response.ok) {
      const errMsg =
        typeof body === "object" && body !== null
          ? (body as { error?: string }).error
          : undefined;
      throw new ApiResponseError({
        status: response.status,
        endpoint,
        requestId,
        responseType: "json",
        message: errMsg ?? `Request failed (HTTP ${response.status}).`,
      });
    }

    return body as T;
  }

  // Unknown content type
  throw new ApiResponseError({
    status: response.status,
    endpoint,
    requestId,
    responseType: "unknown",
  });
}

// ──────────────────────────────────────────────────────────────────────────
// apiFetch — standard client-side API client
//
// Wraps fetch() with:
//   • timeout via AbortController (default 30s)
//   • automatic retry on 502/503/504 and network errors (default 1 retry)
//   • JSON parsing via readApiResponse (HTML/invalid-JSON detection)
//   • diagnostics (status, endpoint, request ID, page title)
//
// Usage:
//   const data = await apiFetch<MyType>("/api/media/generate", {
//     method: "POST",
//     body: JSON.stringify({ prompt }),
//   });
//
// Throws ApiResponseError on any non-JSON or non-2xx response, and on
// timeout/network failures (responseType "empty" with status 0).
// ──────────────────────────────────────────────────────────────────────────

export interface ApiFetchOptions extends RequestInit {
  /** Abort timeout in ms. Default 30_000. Set to 0 to disable. */
  timeoutMs?: number;
  /** Max retry attempts on 502/503/504 or network error. Default 1. */
  retries?: number;
  /** Base delay between retries (exponential backoff). Default 500ms. */
  retryDelayMs?: number;
  /** Called when a retry is attempted (for metrics/telemetry). */
  onRetry?: (info: { statusCode: number; attempt: number }) => void;
  /** Called when an error is surfaced (for metrics/telemetry). */
  onError?: (info: { type: "timeout" | "network" | "http" | "html"; statusCode: number }) => void;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Standard API client. Wraps fetch() with timeout, retry, and safe JSON parsing.
 *
 * @throws ApiResponseError on non-JSON responses, HTTP errors, timeout, or
 *   network failure. Network/timeout failures carry responseType "empty" and
 *   status 0 so callers can distinguish them from real server errors.
 */
export async function apiFetch<T = unknown>(
  input: string | URL,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const {
    timeoutMs = 30_000,
    retries = 1,
    retryDelayMs = 500,
    signal: externalSignal,
    onRetry,
    onError,
    ...fetchOpts
  } = opts;

  const maxAttempts = Math.max(1, retries + 1);
  let lastError: ApiResponseError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Compose the abort controller so either the caller's signal or our
    // timeout can abort the request.
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer =
      timeoutMs > 0
        ? setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs)
        : null;

    // ── Phase 1: fetch (network errors / timeout caught here) ──────
    let res: Response;
    let fetchFailed = false;
    let fetchErr: unknown = null;
    try {
      res = await fetch(input, {
        ...fetchOpts,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          // Only set JSON content-type for string bodies (FormData/Blob
          // must let the browser set the correct multipart/boundary header).
          ...(typeof fetchOpts.body === "string"
            ? { "Content-Type": "application/json" }
            : {}),
          ...fetchOpts.headers,
        },
      });
    } catch (err) {
      fetchFailed = true;
      fetchErr = err;
      res = undefined as unknown as Response; // satisfy TS
    }
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);

    // Handle fetch failure (network error or timeout)
    if (fetchFailed) {
      // Caller-initiated abort — propagate as-is
      if (externalSignal?.aborted) throw fetchErr;

      // Network failure or timeout — retry, then surface as ApiResponseError
      if (attempt < maxAttempts) {
        onRetry?.({ statusCode: 0, attempt });
        try {
          await delay(retryDelayMs * attempt, externalSignal);
        } catch {
          throw fetchErr;
        }
        continue;
      }

      const isTimeout =
        fetchErr instanceof DOMException &&
        (fetchErr.name === "TimeoutError" || fetchErr.name === "AbortError");
      onError?.({ type: isTimeout ? "timeout" : "network", statusCode: 0 });
      lastError = new ApiResponseError({
        status: 0,
        endpoint: typeof input === "string" ? input : input.toString(),
        requestId: null,
        responseType: "empty",
        message: isTimeout
          ? `Request timed out after ${timeoutMs}ms`
          : fetchErr instanceof Error
            ? `Network error: ${fetchErr.message}`
            : "Network request failed",
      });
      throw lastError;
    }

    // ── Phase 2: parse response (ApiResponseError caught here) ─────
    try {
      return await readApiResponse<T>(res);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        lastError = err;
        // Retry only on transient server errors
        if (attempt < maxAttempts && RETRYABLE_STATUS.has(err.status)) {
          onRetry?.({ statusCode: err.status, attempt });
          await delay(retryDelayMs * attempt, externalSignal);
          continue;
        }
        // Surface error type for metrics
        const errType = err.responseType === "html" ? "html" : "http";
        onError?.({ type: errType, statusCode: err.status });
      }
      throw err;
    }
  }

  // Should be unreachable, but satisfy the type checker
  throw lastError ?? new ApiResponseError({
    status: 0,
    endpoint: typeof input === "string" ? input : String(input),
    requestId: null,
    responseType: "empty",
    message: "Request failed",
  });
}
