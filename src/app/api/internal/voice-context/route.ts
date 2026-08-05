/**
 * Internal API: Voice Context Lookup
 *
 * Called by the LiTT Voice Bridge to resolve a phone number (Twilio Caller ID)
 * to a full LittUserContext. This is the bridge between "someone is calling"
 * and "LiTT knows who they are, what they're working on, and their preferences."
 *
 * Auth: X-Internal-Api-Key header (matches INTERNAL_API_KEY env var).
 * This is a server-to-server endpoint — never exposed to the browser.
 *
 * Flow:
 *   1. Look up user by phone in Supabase → get clerk_id
 *   2. Get their most recent project
 *   3. Recall recent memories (user preferences + project facts)
 *   4. Build full LittUserContext via the Context Engine
 *   5. Return formatted context string + userId + projectId for tool calls
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { buildUserContext, formatContextForPrompt } from "@/lib/context/context-engine";
import { recallMemories } from "@/lib/studio/memory-service";
import { listProjects } from "@/lib/projects/project-repository";

export const runtime = "nodejs";

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const key = req.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_API_KEY;
  if (!key || !expected) return false;
  return safeSecretEqual(key, expected);
}

/** Normalize a phone number to E.164-ish format for matching. */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.phone !== "string") {
    return NextResponse.json({ error: "Missing 'phone' field" }, { status: 400 });
  }

  const phone = normalizePhone(body.phone);
  const query = typeof body.query === "string" ? body.query : "";

  // Step 1: Look up user by phone
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("clerk_id, display_name, email")
    .eq("phone", phone)
    .single();

  if (userError || !user?.clerk_id) {
    // User not found — return a minimal context so LiTT can still answer
    return NextResponse.json({
      found: false,
      userId: null,
      projectId: null,
      contextBlock: "",
      message: "User not found for this phone number. LiTT will answer as a generic assistant.",
    });
  }

  const userId = user.clerk_id;

  // Step 2: Get their most recent project
  let projectId: string | null = null;
  try {
    const projects = await listProjects(userId);
    projectId = projects.projects[0]?.id ?? projects.legacyOnly[0]?.id ?? null;
  } catch {
    // No project — that's fine, LiTT can still answer general questions
  }

  // Step 3: Recall memories (if we have a project + query)
  let memories: unknown[] = [];
  if (projectId && query) {
    try {
      memories = await recallMemories(query, userId, projectId, {
        agentSlug: "litt",
        agentMode: "standard",
        limit: 5,
      });
    } catch {
      // Memory recall failed — non-fatal
    }
  }

  // Step 4: Build full LittUserContext via the Context Engine
  const ctx = await buildUserContext({
    userId,
    headers: new Headers(),
    project: projectId
      ? await resolveProjectForContext(userId, projectId)
      : undefined,
    memory: {
      user: memories,
      project: memories,
    },
    activeAgent: {
      slug: "litt",
      mode: "voice",
      instanceId: null,
    },
    conversation: null,
  });

  // Step 5: Format for the OpenAI Realtime session instructions
  const contextBlock = formatContextForPrompt(ctx);

  return NextResponse.json({
    found: true,
    userId,
    projectId,
    displayName: user.display_name ?? null,
    contextBlock,
    memoryCount: memories.length,
  });
}

/** Resolve a project to the minimal shape buildUserContext expects. */
async function resolveProjectForContext(
  userId: string,
  projectId: string,
): Promise<{
  id: string;
  name: string;
  repositoryConnected: boolean;
  repositoryName: string | null;
  activeBranch: string | null;
}> {
  try {
    const { getProject } = await import("@/lib/projects/project-repository");
    const project = await getProject(projectId, userId);
    if (project) {
      return {
        id: project.id,
        name: project.name,
        repositoryConnected: Boolean(project.githubFullName),
        repositoryName: project.githubFullName ?? null,
        activeBranch: project.githubBranch ?? project.githubDefaultBranch ?? null,
      };
    }
  } catch {
    // Non-fatal
  }
  return {
    id: projectId,
    name: "Unknown",
    repositoryConnected: false,
    repositoryName: null,
    activeBranch: null,
  };
}
