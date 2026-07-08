/**
 * POST /api/director/execute-step
 * Executes a single approved step from a Director run.
 * Phase 1: read_file, search_code, and safe run_command.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { executeCommand, isCommandAllowed } from "@/lib/command-executor";
import { generateText } from "@/lib/llm";
import type { DirectorStep, DirectorRunStatus, ExecuteStepResponse } from "@/lib/director/types";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

async function readFileAction(target: string): Promise<{ ok: boolean; content: string; error?: string }> {
  try {
    const resolved = path.normalize(path.join(PROJECT_ROOT, target));
    if (!resolved.startsWith(PROJECT_ROOT)) return { ok: false, content: "", error: "Path traversal denied" };
    if (!fs.existsSync(resolved)) return { ok: false, content: "", error: `Not found: ${target}` };
    const c = fs.readFileSync(resolved, "utf-8");
    return { ok: true, content: c.length > 5000 ? c.slice(0, 5000) + "\n... [TRUNCATED]" : c };
  } catch (err) { return { ok: false, content: "", error: String(err) }; }
}

async function searchCodeAction(query: string): Promise<{ ok: boolean; content: string; error?: string }> {
  try {
    const results: string[] = [];
    function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(fp);
        else if (e.isFile() && /\.(ts|tsx|js|jsx|css|json)$/.test(e.name)) {
          try { if (fs.readFileSync(fp, "utf-8").toLowerCase().includes(query.toLowerCase())) results.push(path.relative(PROJECT_ROOT, fp)); } catch { /* skip */ }
        }
      }
    }
    walk(path.join(PROJECT_ROOT, "src"));
    return { ok: true, content: results.slice(0, 30).join("\n") || `No matches for "${query}"` };
  } catch (err) { return { ok: false, content: "", error: String(err) }; }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { runId?: string; stepId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { runId, stepId } = body;
  if (!runId || !stepId) return NextResponse.json({ error: "Missing runId or stepId" }, { status: 400 });
  const admin = getSupabaseAdmin();
  let rawStep: Record<string, unknown> | null = null;
  if (admin) {
    const { data } = await admin.from("run_steps").select("*").eq("id", stepId).eq("run_id", runId).single();
    rawStep = data as Record<string, unknown> | null;
  }
  if (!rawStep) return NextResponse.json({ error: "Step not found" }, { status: 404 });
  const stepType = String(rawStep.type || "");
  const stepStatus = String(rawStep.status || "");
  const stepCommand = String(rawStep.command || "");
  const stepInput = (rawStep.input || {}) as Record<string, unknown>;
  const stepTitle = String(rawStep.title || "");
  if (stepStatus !== "queued") return NextResponse.json({ error: `Step is ${stepStatus}` }, { status: 409 });
  if (admin) await admin.from("run_steps").update({ status: "running", started_at: new Date().toISOString() }).eq("id", stepId);

  let stepResult = "", stepError: string | undefined, stepOk = false;
  try {
    const target = String(stepInput.target || "");
    if (stepType === "tool" || stepType.startsWith("tool:")) {
      const fp = target || stepCommand.replace(/^read_file\s+/i, "").trim();
      if (target || stepCommand.toLowerCase().startsWith("read_file")) {
        const r = await readFileAction(fp); stepOk = r.ok; stepResult = r.content; stepError = r.error;
      } else {
        const q = stepCommand.replace(/^search_code\s+/i, "").replace(/^search\s+/i, "").trim();
        const r = await searchCodeAction(q); stepOk = r.ok; stepResult = r.content; stepError = r.error;
      }
    } else if (stepType === "terminal") {
      if (stepCommand) {
        const base = stepCommand.split(" ")[0].toLowerCase();
        if (!isCommandAllowed(base)) { stepError = `"${base}" not allowed`; stepOk = false; }
        else {
          const r = await executeCommand({ command: base, args: stepCommand.split(" ").slice(1), cwd: PROJECT_ROOT, timeoutMs: 30000 });
          stepOk = r.ok; stepResult = r.stdout + (r.stderr ? `\nSTDERR:\n${r.stderr}` : ""); stepError = r.error;
        }
      } else { stepResult = "No command"; stepOk = false; }
    } else if (stepType === "step" || stepType === "diff") { stepResult = "Phase 1 skip"; stepOk = true; }
    else { stepResult = `Unknown: ${stepType}`; stepOk = false; }
  } catch (err) { stepError = String(err); stepOk = false; }

  const newStatus = stepOk ? "done" : "error";
  if (admin) await admin.from("run_steps").update({ status: newStatus, output: { result: stepResult, error: stepError }, finished_at: new Date().toISOString() }).eq("id", stepId);

  const directorStep: DirectorStep = {
    id: stepId,
    type: (stepType === "terminal" ? "run_command" : stepType === "tool" && stepCommand.toLowerCase().startsWith("search") ? "search_code" : stepType === "tool" ? "read_file" : stepType === "step" ? "review" : stepType === "diff" ? "write_file" : "run_command"),
    title: stepTitle, description: String(stepInput.description || ""),
    command: stepCommand || undefined, requiresApproval: false, riskLevel: "low",
    status: stepOk ? "success" as const : "failed" as const,
    result: stepResult, error: stepError,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  };

  // Observe
  try {
    const obs = await generateText(`Step "${stepTitle}" ${stepOk ? "OK" : "FAILED"}. Continue?`, { task: "precise", maxTokens: 100 });
    console.log(`[Director Observe] ${obs.text}`);
  } catch { /* silent */ }

  let nextAction: DirectorStep | null = null;
  if (admin) {
    const { data: remaining } = await admin.from("run_steps").select("*").eq("run_id", runId).eq("status", "queued").order("started_at", { ascending: true }).limit(1);
    if (remaining?.length) {
      const r = remaining[0];
      nextAction = { id: r.id, type: "run_command", title: r.title, description: "", command: r.command || undefined, requiresApproval: false, riskLevel: (r.risk_level || "low") as DirectorStep["riskLevel"], status: "pending" };
    }
  }

  const runStatus: DirectorRunStatus = stepOk ? (nextAction ? "running" : "completed") : "failed";
  if (admin) {
    await admin.from("runs").update({ status: runStatus === "completed" ? "completed" : "running", ...(runStatus === "completed" ? { finished_at: new Date().toISOString() } : {}) }).eq("id", runId);
  }

  return NextResponse.json({ ok: stepOk, step: directorStep, runStatus, nextAction } as ExecuteStepResponse);
}

