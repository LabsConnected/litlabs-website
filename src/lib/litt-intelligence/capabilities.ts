import "server-only";

import { MEDIA_PROVIDERS } from "@/lib/media";

/**
 * Capability resolution — the SINGLE SOURCE OF TRUTH for which tool
 * capabilities the current deployment can actually satisfy.
 *
 * Background: `ToolRegistry.execute` fails closed when a tool declares
 * `requiredCapabilities` that are not in `options.availableCapabilities`,
 * but nothing in the V2 agent loop ever populated that set — so every
 * capability-gated tool (`image.generate`, `web.search`, `files.patch`,
 * `checkpoint.*`, …) was advertised to the model and approved by the user,
 * then rejected at execution with
 * `Tool "image.generate" requires capability "image_generation" which is not
 * available`. The user saw "The approved workspace operation failed" with
 * nothing written and no BITS spent.
 *
 * The fix threads this resolver's output into every V2 execution path:
 * - `PermissionEngine.check` (model-facing tool list + approval decisions)
 * - `ToolRegistry.execute` (initial loop, approval resume, repair callback)
 * - `ResumeInput` (approvals route → `resumeAgentLoopV2`)
 * so a tool can never be advertised or approved and then rejected as
 * "incapable". If a capability is genuinely unavailable here, the tool is
 * not offered to the model in the first place.
 */
export function resolveAvailableCapabilities(ctx?: {
  /** The V2 workspace transport, when the caller has one. */
  transport?: unknown;
}): string[] {
  const caps = new Set<string>();

  // web_search: the realtime internet tools delegate to @litt/agent-core
  // (DuckDuckGo search, SSRF-safe fetch, NWS weather). No API keys, no
  // per-user wiring — always available wherever the loop runs.
  caps.add("web_search");

  // image_generation: the agent path calls /api/media/generate with
  // generationMode "auto-free", which walks AUTO_FREE_ORDER filtered by
  // configured providers. Pollinations is a wired, no-key, free provider,
  // so at least one auto-free provider is always available. Mirror that
  // truth here instead of hardcoding: if the catalog ever loses its last
  // no-key free image provider, the capability honestly disappears and the
  // tool stops being advertised instead of failing post-approval.
  const hasFreeImageProvider = MEDIA_PROVIDERS.some(
    (p) =>
      p.supportedFormats.includes("image") &&
      p.free &&
      !p.requiresKey &&
      p.wired !== false,
  );
  if (hasFreeImageProvider) caps.add("image_generation");

  // filesystem: files.patch / checkpoint.create / checkpoint.restore operate
  // through the V2 workspace transport. Without a transport the handlers
  // cannot run, so the capability is only advertised when one is present.
  if (ctx?.transport) caps.add("filesystem");

  return [...caps];
}
