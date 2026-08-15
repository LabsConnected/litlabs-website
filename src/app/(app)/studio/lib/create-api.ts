/**
 * Create-tool API contract types.
 *
 * The response parser (`readApiResponse`) and `ApiJson` type now live in
 * `@/lib/api-response` — use `apiFetch()` from there for all client-side
 * API calls. It provides timeout, retry on 502/503/504, HTML detection,
 * and diagnostics (request ID, page title) without leaking raw HTML.
 */

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
