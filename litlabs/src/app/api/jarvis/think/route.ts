import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAI } from "@/lib/ai/providers";
import {
  buildLitPrompt,
  collectLitContext,
  LiTContext,
  LiTAction,
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
    const prompt = buildLitPrompt(message, context, fileCount);

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiT, the AI copilot for LiTTree LabStudios — a creative OS for builders, creators, and developers.\n" +
          "You have access to the user's live project context (file tree, terminal, agents) and full platform knowledge.\n" +
          "\n" +
          "PLATFORM KNOWLEDGE — LiTTree LabStudios routes:\n" +
          "- /studio?tool=chat — Main AI chat console (current page / canonical product route)\n" +
          "- /studio — Create: generate images, music, video, audio, and 3D skyboxes\n" +
          "- /marketplace — Browse and install AI agents, subscribe to tiers (Starter/Creator/Elite)\n" +
          "- /agents — Agent hub: see all installed agents and their status\n" +
          "- /dashboard — Analytics dashboard with stats and social agent\n" +
          "- /gallery — Community showcase of generated images and content\n" +
          "- /social — Social feed: posts, follows, community interaction\n" +
          "- /games — Cloud gaming hub\n" +
          "- /wallet — Manage LiTBit Coins (LBC) balance and transactions\n" +
          "- /settings — Profile and account settings\n" +
          "- /profile — User profile page\n" +
          "- /onboarding — New user setup wizard\n" +
          "- /docs — Documentation and guides\n" +
          "- /builder — AI builder for creating custom agents (redirects to /studio?tool=builder)\n" +
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
          "RESPONSE RULES — follow strictly:\n" +
          "1. When the user asks about the project → answer conversationally. Mention key directories and what the project does. Do NOT dump file listings in code blocks.\n" +
          "2. When the user wants to generate images/music/video → say 'Let me take you to Studio!' and include the link [Studio](/studio). The system will auto-navigate.\n" +
          "3. When the user wants to navigate/open a page → include a markdown link like [Go to Marketplace](/marketplace). The system will auto-navigate. Always include the link.\n" +
          "4. ONLY suggest bash commands when the user explicitly asks to build, deploy, fix code, or run something. Use ```bash blocks for actual shell commands only.\n" +
          "5. For general questions, ideas, brainstorming, or creative requests → respond conversationally with markdown formatting. No code blocks unless actual code.\n" +
          "6. NEVER put file trees, file listings, or directory structures in code blocks. Those are not commands.\n" +
          "7. Keep responses concise (2-5 sentences), friendly, and action-oriented. Use bullet points for lists.\n" +
          "8. If you know the answer from the project context, just answer it. Don't suggest commands to discover information you already have.\n" +
          "9. When recommending a page or feature, ALWAYS include a markdown link so the user can navigate there directly.\n" +
          "10. Be proactive — if the user asks to create content, suggest Studio AND mention what they can create there. If they ask about agents, suggest the Marketplace.\n",
      },
      { role: "user" as const, content: prompt },
    ];

    let answer: string;
    try {
      answer = await runAI({
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        messages,
      });
    } catch {
      answer = await runAI({ provider: "ollama", model: "llama3.2:3b", messages });
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
