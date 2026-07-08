/**
 * POST /api/director/run — Run Execution Loop entry point.
 * Accepts user message → generates plan (LLM) → persists → returns steps.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateJSON } from "@/lib/llm";
import type { DirectorRunRequest, DirectorRunResponse, DirectorStep, DirectorStepType, DirectorRunStatus } from "@/lib/director/types";
import { classifyDirectorRisk, stepRequiresApproval } from "@/lib/director/types";

export const dynamic = "force-dynamic";

const PLAN_PROMPT = `You are LiT Director. Return a JSON execution plan.
Types: read_file, write_file, run_command, search_code, web_check, db_query, review, finish.
Mark destructive/network/deploy with requiresApproval: true.
Return ONLY JSON: { "goal": "...", "steps": [{ id, type, title, description, target?, command?, requiresApproval }] }
Max 8 steps. Be practical.`;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: DirectorRunRequest;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const message = (body.message || "").trim();
  const mode = body.mode || "plan";
  const autoApprove = body.autoApprove || false;
  if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });

  // ── Generate plan ──
  let planSteps: DirectorStep[] = [];
  try {
    const out = await generateJSON<{ goal: string; steps: DirectorStep[] }>(
      `User: ${message}\n\nGenerate a practical execution plan.`,
      { provider: "gemini", task: "json", maxTokens: 800, timeoutMs: 25000 }
    );
    const parsed = out as { goal: string; steps: DirectorStep[] } | null;
    if (parsed?.steps?.length) {
      planSteps = parsed.steps.slice(0, 8).map((s, i) => ({
        id: s.id || `step-${i + 1}-${Date.now().toString(36)}`,
        type: (s.type || "run_command") as DirectorStepType,
        title: s.title || `Step ${i + 1}`,
        description: s.description || "",
        target: s.target,
        command: s.command,
        requiresApproval: s.requiresApproval ?? stepRequiresApproval(s),
        riskLevel: s.riskLevel || (s.command ? classifyDirectorRisk(s.command) : "low"),
        status: "pending" as const,
      }));
    }
  } catch (err) { console.error("Plan gen failed:", err); }

  // Fallback plan
  if (!planSteps.length) {
    planSteps = [{
      id: `step-1-${Date.now().toString(36)}`,
      type: "run_command", title: `Process: ${message.slice(0, 60)}`,
      description: `Execute: ${message}`,
      command: `echo "Processing: ${message}"`,
      requiresApproval: false, riskLevel: "low", status: "pending",
    }];
  }

  // Add finish step
  if (!planSteps.some((s) => s.type === "finish")) {
    planSteps.push({
      id: `step-finish-${Date.now().toString(36)}`,
      type: "finish", title: "Complete",
      description: "Summarize what was accomplished",
      requiresApproval: false, riskLevel: "low", status: "pending",
    });
  }

  // ── Determine status ──
  const needsApproval = planSteps.some((s) => s.requiresApproval);
  const runStatus: DirectorRunStatus = mode === "plan"
    ? "planned"
    : needsApproval && !autoApprove ? "waiting_approval" : "running";

  // ── Persist to Supabase ──
  let runId: string | null = null;
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data: runData } = await admin.from("runs").insert({
        owner_id: userId, source: "chat", intent: message,
        plan: { goal: message, steps: planSteps } as Record<string, unknown>,
        risk_level: planSteps.some((s) => s.riskLevel === "critical" || s.riskLevel === "high") ? "high"
          : planSteps.some((s) => s.riskLevel === "medium") ? "medium" : "low",
        status: runStatus === "running" ? "running"
          : runStatus === "waiting_approval" ? "needs_approval" : "pending",
        started_at: new Date().toISOString(),
      }).select("id").single();
      runId = runData?.id || null;

      if (runId) {
        await admin.from("run_steps").insert(planSteps.map((s) => ({
          run_id: runId,
          type: s.type === "run_command" ? "terminal" as const
            : s.type === "read_file" || s.type === "search_code" || s.type === "web_check" || s.type === "db_query" ? "tool" as const
            : s.type === "write_file" ? "diff" as const : "step" as const,
          title: s.title, status: "queued" as const,
          command: s.command || null, risk_level: s.riskLevel || "low",
          input: { description: s.description, target: s.target } as Record<string, unknown>,
          started_at: new Date().toISOString(),
        })));
      }
    }
  } catch (err) { console.error("Persist failed:", err); runId = null; }

  // ── Next action ──
  const pendingApproval = planSteps.find((s) => s.requiresApproval && s.status === "pending");
  const firstExec = !pendingApproval ? planSteps.find((s) => s.status === "pending" && s.type !== "finish") : undefined;

  const response: DirectorRunResponse = {
    runId: runId || `local-${Date.now().toString(36)}`,
    status: runStatus,
    plan: { goal: message, steps: planSteps },
    nextAction: pendingApproval || firstExec || undefined,
  };

  console.log(`[Director] Run ${response.runId} | ${planSteps.length} steps | status=${runStatus} | ${Date.now() - startTime}ms`);
  return NextResponse.json({ ok: true, ...response });
}

