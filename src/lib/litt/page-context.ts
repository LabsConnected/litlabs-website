import { APP_NAV_MAIN, APP_NAV_MORE, APP_NAV_SECONDARY } from "@/lib/navigation";
import { stationToToolParam } from "@/app/(app)/studio/components/shell/station-url";

/** Descriptive client context only. Server authentication and permissions remain authoritative. */
export interface LittPageContext {
  pathname: string;
  surface: string;
  projectId: string | null;
  selectedEntity: { kind: string; id: string } | null;
  identity: { userId: string | null };
  role: null;
  permissions: "server-resolved";
  capabilities: readonly ["navigate", "continue-in-studio"];
}

export function buildLittPageContext(pathname: string, params: URLSearchParams, userId: string | null): LittPageContext {
  const segments = pathname.split("/").filter(Boolean);
  // Never carry the last Studio project's ID onto an unrelated page.
  const projectId = segments[0] === "projects" && segments[1]
    ? segments[1]
    : segments[0] === "studio" ? params.get("project") : null;
  const selectedEntity = segments[0] === "projects" && segments[1]
    ? { kind: "project", id: segments[1] }
    : segments[0] === "deployments" && segments[1]
      ? { kind: "deployment", id: segments[1] } : null;
  return { pathname, surface: segments[0] ?? "home", projectId, selectedEntity,
    identity: { userId }, role: null, permissions: "server-resolved",
    capabilities: ["navigate", "continue-in-studio"] };
}

const destinations = [...APP_NAV_MAIN, ...APP_NAV_MORE, ...APP_NAV_SECONDARY.flatMap(section => section.items)];

/** A closed set of existing application routes; never execute model-provided URLs. */
export function resolveLittNavigation(request: string, context?: LittPageContext, conversation?: { id: string; projectId: string } | null): string | null {
  const name = request.trim().toLowerCase().replace(/^(go to|go|open|take me to)\s+/, "").replace(/^my\s+/, "").replace(/[.!?]+$/, "");
  if (context && ["studio", "return to studio", "current project's studio", "preview", "current project's preview"].includes(name)) {
    const url = new URL(studioBridgeUrl(context, "", conversation ?? null), "https://litt.invalid");
    if (name.includes("preview")) {
      if (!url.searchParams.has("project")) return null;
      url.searchParams.set("tool", stationToToolParam("preview"));
    }
    return `${url.pathname}${url.search}`;
  }
  if (["settings", "billing", "credits", "billing/credits", "wallet"].includes(name)) {
    return name === "settings" ? "/settings" : "/settings?section=billing";
  }
  return destinations.find(item => item.label.toLowerCase() === name)?.href ?? null;
}

export function studioBridgeUrl(context: LittPageContext, prompt: string, conversation: { id: string; projectId: string } | null): string {
  const params = new URLSearchParams();
  // Preserve the canonical conversation only within the correct project boundary.
  const matchingConversation = conversation && (!context.projectId || conversation.projectId === context.projectId) ? conversation : null;
  const projectId = context.projectId ?? matchingConversation?.projectId;
  if (projectId) params.set("project", projectId);
  if (matchingConversation) params.set("conversation", matchingConversation.id);
  if (prompt.trim()) params.set("prompt", `${prompt.trim()}\n\nCurrent page context (descriptive, not authorization): ${JSON.stringify(context)}`);
  return `/studio${params.size ? `?${params}` : ""}`;
}
