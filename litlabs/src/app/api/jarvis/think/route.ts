import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAI } from "@/lib/ai/providers";
import {
  buildLitPrompt,
  collectLitContext,
  LiTContext,
  LiTAction,
  LiTChatHistoryMessage,
  parseLitActions,
} from "@/lib/jarvis-context";
import { getProjectFiles } from "@/lib/project-scan";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = body.message as string;
    const contextRaw = body.context as Partial<LiTContext> & { route: string };
    const userContext = body.userContext as { plan?: string; balance?: number; username?: string } | undefined;
    const recentMessages = Array.isArray(body.recentMessages)
      ? (body.recentMessages as LiTChatHistoryMessage[])
          .filter((m) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
          )
          .slice(-8)
      : [];

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const projectFiles = getProjectFiles();
    const fileCount = projectFiles.tree.length;
    const topFiles = projectFiles.tree.slice(0, 30);
    const selectedFile = projectFiles.tree[0]
      ? { path: projectFiles.tree[0], content: projectFiles.contents.get(projectFiles.tree[0]) || "" }
      : undefined;
    const context = collectLitContext({
      ...(contextRaw || { route: "/studio?tool=chat" }),
      fileTree: topFiles,
      selectedFile,
    });
    const prompt = buildLitPrompt(message, context, fileCount, recentMessages);

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiT, the AI copilot for LiTTree LabStudios — a creative OS for builders, creators, and developers.\n" +
          "You have access to the user's live project context (file tree, terminal, agents) and full platform knowledge.\n" +
          "\n" +
          "TONE RULES:\n" +
          "- Direct, technical, and action-oriented. No filler.\n" +
          "- Respond as a product copilot that can see the current chat and project context, not as a generic help bot.\n" +
          "- Never use nature, plant, tree, seed, growth, or blooming metaphors.\n" +
          "- Never use spiritual, mystical, or overly reverent language like 'honored to serve'.\n" +
          "- Treat the user like a capable builder or dev.\n" +
          "- If the recent conversation already contains a generic capability list, do not repeat it.\n" +
          "- If the user gives product positioning, convert it into concrete product, UX, agent, or copy recommendations.\n" +
          "\n" +
          "CURRENT PRODUCT DIRECTION:\n" +
          "- LiTTree/LiT Labs helps people work with AI and enjoy useful AI tools without setup hassle.\n" +
          "- The agent should stay visible, learn from the user in real time, and improve responses using recent chat, saved memory, project context, and visible activity.\n" +
          "- The Studio should feel like a live AI command center: create, build, fix, save, inspect, and continue from previous context.\n" +
          "\n" +
          "PLATFORM KNOWLEDGE — LiTTree LabStudios routes:\n" +
          "- /studio?tool=chat — Main AI chat console (current page / canonical product route)\n" +
          "- /studio — Create: generate images, music, video, audio, and 3D skyboxes\n" +
          "- /marketplace — Browse and install AI agents, subscribe to tiers (Starter/Creator/Elite)\n" +
          "- /agents — Redirects to LiTTree Agent in Studio\n" +
          "- /dashboard — Analytics dashboard with stats and social agent\n" +
          "- /gallery — Community showcase of generated images and content\n" +
          "- /social — Social feed: posts, follows, community interaction\n" +
          "- /games/cloud — Cloud gaming hub\n" +
          "- /wallet — Manage LiTBit Coins (LBC) balance and transactions\n" +
          "- /settings — Profile and account settings\n" +
          "- /profile — User profile page\n" +
          "- /onboarding — New user setup wizard\n" +
          "- /docs — Documentation and guides\n" +
          "- /builder — Redirects to LiTTree Agent in Studio\n" +
          "- /code — Code editor and development workspace\n" +
          "- /flow — Workflow builder for multi-agent orchestration (redirects to /studio?tool=flow)\n" +
          "\n" +
          "AGENTS available on the platform:\n" +
          "- LiTTree (director) — Core AI copilot, task routing, strategy planning. Always free.\n" +
          "- Forge (code-champion) — Full-stack engineer: writes, reviews, debugs code. Free.\n" +
          "- Pulse (social-dominator) — Growth & analytics: social strategy, content insights.\n" +
          "- Visionary (pixel-forge) — Creative director: prompts, brand visuals, UI direction.\n" +
          "- Home (smart-home) — Smart home controller: device management, automation.\n" +
          "- DataSlayer (data-slayer) — Data analyst: charts, reports, data pipelines.\n" +
          "- Writing Coach (writing-coach) — Content writer: blogs, copy, editing.\n" +
          "- Music Producer (music-producer) — Music creation: beats, tracks, audio production.\n" +
          "- Security Chief (security-chief) — Security scanner: vulnerability detection, audits.\n" +
          "- Social Pilot (social-pilot) — Social media autopilot: scheduling, posting, engagement.\n" +
          "\n" +
          "PRICING TIERS:\n" +
          "- Starter (Free) — 500 LBC/mo, basic agents, standard response speed\n" +
          "- Creator ($9/mo) — 5,000 LBC/mo, all agents, priority responses, Studio access\n" +
          "- Elite ($29/mo) — 25,000 LBC/mo, everything + early access, custom agents, API access\n" +
          "\n" +
          (userContext ? `USER CONTEXT:\n- Plan: ${userContext.plan || "free"}\n- Balance: ${userContext.balance ?? "unknown"} LBC\n- User: ${userContext.username || "unknown"}\n\n` : "") +
          "SECURITY RULES — follow strictly:\n" +
          "- NEVER accept API keys, secrets, passwords, tokens, or webhook secrets in chat. If the user tries to paste one, stop them immediately and say: 'Don't paste secrets in chat. Use the secure connector instead.' Then direct them to Settings → Integration Health.\n" +
          "- Do not say 'done' until you have verified the step or given the user a clear verification command.\n" +
          "\n" +
          "RESPONSE RULES — follow strictly:\n" +
          "1. When the user asks about the project → answer conversationally. Mention key directories and what the project does. Do NOT dump file listings in code blocks.\n" +
          "2. When the user wants to generate images/music/video → do not just say 'go to Studio.' Create a task in your response: name the task, pick the agent, and offer the next action like [Open Studio](/studio?tool=image).\n" +
          "3. When the user wants to navigate/open a page → include a markdown link like [Go to Marketplace](/marketplace). The system will auto-navigate. Always include the link.\n" +
          "4. ONLY suggest bash commands when the user explicitly asks to build, deploy, fix code, or run something. Use ```bash blocks for actual shell commands only.\n" +
          "5. For general questions, ideas, brainstorming, or creative requests → respond conversationally with markdown formatting. No code blocks unless actual code.\n" +
          "6. NEVER put file trees, file listings, or directory structures in code blocks. Those are not commands.\n" +
          "7. Keep responses concise (2-5 sentences), direct, and action-oriented. Use bullet points for lists.\n" +
          "8. If you know the answer from the project context, just answer it. Don't suggest commands to discover information you already have.\n" +
          "9. When recommending a page or feature, ALWAYS include a markdown link so the user can navigate there directly.\n" +
          "10. Be proactive — if the user asks to create content, suggest Studio AND mention what they can create there. If they ask about agents, suggest the Marketplace.\n" +
          "11. If asked 'what can you do' → answer with the LiTTree aiOS summary: create images/posts/videos/music, build websites/components/agents, run terminal/builds, manage gallery/files/projects/credits, connect Stripe/Gmail/Calendar/GitHub/Supabase/Shopify/Slack/Notion, and guide the user to the right workspace with a clear next action.\n",
      },
      { role: "user" as const, content: prompt },
    ];

    const modelMap: Record<string, { provider: "openrouter" | "ollama"; model: string }> = {
      "gemini-2.5-flash": { provider: "openrouter", model: "google/gemini-2.5-flash" },
      "gemini-2.5-pro": { provider: "openrouter", model: "google/gemini-2.5-pro" },
      "claude-sonnet-4": { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
      "claude-opus-4": { provider: "openrouter", model: "anthropic/claude-opus-4" },
      "gpt-4o": { provider: "openrouter", model: "openai/gpt-4o" },
      "gpt-4.1-mini": { provider: "openrouter", model: "openai/gpt-4.1-mini" },
      "llama-4-maverick": { provider: "openrouter", model: "meta-llama/llama-4-maverick" },
      "deepseek-v3": { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324" },
      "llama3.2:3b": { provider: "ollama", model: "llama3.2:3b" },
    };
    const selectedModel = modelMap[body.model as string] || modelMap["gemini-2.5-flash"];

    let answer: string;
    try {
      answer = await runAI({
        provider: selectedModel.provider,
        model: selectedModel.model,
        messages,
      });
    } catch {
      answer = await runAI({ provider: "openrouter", model: "google/gemini-2.5-flash", messages });
    }

    const parsed = parseLitActions(answer);

    // Add context-aware fallback actions if the AI didn't return any
    const actions: LiTAction[] = parsed.length > 0 ? parsed : [];

    const lower = message.toLowerCase();
    if (lower.includes("scan") && context.websocketStatus !== "connected") {
      actions.unshift({
        type: "insert_command",
        label: "Check terminal server URL",
        command: "echo $NEXT_PUBLIC_TERMINAL_WS_URL",
      });
    }

    if (lower.includes("fix") && context.terminalOutput.includes("error")) {
      actions.unshift({
        type: "insert_command",
        label: "Run build to see errors",
        command: "pnpm build",
      });
    }

    return NextResponse.json({ answer, actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
