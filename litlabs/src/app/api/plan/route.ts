import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateJSON } from "@/lib/llm";
import type { DirectorPlan } from "@/lib/runs/types";

const PLAN_SYSTEM_PROMPT = `You are the LiT Director. Return a JSON execution plan for the requested intent.
Rules:
- Prefer atomic, verifiable terminal commands when execution is needed.
- Include file paths only when explicit.
- Mark writes/network/deploy as needs_approval=true and risk_level accordingly.
- Return ONLY a JSON object with shape: { goal, steps[] }.
- step types: tool | terminal | diff | review | finish.
- Minimum 1 step.`;

function classifyRisk(command: string): "low" | "medium" | "high" | "critical" {
  const c = command.toLowerCase();
  if (/(rm\s+-rf|git\s+push\s+--force|format\s+c:|del\s+|remove-item|drop\s+table|deploy|production)/.test(c)) return "critical";
  if (/(git\s+push|npm\s+publish|publish|deploy|\.\/node_modules|network|sendmail|curl\s|wget\s|http)/.test(c)) return "high";
  if (/(npm\s+install|pnpm\s+install|yarn\s+install|git\s+add|rm\s+|delete|remove)/.test(c)) return "medium";
  return "low";
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const intent = String(body.intent || "").trim();
  const maxSteps = Math.min(Number(body.maxSteps || 6), 12);

  if (!intent) {
    return NextResponse.json({ error: "Missing intent" }, { status: 400 });
  }

  let plan: DirectorPlan;
  try {
    const out = await generateJSON<DirectorPlan>(
      `Intent: ${intent}`,
      {
        provider: "gemini",
        task: "json",
        maxTokens: 400,
        timeoutMs: 20000,
        modelOverride: {
          gemini: "gemini-2.5-flash",
          "openrouter-free": process.env.OPENROUTER_PLAN_SMALL ?? "openrouter/free",
        },
      }
    );
    const parsed = out as DirectorPlan;
    if (!parsed?.steps?.length) throw new Error("empty plan");
    plan = parsed;
  } catch {
    plan = {
      goal: intent,
      steps: [
        {
          id: `step-${Date.now()}`,
          title: `Investigate: ${intent}`,
          type: "terminal",
          command: `echo "Need more precise intent?"`,
          needs_approval: false,
          risk_level: "low",
        },
      ],
    };
  }

  const steps = plan.steps.slice(0, maxSteps).map((step) => ({
    id: step.id || `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: step.title,
    type: step.type,
    command: step.command ?? null,
    expected_files: step.expected_files ?? [],
    tool: step.tool ?? null,
    args: step.args ?? {},
    needs_approval: step.needs_approval ?? step.command ? classifyRisk(step.command || "") !== "low" : false,
    risk_level: step.risk_level ?? (step.command ? classifyRisk(step.command) : "low"),
  }));

  let runId: string | null = null;
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data } = await admin
        .from("runs")
        .insert({
          owner_id: userId,
          source: "chat",
          intent,
          plan: { goal: plan.goal, steps } as Record<string, unknown>,
          risk_level: steps[0]?.risk_level || "low",
          status: steps.some((s) => s.needs_approval) ? "needs_approval" : "pending",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      runId = data?.id || null;
    }
  } catch {
    runId = null;
  }

  return NextResponse.json({
    ok: true,
    runId,
    plan: {
      goal: plan.goal,
      steps,
    },
  });
}
