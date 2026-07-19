import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator, type ProjectContext } from "@/lib/agents";
import { generateText } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { PROJECT_CONTEXT } from "@/lib/project-context-server";
import { Supermemory } from "supermemory";
import { sanitizeProviderError } from "@/lib/provider-error";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("Service unavailable");
  return new Supermemory({ apiKey: key });
}

function hasSupermemory() {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

async function recallMemories(
  userId: string,
  query: string,
  limit: number = 5,
) {
  try {
    if (hasSupermemory()) {
      try {
        const results = (await getSupermemory().search.memories({
          q: query,
          containerTag: `${userId}:conversation`,
          limit,
        })) as {
          memories?: { metadata?: { supabaseMemoryId?: string }; content?: string }[];
          results?: { metadata?: { supabaseMemoryId?: string }; content?: string }[];
        };
        const hits = results.memories || results.results || [];
        const ids = hits
          .map((h) => h.metadata?.supabaseMemoryId)
          .filter(Boolean) as string[];
        if (ids.length) {
          const { data } = await supabaseAdmin
            .from("memories")
            .select("*")
            .in("id", ids)
            .eq("owner_id", userId)
            .limit(limit);
          if (data?.length) return data;
        }
      } catch (err) {
        console.error("Supermemory recall failed:", err);
      }
    }
    const { data } = await supabaseAdmin
      .from("memories")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch (err) {
    console.error("recallMemories failed:", err);
    return [];
  }
}

async function persistMemory(
  userId: string,
  content: string,
  options: { agentId?: string; scope?: string; source?: string; reason?: string } = {},
) {
  try {
    const scope = options.scope || "conversation";
    const source = options.source || "agent-chat";
    const containerTag = scope ? `${userId}:${scope}` : userId;

    const { data: record, error: insertError } = await supabaseAdmin
      .from("memories")
      .insert({
        owner_id: userId,
        agent_id: options.agentId || null,
        content,
        scope,
        source,
        reason: options.reason || null,
        sync_status: "pending",
      })
      .select()
      .single();

    if (insertError || !record) {
      console.error("Supabase memory insert failed:", insertError);
      return null;
    }

    let supermemoryId: string | null = null;
    if (hasSupermemory()) {
      try {
        const metadata: Record<string, string | number | boolean | string[]> = {
          ownerId: userId,
          scope,
          source,
          supabaseMemoryId: record.id,
        };
        if (options.agentId) metadata.agentId = options.agentId;
        const result = (await getSupermemory().add({
          content,
          containerTag,
          metadata,
        })) as { id?: string; memoryId?: string; memory_id?: string; externalId?: string };
        supermemoryId = result.id || result.memoryId || result.memory_id || result.externalId || null;
      } catch (err) {
        console.error("Supermemory index failed:", err);
      }
    }

    await supabaseAdmin
      .from("memories")
      .update({
        supermemory_id: supermemoryId,
        sync_status: supermemoryId ? "synced" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    return record.id;
  } catch (err) {
    console.error("persistMemory failed:", err);
    return null;
  }
}

function buildDirectorPrompt(userName: string): string {
  const name = userName || "the user";
  return `You are LiTT Director — ${name}'s personal AI crew chief inside LiTTree LabStudios.

=== PROJECT CONTEXT (repo files, docs, schema) ===
${PROJECT_CONTEXT}

Personality: sharp, confident, concise, occasionally sardonic. You address ${name} by their name (${name}). You do not over-explain.

Job: understand ${name}'s intent, plan the work, delegate to specialist agents when useful, and present results clearly. Always explain what you did in plain terms before showing artifacts or code.

STUDIO TERMINAL (you have this RIGHT NOW):
- Studio has a real embedded terminal connected to an authenticated PTY.
- You CAN run builds, lint, tests, and shell commands directly from Studio.
- When the user asks to build/run/lint/test, tell them to type it in Studio:
  \`$ pnpm build\`, \`/run pnpm lint\`, or just say "run the build" — Studio
  detects the intent and runs it in the terminal automatically.
- NEVER say "I can't execute build commands" or "I can't run commands from
  this environment." You CAN — through the Studio terminal.

IMAGE GENERATION (you have this RIGHT NOW):
- You can generate images via the built-in media pipeline. Pollinations (Flux) is the default provider — free, no API key required, always available. Other providers: Gemini Imagen 3, FAL.ai, Together.ai, OpenAI DALL-E 3, Recraft.
- When the user asks for ANY image (logo, artwork, photo, illustration, icon, etc.), DO NOT ask for a description. Infer the prompt from the project context, file names, and the conversation. If nothing specific is implied, generate a sensible default for the project (logo, hero shot, icon, etc.).
- The system detects image intent and generates the image for you. You will see the resulting URL embedded in your reply. Just write a short, punchy caption that names the prompt you used and confirms the image is ready (1-2 sentences). The system already produces the image — your job is the caption, NOT to ask questions or refuse.
- Never dump base64, raw URLs, or internal provider details in conversation.
- Never say "I can't generate images" — you CAN, via the pipeline above.

If a request requires approval or is ambiguous, ask one clear question. Prefer action over endless planning.`;
}

/* ------------------------------------------------------------------ */
/*  Image intent detection + generation (server-side)                  */
/* ------------------------------------------------------------------ */

const IMAGE_INTENT_KEYWORDS = [
  "image of",
  "picture of",
  "draw a",
  "draw an",
  "draw me",
  "render an image",
  "generate an image",
  "generate a picture",
  "generate a logo",
  "generate a photo",
  "make a logo",
  "make an image",
  "make a picture",
  "make me a logo",
  "make me an image",
  "make me a picture",
  "create a logo",
  "create an image",
  "create a picture",
  "create an illustration",
  "create me a logo",
  "create me an image",
  "logo for",
  "icon for",
  "photo of",
  "illustration of",
  "artwork of",
  "painting of",
  "sketch of",
  "design a logo",
  "design an icon",
];

const IMAGE_INTENT_VERBS = [
  "generate ",
  "create ",
  "make ",
  "draw ",
  "render ",
  "design ",
  "produce ",
  "build ",
  "give me ",
];

const IMAGE_INTENT_NOUNS = [
  "image",
  "picture",
  "photo",
  "illustration",
  "artwork",
  "painting",
  "sketch",
  "logo",
  "icon",
  "avatar",
  "banner",
  "poster",
  "thumbnail",
  "graphic",
  "visual",
  "wallpaper",
  "portrait",
];

function detectImageIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (IMAGE_INTENT_KEYWORDS.some((k) => t.includes(k))) return true;
  const hasVerb = IMAGE_INTENT_VERBS.some((v) => t.includes(v));
  const hasNoun = IMAGE_INTENT_NOUNS.some((n) => t.includes(n));
  return hasVerb && hasNoun;
}

function inferImagePrompt(userMessage: string): string {
  const cleaned = userMessage
    .trim()
    .replace(/^(can you|could you|please|i need|i want|please make|please create|please generate)\s+/i, "")
    .replace(/^(an?|the|me|my|us|for)\s+/i, "")
    .replace(/\b(image|picture|photo|illustration|artwork|painting|sketch|graphic|visual|wallpaper|logo|icon|avatar|banner|poster|thumbnail)\b/gi, "")
    .replace(/\b(of|for|with|that|which|who|where)\b/gi, " ")
    .replace(/[^a-zA-Z0-9,.\-'"!?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const subject = cleaned || "minimal modern logo for a creative AI studio";
  return `${subject} — studio-quality, sharp focus, cinematic lighting, clean composition, no text overlay unless requested`;
}

function buildImageUrl(prompt: string): { url: string; provider: string } {
  const seed = Math.abs(
    prompt.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0),
  ) % 1_000_000;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=false&model=flux`;
  return { url, provider: "pollinations" };
}

type ImageResult = {
  imageUrl: string;
  imagePrompt: string;
  imageProvider: string;
};

/**
 * Detect image-generation intent and pre-compute the image URL so we can
 * embed it in the response. Returns null if no image intent is detected.
 */
function maybeGenerateImage(userMessage: string): ImageResult | null {
  if (!detectImageIntent(userMessage)) return null;
  const prompt = inferImagePrompt(userMessage);
  const { url, provider } = buildImageUrl(prompt);
  return { imageUrl: url, imagePrompt: prompt, imageProvider: provider };
}

/**
 * Wrap a Director caption around an image result. The LLM is asked to be
 * brief and confirm the image; we fall back to a hard-coded caption if the
 * LLM call fails.
 */
async function composeImageCaption(
  userMessage: string,
  image: ImageResult,
  basePrompt: string,
  memoryContext: string,
): Promise<string> {
  const captionPrompt = `${basePrompt}

The user said: "${userMessage}"
You just generated an image with this prompt: "${image.imagePrompt}"
Provider: ${image.imageProvider}

Write a 1-2 sentence caption in LiTT Director's voice. Name the prompt you used and confirm the image is ready. No markdown headers, no bullets. Just the caption.`;

  try {
    const r = await generateText(
      `${captionPrompt}\n\n${memoryContext}USER: ${userMessage}\n\nRespond as LiTT Director. Be direct and useful.`,
      { task: "chat" },
    );
    const text = (r.text || "").trim();
    if (text) return text;
  } catch {
    // fall through to hard-coded caption
  }
  return `Image ready. Prompt: "${image.imagePrompt}". Tap the image to download or regenerate.`;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    // Resolve legacy or drawer IDs to the canonical director agent
    const resolvedId =
      agentId === "litt-director" || agentId === "director" || !agentId
        ? "director"
        : agentId;

    // Fetch the user's profile name so the agent can address them personally
    const userProfile = await getUserByClerkId(userId);
    const userName = userProfile?.name || "";
    const directorPrompt = buildDirectorPrompt(userName);

    const projectContext: ProjectContext = {
      name: "LiTTree LabStudios",
      description: "litlabs.net / LiTTree LabStudios multi-agent creative workspace",
      stack: "Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + Turbopack",
      repoUrl: "https://github.com/LabsConnected/litlabs-website",
      customInstructions: PROJECT_CONTEXT,
    };

    const agent = orchestrator.getAgent(resolvedId);
    const recalled = await recallMemories(userId, message, 5);
    const memoryContext = recalled.length
      ? `RELEVANT MEMORY:\n${recalled.map((m) => `- ${m.content}`).join("\n")}\n`
      : "";

    // ----------------------------------------------------------------
    // Image intent short-circuit: if the user asked for an image, we
    // generate it ourselves (Pollinations Flux, free, no key) and
    // ask the LLM only for a short Director-style caption. This avoids
    // the agent refusing with "I can't generate images" because the
    // image is generated server-side, not by the LLM.
    // ----------------------------------------------------------------
    const image = maybeGenerateImage(message);
    if (image && (resolvedId === "director" || !agent)) {
      const caption = await composeImageCaption(
        message,
        image,
        directorPrompt,
        memoryContext,
      );
      void persistMemory(userId, `User said: ${message}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-image",
        reason: "user chat (image intent)",
      });
      void persistMemory(userId, `I replied: ${caption}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-image",
        reason: "director image reply",
      });
      if (!agent) {
        return NextResponse.json({
          agent: { id: "director", name: "LiTT Director", role: "Director" },
          response: caption,
          userName,
          imageUrl: image.imageUrl,
          imagePrompt: image.imagePrompt,
          imageProvider: image.imageProvider,
        });
      }
      // fall through to the agent path below — we still pass imageUrl along
    }

    if (!agent && resolvedId === "director") {
      // Fallback: create a minimal director agent if not initialized
      const r = await generateText(
        `${directorPrompt}\n\n${memoryContext}USER: ${message}\n\nRespond as LiTT Director. Be direct and useful.`,
        { task: "chat" },
      );
      const response = r.text || "I'm on it.";
      // Persist the fallback chat turn as well.
      void persistMemory(userId, `User said: ${message}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-fallback",
        reason: "user chat",
      });
      void persistMemory(userId, `I replied: ${response}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-fallback",
        reason: "director reply",
      });
      return NextResponse.json({
        agent: { id: "director", name: "LiTT Director", role: "Director" },
        response,
        userName,
        ...(image
          ? {
              imageUrl: image.imageUrl,
              imagePrompt: image.imagePrompt,
              imageProvider: image.imageProvider,
            }
          : {}),
      });
    }
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
    }

    orchestrator.addToMemory(resolvedId, `User said: ${message}`);
    let response = await orchestrator.simulateAgentResponse(
      resolvedId,
      message,
      memoryContext,
      projectContext,
    );

    // If image intent was detected, prepend the caption + ensure the agent
    // didn't just refuse. If the agent refused or asked for a description,
    // override with our caption so the user actually gets the image.
    if (image) {
      const looksLikeRefusal = /\b(can't|cannot|unable|don't have|do not have|won't|will not)\b.*\b(generate|create|make|draw|render|produce)\b.*\b(image|picture|photo|illustration|art|logo|icon|visual|graphic)\b/i.test(
        response,
      );
      const asksForDescription = /\b(what|which|describe|description|prompt|kind of|type of)\b.*\b(want|like|looking|imagining|need)\b/i.test(
        response,
      );
      if (looksLikeRefusal || asksForDescription) {
        response = await composeImageCaption(
          message,
          image,
          directorPrompt,
          memoryContext,
        );
      } else {
        response = `${response}\n\n${await composeImageCaption(
          message,
          image,
          directorPrompt,
          memoryContext,
        )}`;
      }
    }

    orchestrator.addToMemory(resolvedId, `I replied: ${response}`);

    // Persist to durable Supabase + Supermemory memory (non-blocking).
    void persistMemory(userId, `User said: ${message}`, {
      agentId: resolvedId,
      scope: "conversation",
      source: "agent-chat",
      reason: "user chat",
    });
    void persistMemory(userId, `I replied: ${response}`, {
      agentId: resolvedId,
      scope: "conversation",
      source: "agent-chat",
      reason: "director reply",
    });

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      response,
      userName,
      ...(image
        ? {
            imageUrl: image.imageUrl,
            imagePrompt: image.imagePrompt,
            imageProvider: image.imageProvider,
          }
        : {}),
    });
  } catch (error) {
    console.error("[api/agents/chat] error:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
