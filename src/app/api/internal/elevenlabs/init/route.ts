/**
 * ElevenLabs Conversation Initiation Webhook
 *
 * Fires when a phone call (or web conversation) starts. ElevenLabs sends
 * the caller's phone number; we resolve it to a user via Supabase, build
 * full LittUserContext, and return dynamic_variables that get injected
 * into the system prompt and all subsequent tool calls.
 *
 * Critical: ElevenLabs does NOT pass caller_id to tool calls. So we
 * resolve the caller HERE and inject user_id + project_id as dynamic
 * variables that flow into every tool call via {{user_id}} / {{project_id}}.
 *
 * Auth: Bearer token in Authorization header (ElevenLabs style) OR
 * x-internal-api-key header (our standard). Must match INTERNAL_API_KEY.
 *
 * Request (ElevenLabs sends):
 *   {
 *     "conversation_id": "conv_...",
 *     "agent_id": "agent_...",
 *     "caller_id": "+1234567890",  // or system__caller_id
 *     ...
 *   }
 *
 * Response (we return):
 *   {
 *     "conversation_initiation_client_data": {
 *       "dynamic_variables": {
 *         "user_id": "clerk_xxx",
 *         "project_id": "proj_xxx",
 *         "user_name": "LiTree",
 *         "user_context": "compressed context summary..."
 *       },
 *       "conversation_config_override": {
 *         "agent": {
 *           "first_message": "Hey LiTree, LiTT here — what can I help with?"
 *         }
 *       }
 *     }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { buildUserContext, formatContextForPrompt } from "@/lib/context/context-engine";
import { listProjects } from "@/lib/projects/project-repository";
import { getConfig, listServices, formatServiceForOutput } from "@/lib/myaios/myaios-brain";

export const runtime = "nodejs";

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;

  // Check x-internal-api-key header (our standard)
  const internalKey = req.headers.get("x-internal-api-key");
  if (internalKey && safeSecretEqual(internalKey, expected)) return true;

  // Check Authorization: Bearer <key> (ElevenLabs style)
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (safeSecretEqual(token, expected)) return true;
  }

  return false;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

/** Extract the caller's phone number from ElevenLabs' request payload. */
function extractCallerId(body: Record<string, unknown>): string | null {
  // ElevenLabs may send the caller ID in various fields depending on the
  // telephony provider and webhook configuration.
  const candidates = [
    body.caller_id,
    body.system__caller_id,
    body.callerId,
    body.From,
    body.from,
    body.phone,
    (body.metadata as Record<string, unknown>)?.caller_id,
    (body.metadata as Record<string, unknown>)?.from,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return normalizePhone(c);
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const callerId = extractCallerId(body);
  const conversationId = (body.conversation_id as string) || "";

  console.log(`[elevenlabs-init] Conversation ${conversationId} started, caller: ${callerId || "unknown"}`);

  // If no caller ID, return empty context — LiTT will work as a generic assistant
  if (!callerId) {
    return NextResponse.json({
      conversation_initiation_client_data: {
        dynamic_variables: {
          user_id: "",
          project_id: "",
          user_name: "",
          user_context: "",
        },
      },
    });
  }

  // Step 1: Look up user by phone in Supabase
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("clerk_id, display_name, email")
    .eq("phone", callerId)
    .single();

  if (userError || !user?.clerk_id) {
    console.log(`[elevenlabs-init] No user found for phone ${callerId}`);
    return NextResponse.json({
      conversation_initiation_client_data: {
        dynamic_variables: {
          user_id: "",
          project_id: "",
          user_name: "",
          user_context: "",
        },
      },
    });
  }

  const userId = user.clerk_id;
  const displayName = user.display_name || "";

  // Step 2: Get their most recent project
  let projectId = "";
  let projectName = "";
  try {
    const projects = await listProjects(userId);
    const proj = projects.projects[0] ?? projects.legacyOnly[0] ?? null;
    if (proj) {
      projectId = proj.id;
      projectName = proj.name;
    }
  } catch {
    // Non-fatal
  }

  // Step 3: Build full LittUserContext via the Context Engine
  let contextBlock = "";
  try {
    const ctx = await buildUserContext({
      userId,
      headers: new Headers(),
      project: projectId
        ? await resolveProjectForContext(userId, projectId)
        : undefined,
      activeAgent: {
        slug: "litt",
        mode: "voice",
        instanceId: null,
      },
      conversation: null,
    });
    contextBlock = formatContextForPrompt(ctx);
  } catch (err) {
    console.error("[elevenlabs-init] Context build failed:", err);
  }

  // Step 4: Load Myaios config + service catalog
  // This gives LiTT the business context it needs to answer questions
  // about services, pricing, and bookings during the call
  let myaiosContext = "";
  myaiosContext += `\n\nTRUTHFUL EXECUTION RULES:\n`;
  myaiosContext += `- Never say an action is done, saved, booked, changed, fixed, tested, published, or deployed unless a tool returned a concrete success result during this conversation.\n`;
  myaiosContext += `- A promise, plan, memory, or project fact is not proof that an action ran.\n`;
  myaiosContext += `- If a tool returns an error, missing field, failed result, or no result, state that clearly and do not imply success.\n`;
  myaiosContext += `- After successful mutations, repeat the returned evidence such as booking ID, lead ID, escalation ID, record name, date/time, or status.\n`;
  myaiosContext += `- Project knowledge tools are read-only. They do not edit code, publish GitHub changes, or deploy. Say so when asked.\n`;
  try {
    const [config, services] = await Promise.all([
      getConfig(userId),
      listServices(userId, true),
    ]);

    if (config) {
      myaiosContext += `\n\nMYAIOS CONTEXT:\n`;
      myaiosContext += `Business: ${config.businessName} — ${config.businessDescription}\n`;
      myaiosContext += `Myaios 24/7: ${config.myaios247}\n`;
      myaiosContext += `Cancellation policy: ${config.cancellationPolicy}\n`;
      if (config.bookingPageSlug) {
        myaiosContext += `Booking page: https://app.myaios.ai/smb-public/book/${config.bookingPageSlug}\n`;
      }
    }

    if (services.length > 0) {
      myaiosContext += `\nACTIVE SERVICES (use these for pricing and booking):\n`;
      myaiosContext += services.map((s) => formatServiceForOutput(s)).join("\n");
      myaiosContext += `\n\nWhen a caller wants to book, use the myaios tool with operation "get_available_slots" to find times, then "create_booking" to book.`;
    }
  } catch (err) {
    console.error("[elevenlabs-init] Myaios context failed:", err);
  }

  // Step 4b: Load project knowledge so LiTT can answer questions about
  // the caller's actual project — tech stack, architecture, dependencies,
  // known issues, and capabilities. This is what makes MyAios "read" the
  // project instead of just knowing business config.
  if (projectId) {
    try {
      const { KnowledgeService } = await import("@/lib/litt-intelligence/knowledge-service");
      const ks = new KnowledgeService();
      const records = await ks.search(userId, projectId, {
        verificationStatus: "verified",
        limit: 30,
      });

      if (records.length > 0) {
        myaiosContext += `\n\nPROJECT KNOWLEDGE (${records.length} facts):\n`;
        // Group by category for readability
        const byCategory = new Map<string, string[]>();
        for (const r of records) {
          const arr = byCategory.get(r.category) ?? [];
          arr.push(r.content);
          byCategory.set(r.category, arr);
        }
        for (const [category, items] of byCategory) {
          myaiosContext += `\n${category.toUpperCase().replace(/_/g, " ")}:\n`;
          myaiosContext += items.map((c) => `  - ${c}`).join("\n");
        }
        myaiosContext += `\n\nUse the myaios tool with operation "search_project_knowledge" to find specific facts about the project.`;
      }
    } catch (err) {
      console.error("[elevenlabs-init] Project knowledge failed:", err);
    }
  }

  // Step 4c: Inject project metadata (framework, repo, branch) so LiTT
  // knows what the caller is working on even without knowledge records
  if (projectId) {
    try {
      const { getProject } = await import("@/lib/projects/project-repository");
      const project = await getProject(projectId, userId);
      if (project) {
        myaiosContext += `\n\nPROJECT METADATA:\n`;
        myaiosContext += `Name: ${project.name}\n`;
        if (project.githubFullName) myaiosContext += `Repository: ${project.githubFullName}\n`;
        if (project.githubBranch) myaiosContext += `Branch: ${project.githubBranch}\n`;
        if (project.framework) myaiosContext += `Framework: ${project.framework}\n`;
        if (project.packageManager) myaiosContext += `Package manager: ${project.packageManager}\n`;
        if (project.buildCommand) myaiosContext += `Build: ${project.buildCommand}\n`;
        myaiosContext += `Workspace: ${project.workspaceStatus}\n`;
      }
    } catch {
      // Non-fatal
    }
  }

  // Step 5: Build the first message (personalized greeting)
  const firstName = displayName.split(" ")[0] || "";
  const firstMessage = firstName
    ? `Hey ${firstName}, LiTT here — what can I help with?`
    : "Hey, LiTT here — what can I help with?";

  console.log(`[elevenlabs-init] Resolved: ${displayName || "unknown"}, project: ${projectName || "none"}, myaios: ${myaiosContext ? "loaded" : "none"}`);

  // Step 6: Return dynamic variables + first message override
  // These flow into:
  //   - The system prompt via {{user_name}}, {{user_context}}, {{myaios_context}}
  //   - Tool calls via {{user_id}}, {{project_id}}
  return NextResponse.json({
    conversation_initiation_client_data: {
      dynamic_variables: {
        user_id: userId,
        project_id: projectId,
        user_name: firstName,
        user_context: contextBlock,
        myaios_context: myaiosContext,
      },
      conversation_config_override: {
        agent: {
          first_message: firstMessage,
        },
      },
    },
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
