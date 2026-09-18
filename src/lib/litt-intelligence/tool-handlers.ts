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

import {
  generateImage,
  type ImageGenerationInput,
} from "@/lib/generation/image-service";
import type { MediaProviderId } from "@/lib/media";

/**
 * Image Generate handler — calls the shared image generation service
 * DIRECTLY. There is no HTTP self-fetch to /api/media/generate: the agent
 * loop has no Clerk session, so the registry passes the workspace
 * transport as the second argument and the handler takes the approving
 * user's identity from it as trusted server-side context.
 *
 * Uses auto-free mode (Pollinations) by default to avoid wallet
 * requirements. Returns a downloadUrl that can be rendered inline in chat.
 *
 * Stable operation identity: when the transport carries the approved
 * operation's identity (operationId), it becomes the service requestId, so
 * retries of the same approved operation replay instead of generating
 * and debiting twice.
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

  // Trusted server-side context only. Never read a user ID from the tool
  // inputs — the agent never has a Clerk session, and a client-supplied
  // user ID must never be trusted for billing.
  const t =
    transport && typeof transport === "object"
      ? (transport as {
          userId?: unknown;
          projectId?: unknown;
          operationId?: unknown;
        })
      : null;
  const userId = typeof t?.userId === "string" && t.userId ? t.userId : null;
  if (!userId) {
    return {
      success: false,
      error: "Image generation requires an authenticated user context",
    };
  }

  const input: ImageGenerationInput = {
    prompt,
    format: "image",
    generationMode: providerId ? "manual" : "auto-free",
    ...(providerId ? { providerId: providerId as MediaProviderId } : {}),
  };

  try {
    const result = await generateImage(
      {
        userId,
        projectId:
          typeof t?.projectId === "string" && t.projectId
            ? t.projectId
            : undefined,
        requestId:
          typeof t?.operationId === "string" && t.operationId
            ? `approval:${t.operationId}`
            : undefined,
      },
      input,
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        retryable: result.retryable,
      };
    }

    return {
      success: true,
      downloadUrl: result.downloadUrl,
      thumbUrl: result.thumbUrl ?? null,
      providerId: result.providerId,
      title: result.title,
      id: result.id,
      cost: result.cost ?? 0,
      free: result.free ?? true,
      markdown: `![${prompt}](${result.downloadUrl})`,
      // Tell the model how to place this image into the website project
      // instead of leaving it as a chat-only render.
      insertHint: "To place this image into the active website project, call project.insert_asset with this downloadUrl, then reference the returned sitePath in the site's HTML.",
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Image generation failed" };
  }
}
