import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAI } from "@/lib/ai/providers";
import {
  buildJarvisPrompt,
  buildJarvisSystemPrompt,
  collectJarvisContext,
  JarvisContext,
  JarvisAction,
  parseJarvisActions,
} from "@/lib/litt-context";
import { loadProjectContext } from "@/lib/project-context";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = body.message as string;
    const contextRaw = body.context as Partial<JarvisContext> & { route: string };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const context = collectJarvisContext(contextRaw || { route: "/litt" });
    const userPrompt = buildJarvisPrompt(message, context);

    // Build a system prompt that ALWAYS carries the static litlabs.net
    // project identity, plus the (optional) per-user project notes from
    // localStorage. This is the route's primary "brain" — the model
    // should already know what project it's inside.
    let project;
    try {
      project = loadProjectContext();
    } catch {
      project = undefined;
    }
    const systemPrompt =
      buildJarvisSystemPrompt(project) +
      "\n\n" +
      "You are LiTT, the AI operating layer for LiTTree-LabStudios (litlabs.net). " +
      "You are connected to a real terminal, file explorer, logs, and agent runner. " +
      "Inspect the provided context, diagnose issues, and give prioritized fixes with commands. " +
      "When you include a command, wrap it in a bash code block. " +
      "Use pnpm (never npm/yarn) in commands. " +
      "Do not ask vague follow-up questions unless absolutely necessary.";

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];

    let answer: string;
    try {
      answer = await runAI({ provider: "ollama", model: "llama3.2:3b", messages });
    } catch {
      answer = await runAI({
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        messages,
      });
    }

    const parsed = parseJarvisActions(answer);

    // Add context-aware fallback actions if the AI didn't return any
    const actions: JarvisAction[] = parsed.length > 0 ? parsed : [];

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
