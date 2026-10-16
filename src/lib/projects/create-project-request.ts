import type { ProjectTemplateId } from "./types";

/**
 * Client-side helper for POST /api/studio-projects (managed/blank create).
 *
 * One canonical request shape shared by every "New project" surface
 * (Studio picker dialog, Dashboard BuildConsole, /projects): the API
 * contract and its error message mapping live in exactly one place.
 *
 * The route responds as soon as the row commits — durable workspace
 * provisioning runs post-response — so this resolves promptly and the
 * caller can navigate straight to the new project.
 */
export async function createManagedStudioProject(input: {
  name: string;
  templateId?: ProjectTemplateId;
  getToken?: () => Promise<string | null>;
}): Promise<{ id: string; name: string; workspaceStatus?: string | null }> {
  const token = await input.getToken?.();
  const res = await fetch("/api/studio-projects", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      sourceType: "blank",
      name: input.name,
      templateId: input.templateId ?? "blank-static",
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    project?: { id?: string; name?: string; workspaceStatus?: string | null };
    error?: string;
  };
  if (!res.ok || !payload.project?.id) {
    throw new Error(payload.error || `Failed to create project (${res.status})`);
  }
  return {
    id: payload.project.id,
    name: payload.project.name ?? input.name,
    workspaceStatus: payload.project.workspaceStatus ?? null,
  };
}

/**
 * Derives a project name from a freeform creation prompt (Dashboard
 * BuildConsole). Bounded to the API's 120-char limit; falls back to the
 * generic default when the prompt can't produce one.
 */
export function deriveProjectNameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const name = words.slice(0, 8).join(" ").slice(0, 80).trim();
  return name || "My new project";
}
