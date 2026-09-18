/**
 * LiTT Tool Handlers — app-level (non-workspace) tool handlers.
 *
 * Workspace-scoped tools (files.*, git.*, project.*, terminal.execute,
 * build/test/checks, preview) are implemented in tool-handlers-v2.ts and
 * always execute through the WorkspaceTransport against the user's
 * terminal-server workspace.
 *
 * The legacy process.cwd()/execSync handlers were removed: on the web
 * service, process.cwd() is the LiTT app deployment itself — never user
 * project storage — so those handlers leaked app source on reads and
 * would have mutated the deployed app on writes.
 *
 * Security model:
 * - Read-only tools execute automatically without approval.
 * - Mutation tools require explicit approval (enforced by the registry
 *   and the permission engine).
 */

import "server-only";

/**
 * Image Generate handler — calls the shared media generation API.
 * Uses auto-free mode (Pollinations) by default to avoid wallet requirements.
 * Returns a downloadUrl that can be rendered inline in chat.
 *
 * Server-to-server auth: the agent loop has no Clerk session, so a bare
 * self-fetch to /api/media/generate is rejected (401 "Sign in to generate
 * media") and every approved image.generate run died with "The approved
 * workspace operation failed". The registry passes the workspace transport
 * as the second argument; it carries the approving user's ID. When the
 * internal service key is configured, the call is authenticated with it and
 * attributed to that user for billing/rate-limiting exactly as a direct
 * call would be.
 */
export async function handleImageGenerate(
  inputs: Record<string, unknown>,
  transport?: unknown,
): Promise<unknown> {
  const prompt = inputs.prompt as string;
  const providerId = inputs.providerId as string | undefined;

  if (!prompt || prompt.length < 3) {
    return { success: false, error: "Prompt must be at least 3 characters" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const agentUserId =
    transport && typeof transport === "object"
      ? (transport as { userId?: unknown }).userId
      : undefined;
  const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  if (internalKey && typeof agentUserId === "string" && agentUserId) {
    headers["X-Internal-Service-Key"] = internalKey;
    headers["X-Agent-User-Id"] = agentUserId;
  }

  try {
    const response = await fetch(`${url}/api/media/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        format: "image",
        generationMode: "auto-free",
        ...(providerId ? { providerId, generationMode: "manual" } : {}),
      }),
    });

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok || !payload) {
      const error = typeof payload?.error === "string" ? payload.error : `Generation failed (${response.status})`;
      return { success: false, error };
    }

    if (payload.success !== true) {
      const error = typeof payload.error === "string" ? payload.error : "Generation failed";
      return { success: false, error };
    }

    return {
      success: true,
      downloadUrl: payload.downloadUrl,
      thumbUrl: payload.thumbUrl ?? null,
      providerId: payload.providerId,
      title: payload.title,
      id: payload.id,
      cost: payload.cost ?? 0,
      free: payload.free ?? true,
      markdown: `![${prompt}](${payload.downloadUrl})`,
      // Tell the model how to place this image into the website project
      // instead of leaving it as a chat-only render.
      insertHint: "To place this image into the active website project, call project.insert_asset with this downloadUrl, then reference the returned sitePath in the site's HTML.",
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Image generation request failed" };
  }
}
