/**
 * LiTT Context Engine
 *
 * Philosophy: "LiTT already knows."
 * This is the central aggregator that builds a complete picture of the user
 * at this moment — identity, location, preferences, project, workspace, memory.
 *
 * The output is a compressed JSON object injected into the LLM's system prompt
 * so LiTT can personalize responses without ever asking the user for context
 * the system already has.
 *
 * Performance:
 *   - Designed to be fast (<100ms with Vercel geo)
 *   - Location resolution is non-blocking with a 150ms timeout
 *   - If any component fails, it degrades gracefully (omits that data)
 */

import "server-only";
import {
  type LittUserContext,
  type UserPreferences,
  type CurrentProject,
  type CurrentWorkspace,
  type CurrentFile,
  type CurrentAsset,
  type ContextMemory,
  type ActiveAgent,
  type ActiveTask,
  type ConversationContext,
  type RecentContext,
} from "./types";
import { resolveUserLocation } from "./location-resolver";
import { getUserPreferences, getCapabilityStatus } from "@/lib/connectors/connector-repository";
import type { CapabilityId } from "@/lib/connectors/provider-registry";

// ─── Helpers ────────────────────────────────────────────────────

async function fetchUserProfile(
  userId: string,
): Promise<{ displayName: string | null; email: string | null }> {
  try {
    const { getAdminSupabase } = await import("@/lib/supabase-admin");
    const admin = getAdminSupabase();
    const { data } = await admin
      .from("users")
      .select("name, email")
      .eq("clerk_id", userId)
      .maybeSingle();
    if (!data) return { displayName: null, email: null };
    return {
      displayName: (data as { name?: string | null }).name ?? null,
      email: (data as { email?: string | null }).email ?? null,
    };
  } catch {
    return { displayName: null, email: null };
  }
}

async function fetchPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const prefs = await getUserPreferences(userId);
    if (!prefs) return null;
    return {
      theme: null,
      language: prefs.locale,
      units: prefs.distance_unit,
      temperatureUnit: prefs.temperature_unit,
      timezone: prefs.timezone,
      newsInterests: prefs.news_interests ?? [],
      dailyBriefingEnabled: prefs.daily_briefing_enabled,
      dailyBriefingTime: prefs.daily_briefing_time,
    };
  } catch {
    return null;
  }
}

async function fetchCapabilities(
  userId: string,
): Promise<Record<string, string>> {
  try {
    const caps: CapabilityId[] = [
      "weather.current",
      "weather.hourly",
      "weather.daily",
      "weather.geocode",
      "web.search",
      "news.search",
      "profile.read",
      "preferences.read",
      "preferences.update",
      "location.read",
      "location.update",
    ];
    const results: Record<string, string> = {};
    await Promise.all(
      caps.map(async (cap) => {
        const status = await getCapabilityStatus(userId, cap);
        if (status) results[cap] = status;
      }),
    );
    return results;
  } catch {
    return {};
  }
}

// ─── Timeout wrapper ────────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
    return result;
  } catch {
    return fallback;
  }
}

// ─── Main Engine ────────────────────────────────────────────────

export interface BuildContextOptions {
  userId: string;
  headers: Headers;
  /** Optional Upstash Redis client for IP location caching */
  redis?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, opts?: { ex?: number }) => Promise<void>;
  };
  /** Current project context (from the chat route's buildStudioContext) */
  project?: {
    id: string;
    name: string;
    repositoryConnected: boolean;
    repositoryName: string | null;
    activeBranch: string | null;
  } | null;
  /** Current workspace state (mode, selected node) */
  workspace?: CurrentWorkspace | null;
  /** Currently open file */
  currentFile?: CurrentFile | null;
  /** Currently selected asset */
  currentAsset?: CurrentAsset | null;
  /** Recent context (open files, active assets) */
  recentContext?: RecentContext | null;
  /** User and project memory */
  memory?: ContextMemory | null;
  /** Active agent (slug, mode, instance ID) */
  activeAgent?: ActiveAgent | null;
  /** Active task if one is running */
  activeTask?: ActiveTask | null;
  /** Current conversation context */
  conversation?: ConversationContext | null;
  /** Timeout for location resolution (default 150ms) */
  locationTimeoutMs?: number;
}

/**
 * Build the complete LiTT user context.
 *
 * This aggregates:
 *   - Identity (name, email)
 *   - Location (via LocationResolver — Vercel geo, manual, cached)
 *   - Preferences (units, timezone, language, news interests)
 *   - Current project (name, repo, branch)
 *   - Current workspace (mode, selection)
 *   - Recent context (files, assets, conversations)
 *   - Capabilities (tool permissions)
 *
 * Every component degrades gracefully — if one fails, the rest still work.
 * Location resolution has a strict timeout to never block the chat stream.
 */
