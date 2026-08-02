import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runAI } from "@/lib/ai/providers";
import {
  buildJarvisPrompt,
  collectJarvisContext,
  JarvisContext,
  JarvisAction,
  parseJarvisActions,
} from "@/lib/litt-context";
import { getUserContext } from "@/lib/litt-intelligence/user-context";
import { fetchWeatherForUser } from "@/lib/litt-intelligence/weather-tool";

const PERSONAL_KEYWORDS = [
  "weather",
  "temperature",
  "forecast",
  "rain",
  "umbrella",
  "what should i wear",
  "is it hot",
  "is it cold",
  "how hot",
  "how cold",
];

function isPersonalAssistantQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return PERSONAL_KEYWORDS.some((kw) => lower.includes(kw));
}

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

    if (isPersonalAssistantQuery(message)) {
      const ctx = await getUserContext(userId, {
        capabilities: ["weather.current", "weather.hourly", "weather.daily"],
      });
      const weatherResult = await fetchWeatherForUser(ctx, { type: "current" });

      if (weatherResult.success) {
        const answer = weatherResult.formatted;
        return NextResponse.json({ answer, actions: [] as JarvisAction[] });
      }

      return NextResponse.json({
        answer: weatherResult.error,
        actions: [] as JarvisAction[],
      });
    }

    const context = collectJarvisContext(contextRaw || { route: "/litt" });
    const prompt = buildJarvisPrompt(message, context);

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiTT, the AI operating layer for LiTTree-LabStudios. " +
          "You may be connected to a terminal, file explorer, logs, and agent runner — but only if the context below shows live data. " +
          "If the context shows no terminal output, no files, and no logs, do NOT claim you are connected to those systems. " +
          "Inspect the provided context, diagnose issues, and give prioritized fixes with commands. " +
          "When you include a command, wrap it in a bash code block. " +
          "Never claim voice, microphone, terminal, or any capability is working unless the context proves it. " +
          "Do not ask vague follow-up questions unless absolutely necessary.",
      },
      { role: "user" as const, content: prompt },
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
