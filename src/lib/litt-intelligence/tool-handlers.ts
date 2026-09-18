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
import { generateMediaForUser } from "@/lib/media/image-generation-service";
import type { WorkspaceTransport } from "./workspace-transport";
import type { MediaProviderId } from "@/lib/media";

/**
 * Image Generate handler — calls the shared media generation service.
 * Uses auto-free mode (Pollinations) by default to avoid wallet requirements.
 * Returns a downloadUrl that can be rendered inline in chat.
 *
 * Identity comes only from the verified WorkspaceTransport. The handler calls
 * the shared server-side service directly, so it never forwards browser
 * cookies or relies on an internal HTTP self-fetch.
 */
export async function handleImageGenerate(
  inputs: Record<string, unknown>,
  transport?: unknown,
): Promise<unknown> {
  const prompt = inputs.prompt as string;
  const providerId = inputs.providerId as string | undefined;
  const executionContext = transport as WorkspaceTransport | undefined;
  const userId = executionContext?.userId ?? null;

  if (!prompt || prompt.length < 3) {
    return { success: false, error: "Prompt must be at least 3 characters" };
  }
  if (!userId) {
    return { success: false, error: "Authenticated execution context is required" };
  }
  const projectId = typeof inputs.projectId === "string" ? inputs.projectId : undefined;
  if (projectId && projectId !== executionContext?.projectId) {
    return { success: false, error: "Project is not owned by the authenticated workspace" };
  }

  try {
    const response = await generateMediaForUser(userId, {
      prompt,
      format: "image",
      requestId: typeof inputs.requestId === "string" ? inputs.requestId : undefined,
      generationMode: "auto-free",
      ...(providerId ? { providerId: providerId as MediaProviderId, generationMode: "manual" } : {}),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload || payload.success !== true) {
      return {
        success: false,
        error: typeof payload?.error === "string" ? payload.error : `Generation failed (${response.status})`,
      };
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
      insertHint: "To place this image into the active website project, call project.insert_asset with this downloadUrl, then reference the returned sitePath in the site's HTML.",
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Image generation request failed" };
  }
}
