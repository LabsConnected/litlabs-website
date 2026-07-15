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
import { integrationStatusBlock, getProjectHealth } from "@/lib/integrations";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = body.message as string;
    const contextRaw = body.context as Partial<JarvisContext> & { route: string };
    const clientGoals = Array.isArray(body.goals) ? body.goals : undefined;
    const clientTimeOfDay = typeof body.timeOfDay === "string" ? body.timeOfDay : undefined;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const context = collectJarvisContext(contextRaw || { route: "/litt" });

    // Detect phrase intent — "show me around" / "tour" / "what's connected"
    // / "what's the project" all map to a special tour handler that
    // doesn't need an LLM round-trip; it just dumps the live health.
    const lower = message.trim().toLowerCase();
    const isTour =
      lower === "show me around" ||
      lower === "tour" ||
      lower.startsWith("show me around") ||
      lower.startsWith("walk me through") ||
      lower.startsWith("what's connected") ||
      lower.startsWith("whats connected") ||
      lower.startsWith("what integrations") ||
      lower.startsWith("project context") ||
      lower.startsWith("whats the project context") ||
      lower === "/tour" ||
      lower === "/show";

    if (isTour) {
      return NextResponse.json({
        answer: buildTourAnswer(clientTimeOfDay, clientGoals),
        actions: tourActions(),
      });
    }

    // Detect goal-management intent — "make a list of X", "add goal: Y",
    // "create a goal" etc. The LLM should still respond, but we pass
    // goal context in the system prompt so it can act.
    const userPrompt = buildJarvisPrompt(message, context);

    // Build a system prompt that ALWAYS carries the static litlabs.net
    // project identity, the live integration state, and the (optional)
    // per-user project notes from localStorage.
    let project;
    try {
      project = loadProjectContext();
    } catch {
      project = undefined;
    }
    const goalsBlock = clientGoals && clientGoals.length
      ? `USER OPEN GOALS (carried from client):\n${clientGoals
        .slice(0, 12)
        .map((g: { title?: string; priority?: string; status?: string }, i: number) =>
          `  ${i + 1}. [${(g.priority ?? "medium").toUpperCase()}] ${g.title ?? "(untitled)"} (${g.status ?? "open"})`,
        )
        .join("\n")}\n`
      : "(client did not provide open goals)";

    const tod =
      clientTimeOfDay ??
      (new Date().getHours() < 5
        ? "night"
        : new Date().getHours() < 12
          ? "morning"
          : new Date().getHours() < 18
            ? "afternoon"
            : new Date().getHours() < 22
              ? "evening"
              : "night");

    const systemPrompt =
      buildJarvisSystemPrompt(project) +
      "\n\n" +
      `LIVE INTEGRATION STATE (auto-detected from process.env):\n${integrationStatusBlock()}\n` +
      `\nTIME OF DAY: ${tod} — adjust tone and suggestions accordingly. ${tod === "morning" ? "Lead with what's most important to ship today." : tod === "evening" ? "User is winding down; suggest wrap-up tasks and what's left for tomorrow." : tod === "night" ? "User is in deep-work mode; be terse and avoid drive-by questions." : "Steady afternoon — propose one concrete next step, not a menu."}\n` +
      `\n${goalsBlock}\n` +
      "\n" +
      "You are LiTT, the AI operating layer for LiTTree-LabStudios (litlabs.net). " +
      "You are connected to a real terminal, file explorer, logs, and agent runner. " +
      "Inspect the provided context, diagnose issues, and give prioritized fixes with commands. " +
      "When you include a command, wrap it in a bash code block. " +
      "Use pnpm (never npm/yarn) in commands. " +
      "When the user says 'add this to my list' or 'make a goal' or 'todo: X', " +
      "respond with a short confirmation and include an `add_goal` JSON action so the client can persist it. " +
      "Be ANTICIPATORY: if you see the user is on /litt and has high-priority open goals, " +
      "reference the top one without being asked. " +
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

/* ------------------------------------------------------------------ */
/*  Tour handler — no LLM round-trip needed                          */
/* ------------------------------------------------------------------ */

function buildTourAnswer(
  timeOfDay?: string,
  clientGoals?: unknown[],
): string {
  const health = getProjectHealth();
  const tod = timeOfDay ?? health.timeOfDay;

  const requiredMissing = health.integrations
    .filter((i) => i.required && i.status !== "connected")
    .map((i) => i.name);
  const optionalMissing = health.integrations
    .filter((i) => !i.required && i.status !== "connected")
    .map((i) => i.name);

  const greeting =
    tod === "morning"
      ? "Good morning. Here's the lay of the land for litlabs.net today."
      : tod === "afternoon"
        ? "Quick tour — here's where litlabs.net stands this afternoon."
        : tod === "evening"
          ? "Evening tour. Here's the state of the project and what I'd ship next."
          : "Late session. Here's the rundown.";

  const lines: string[] = [];
  lines.push(`### ${greeting}`);
  lines.push("");
  lines.push(
    `**Integrations:** ${health.connected}/${health.total} connected. ${requiredMissing.length > 0
      ? `Required missing: ${requiredMissing.join(", ")}.`
      : `All required integrations are live.`
    }`,
  );
  if (optionalMissing.length > 0) {
    lines.push(`Optional but not set: ${optionalMissing.join(", ")}.`);
  }
  lines.push("");

  if (Array.isArray(clientGoals) && clientGoals.length > 0) {
    lines.push(
      `**Open goals:** ${clientGoals.length}. The top one by priority is right under here.`,
    );
    lines.push("");
  } else {
    lines.push(
      "**Open goals:** none. Say `add goal: <title>` to start a list and I'll keep it on your radar.",
    );
    lines.push("");
  }

  lines.push("**Subsystems online right now:**");
  lines.push("- `src/lib/litt.ts` — notification dispatcher");
  lines.push("- `src/lib/litt-context.ts` — my brain / prompt builder");
  lines.push("- `src/lib/AgentOrchestrator.ts` — agent graph");
  lines.push("- `src/lib/llm.ts` — unified LLM client (Gemini primary, OpenRouter fallback)");
  lines.push("- Terminal server (separate process on its own port)");
  lines.push("");

  lines.push("**Try next:**");
  lines.push("1. `pnpm dev` — start the dev server on :3000");
  lines.push("2. `/goals` — see your list");
  lines.push("3. `/anticipate` — let me read the room and suggest the next move");
  lines.push("4. `/integrations` — full integration table");
  return lines.join("\n");
}

function tourActions(): JarvisAction[] {
  return [
    { type: "insert_command", label: "Start dev server", command: "pnpm dev" },
    { type: "insert_command", label: "Type-check", command: "npx tsc --noEmit" },
    { type: "insert_command", label: "Build", command: "pnpm build" },
  ];
}
