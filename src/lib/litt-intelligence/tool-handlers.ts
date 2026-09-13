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
 */
export async function handleImageGenerate(inputs: Record<string, unknown>): Promise<unknown> {
  const prompt = inputs.prompt as string;
  const providerId = inputs.providerId as string | undefined;

  if (!prompt || prompt.length < 3) {
    return { success: false, error: "Prompt must be at least 3 characters" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  try {
    const response = await fetch(`${url}/api/media/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Image generation request failed" };
  }
}