export async function buildUserContext(
  options: BuildContextOptions,
): Promise<LittUserContext> {
  const { userId, headers, redis, project, workspace, currentFile, currentAsset, recentContext, memory, activeAgent, activeTask, conversation, locationTimeoutMs = 150 } = options;

  // Run identity, preferences, and capabilities in parallel
  const [profile, preferences, capabilities] = await Promise.all([
    fetchUserProfile(userId),
    fetchPreferences(userId),
    fetchCapabilities(userId),
  ]);

  // Location resolution with timeout — never block the chat stream
  const location = await withTimeout(
    resolveUserLocation({ userId, headers, redis }),
    locationTimeoutMs,
    null,
  );

  const currentProject: CurrentProject | null = project
    ? {
        id: project.id,
        name: project.name,
        repositoryConnected: project.repositoryConnected,
        repositoryName: project.repositoryName,
        activeBranch: project.activeBranch,
      }
    : null;

  return {
    userId,
    displayName: profile.displayName,
    email: profile.email,
    location: location ?? {
      city: null,
      region: null,
      country: null,
      latitude: null,
      longitude: null,
      timezone: preferences?.timezone ?? null,
      source: "none" as const,
      confidence: "low" as const,
      updatedAt: new Date().toISOString(),
    },
    preferences: preferences ?? {
      theme: null,
      language: null,
      units: "imperial" as const,
      temperatureUnit: "fahrenheit" as const,
      timezone: null,
      newsInterests: [],
      dailyBriefingEnabled: false,
      dailyBriefingTime: null,
    },
    currentProject,
    currentWorkspace: workspace ?? null,
    currentFile: currentFile ?? null,
    currentAsset: currentAsset ?? null,
    activeAgent: activeAgent ?? null,
    activeTask: activeTask ?? null,
    conversation: conversation ?? null,
    recentContext: recentContext ?? null,
    memory: memory ?? null,
    capabilities,
    fetchedAt: Date.now(),
  };
}

// ─── Prompt Formatting ──────────────────────────────────────────

/**
 * Format the LittUserContext into a compressed XML block for the system prompt.
 * This is injected silently — the user never sees it, but LiTT uses it to
 * personalize responses.
 *
 * Format: <user_context>{...compressed JSON...}</user_context>
 */
export function formatContextForPrompt(ctx: LittUserContext): string {
  const compressed: Record<string, unknown> = {
    user: {
      id: ctx.userId,
      name: ctx.displayName,
      email: ctx.email,
    },
    location: ctx.location.city
      ? {
          city: ctx.location.city,
          region: ctx.location.region,
          country: ctx.location.country,
          timezone: ctx.location.timezone,
          lat: ctx.location.latitude,
          lon: ctx.location.longitude,
          source: ctx.location.source,
          confidence: ctx.location.confidence,
        }
      : null,
    preferences: {
      units: ctx.preferences.units,
      temperature: ctx.preferences.temperatureUnit,
      timezone: ctx.preferences.timezone,
      language: ctx.preferences.language,
      newsInterests: ctx.preferences.newsInterests.length > 0
        ? ctx.preferences.newsInterests
        : undefined,
    },
    project: ctx.currentProject
      ? {
          id: ctx.currentProject.id,
          name: ctx.currentProject.name,
          repo: ctx.currentProject.repositoryConnected
            ? ctx.currentProject.repositoryName
            : null,
          branch: ctx.currentProject.activeBranch,
        }
      : null,
    workspace: ctx.currentWorkspace
      ? {
          mode: ctx.currentWorkspace.mode,
          selectedNode: ctx.currentWorkspace.selectedNode,
        }
      : null,
    currentFile: ctx.currentFile
      ? {
          path: ctx.currentFile.path,
          language: ctx.currentFile.language,
        }
      : null,
    currentAsset: ctx.currentAsset
      ? {
          id: ctx.currentAsset.id,
          name: ctx.currentAsset.name,
          type: ctx.currentAsset.type,
        }
      : null,
    activeAgent: ctx.activeAgent
      ? {
          slug: ctx.activeAgent.slug,
          mode: ctx.activeAgent.mode,
        }
      : null,
    activeTask: ctx.activeTask
      ? {
          id: ctx.activeTask.id,
          description: ctx.activeTask.description,
        }
      : null,
    conversation: ctx.conversation
      ? {
          id: ctx.conversation.id,
          title: ctx.conversation.title,
        }
      : null,
    recent: ctx.recentContext
      ? {
          files: ctx.recentContext.openFiles.length > 0
            ? ctx.recentContext.openFiles.slice(0, 5)
            : undefined,
          assets: ctx.recentContext.activeAssets.length > 0
            ? ctx.recentContext.activeAssets.slice(0, 5)
            : undefined,
        }
      : null,
    capabilities: Object.keys(ctx.capabilities).length > 0
      ? ctx.capabilities
      : undefined,
  };

  // Remove null/undefined values for compactness
  const clean = JSON.parse(JSON.stringify(compressed, (_, v) =>
    v === null || v === undefined ? undefined : v
  ));

  return `<user_context>${JSON.stringify(clean)}</user_context>`;
}

