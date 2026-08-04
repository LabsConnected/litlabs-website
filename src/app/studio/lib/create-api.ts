/**
 * Safe API response parser — never throws "Unexpected token '<'".
 *
 * Reads the response as text first, checks content-type, then parses JSON.
 * Returns a clear error message with HTTP status and response preview
 * when the server returns HTML (auth redirect, Vercel middleware, crashed function).
 *
 * Shared across all Create tools (Image, Video, Audio, Music) so that
 * every API call uses the same error-handling contract.
 */

export type ApiJson = Record<string, unknown>;

export interface CreateRequest {
  kind: "image" | "video" | "audio" | "music";
  prompt: string;
  mode: "auto-free" | "auto-best" | "manual";
  providerId?: string;
  model?: string;
  referenceAssetIds?: string[];
  aspectRatio?: string;
  durationSeconds?: number;
  quality?: "draft" | "standard" | "best";
  advanced?: Record<string, unknown>;
}

export interface CreateResult {
  success: boolean;
  requestId: string;
  jobId?: string;
  kind: "image" | "video" | "audio" | "music";
  status: "queued" | "running" | "complete" | "failed";
  providerId: string;
  model?: string;
  assetUrl?: string;
  thumbnailUrl?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  cost: number;
  balance?: number;
}

/**
 * Parse a fetch Response safely.
 *
 * - Checks content-type before attempting JSON.parse
 * - Detects auth redirects (Clerk middleware returns HTML login pages)
 * - Returns a readable error with HTTP status and preview on non-JSON responses
 * - Throws a user-friendly Error on failure — never throws a raw SyntaxError
 *
 * @param label Short label for the API (e.g. "Image", "Video") used in error messages
 */
export async function readApiResponse(
  res: Response,
  label = "API",
): Promise<ApiJson> {
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();

  if (!contentType.includes("application/json")) {
    const preview = raw.replace(/\s+/g, " ").slice(0, 240);
    const isAuthRedirect =
      res.status === 401 ||
      (res.status === 307 && raw.includes("sign-in")) ||
      (raw.includes("sign-in") && raw.includes("<!DOCTYPE"));
    if (isAuthRedirect) {
      throw new Error(
        "Your session has expired. Sign in again to continue.",
      );
    }
    throw new Error(
      `${label} API returned ${res.status} ${res.statusText} as ` +
      `${contentType || "unknown content type"}. ${preview}`,
    );
  }

  let data: ApiJson;
  try {
    data = JSON.parse(raw) as ApiJson;
  } catch {
    throw new Error(
      `${label} API returned invalid JSON (${res.status}). ` +
      raw.slice(0, 240),
    );
  }

  if (!res.ok) {
    const errorMsg =
      typeof data.error === "string"
        ? data.error
        : `Request failed with HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error("Your session has expired. Sign in again to continue.");
    }
    throw new Error(errorMsg);
  }

  return data;
}