/**
 * Build a human-readable context block (alternative to XML format).
 * Useful for debugging or when the LLM needs more explicit context.
 */
export function buildContextBlock(ctx: LittUserContext): string {
  const lines: string[] = [
    "USER CONTEXT (use this to personalize responses — LiTT already knows):",
  ];

  if (ctx.displayName) lines.push(`  Name: ${ctx.displayName}`);
  if (ctx.email) lines.push(`  Email: ${ctx.email}`);

  if (ctx.location.city) {
    const locStr = `${ctx.location.city}${ctx.location.region ? `, ${ctx.location.region}` : ""}${ctx.location.country ? `, ${ctx.location.country}` : ""}`;
    const sourceTag = ctx.location.source === "manual" ? " (your saved location)" : ctx.location.source === "vercel" ? " (auto-detected)" : "";
    lines.push(`  Location: ${locStr}${sourceTag}`);
  }
  if (ctx.location.timezone) lines.push(`  Timezone: ${ctx.location.timezone}`);
  if (ctx.preferences.temperatureUnit) lines.push(`  Temperature unit: ${ctx.preferences.temperatureUnit}`);
  if (ctx.preferences.language) lines.push(`  Language: ${ctx.preferences.language}`);
  if (ctx.preferences.newsInterests.length > 0) {
    lines.push(`  News interests: ${ctx.preferences.newsInterests.join(", ")}`);
  }

  if (ctx.currentProject) {
    lines.push(`  Project: ${ctx.currentProject.name}`);
    if (ctx.currentProject.repositoryConnected) {
      lines.push(`  Repository: ${ctx.currentProject.repositoryName} (${ctx.currentProject.activeBranch ?? "main"})`);
    }
  }

  if (ctx.currentWorkspace) {
    lines.push(`  Workspace mode: ${ctx.currentWorkspace.mode}`);
    if (ctx.currentWorkspace.selectedNode) {
      lines.push(`  Selected: ${ctx.currentWorkspace.selectedNode}`);
    }
  }

  if (ctx.currentFile) {
    lines.push(`  Current file: ${ctx.currentFile.path}`);
  }

  if (ctx.currentAsset) {
    lines.push(`  Current asset: ${ctx.currentAsset.name}`);
  }

  if (ctx.activeAgent) {
    lines.push(`  Active agent: ${ctx.activeAgent.slug} (${ctx.activeAgent.mode})`);
  }

  if (ctx.activeTask) {
    lines.push(`  Active task: ${ctx.activeTask.description}`);
  }

  if (ctx.conversation?.title) {
    lines.push(`  Conversation: ${ctx.conversation.title}`);
  }

  if (ctx.memory?.user?.length) {
    lines.push(`  User memories: ${ctx.memory.user.length} entries`);
  }
  if (ctx.memory?.project?.length) {
    lines.push(`  Project memories: ${ctx.memory.project.length} entries`);
  }

  if (ctx.recentContext?.openFiles.length) {
    lines.push(`  Open files: ${ctx.recentContext.openFiles.slice(0, 3).join(", ")}`);
  }

  if (lines.length === 1) return "";

  lines.push("");
  lines.push("RULES:");
  lines.push("- Use the user's name naturally, not every sentence.");
  lines.push("- Use their location for weather, local recommendations, and time references.");
  lines.push("- If location is auto-detected, use it confidently — don't say 'I think you're in...'");
  lines.push("- If no location is available and they ask about weather, ask what city they're in — naturally, not like an error.");
  lines.push("- Honor their temperature unit and language preferences.");
  lines.push("- Remember what they share — preferences should grow over time.");
  lines.push("- If the user says 'make this purple' or 'deploy this', use the current file/asset/project context to know what 'this' means.");

  return lines.join("\n");
}

// ─── Re-exports ─────────────────────────────────────────────────

export { getClientIp, confirmUserLocation } from "./location-resolver";
export { buildLocationContextBlock } from "./location-resolver";
export type { LocationResolution, LocationSource, LocationConfidence, CurrentFile, CurrentAsset, ContextMemory, ActiveAgent, ActiveTask, ConversationContext } from "./types";
