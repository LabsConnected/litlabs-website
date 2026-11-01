/**
 * POST /api/studio-projects/[projectId]/generate — lightweight structured
 * generation lane. For hosts where the multi-step tool-calling loop
 * cannot run (small local models), this path asks a local model to emit
 * a strict file-list format, validates every path, and writes the files
 * through the SAME terminal-server workspace bridge the files API uses.
 *
 * ADDITIONAL lane — the agent/tool pipeline is untouched. Every write is
 * ownership-checked, path-validated, and reported truthfully.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";

export const runtime = "nodejs";

const FILE_BLOCK_RE = /===FILE:\s*([^\n\r=]+?)\s*===\r?\n([\s\S]*?)(?:===END===|$)/g;
const ALLOWED_EXT = /\.(html?|css|m?js|json|svg|txt|md|xml)$/i;
const MAX_FILES = 20;
const MAX_BYTES = 512 * 1024;

function safePath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.length > 200) return null;
  if (p.split("/").some((s) => s === ".." || s === "." || s.includes("")) ) return null;
  if (!ALLOWED_EXT.test(p)) return null;
  return p;
}

function ollamaBase(): string {
  for (const k of ["OLLAMA_BASE_URL", "OLLAMA_HOST", "OLLAMA_ENDPOINT"]) {
    const v = process.env[k]?.trim();
    if (v) return v.replace(/\/$/, "");
  }
  return "http://localhost:11434";
}

async function callModel(model: string, system: string, user: string): Promise<{ text: string; latencyMs: number; promptTokens?: number; completionTokens?: number }> {
  const t0 = Date.now();
  const res = await fetch(`${ollamaBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_ctx: 8192 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: j.choices?.[0]?.message?.content ?? "",
    latencyMs: Date.now() - t0,
    promptTokens: j.usage?.prompt_tokens,
    completionTokens: j.usage?.completion_tokens,
  };
}

const SYSTEM = `You generate website files for a static site. Respond ONLY with file blocks in EXACTLY this format:
===FILE:index.html===
<file contents>
===END===
===FILE:styles.css===
<file contents>
===END===
Rules: every file gets its own block; paths are workspace-relative plain names or subdirs; no markdown fences, no commentary. Always include index.html.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: { prompt?: string; model?: string; edit?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const { workspaceId } = await verifyProjectWorkspace(projectId, userId);
  const base = requireTerminalBaseUrl();
  const token = () => createTerminalToken(userId);

  // Follow-up edit support: pull current index.html so the model revises it.
  let currentFile: { path: string; content: string } | null = null;
  if (body.edit) {
    try {
      const t = token();
      const r = await fetch(`${base}/ws-files/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}`, "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ path: "index.html" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        const d = (await r.json()) as { content?: string };
        if (d.content) currentFile = { path: "index.html", content: d.content };
      }
    } catch { /* non-fatal — edit falls back to fresh generation */ }
  }

  const userMsg = currentFile
    ? `Current ${currentFile.path}:\n===FILE:${currentFile.path}===\n${currentFile.content}\n===END===\n\nApply this edit request and output ALL site files again: ${prompt}`
    : prompt;

  const models = body.model?.trim()
    ? [body.model.trim()]
    : [process.env.LITT_GEN_LANE_MODEL?.trim() || "litt-coder:8k", "litt-hermes-fast:8k"];

  let gen: Awaited<ReturnType<typeof callModel>> | null = null;
  let modelUsed = "";
  const errors: string[] = [];
  for (const m of models) {
    try {
      gen = await callModel(m, SYSTEM, userMsg);
      modelUsed = m;
      break;
    } catch (e) {
      errors.push(`${m}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  if (!gen) {
    return NextResponse.json({ error: "all local models failed", attempts: errors }, { status: 502 });
  }

  // Parse ===FILE blocks; drop anything malformed or unsafe. A block
  // rejected here is reported — never silently written.
  const files: Array<{ path: string; content: string }> = [];
  const rejected: Array<{ path: string; reason: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_BLOCK_RE.source, "g");
  while ((m = re.exec(gen.text)) !== null && files.length < MAX_FILES) {
    const path = safePath(m[1] ?? "");
    if (!path) { rejected.push({ path: (m[1] ?? "").slice(0, 120), reason: "unsafe_or_disallowed_path" }); continue; }
    const content = (m[2] ?? "").replace(/===END===\s*$/, "").trimEnd();
    if (!content || Buffer.byteLength(content) > MAX_BYTES) { rejected.push({ path, reason: "empty_or_too_large" }); continue; }
    files.push({ path, content });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "model emitted no valid files", rejected, model: modelUsed, latencyMs: gen.latencyMs, head: gen.text.slice(0, 300) }, { status: 422 });
  }

  const written: Array<{ path: string; bytes: number }> = [];
  const writeErrors: Array<{ path: string; error: string }> = [];
  for (const f of files) {
    try {
      const t = token();
      const r = await fetch(`${base}/ws-files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}`, "X-Workspace-Id": workspaceId },
        body: JSON.stringify({ path: f.path, content: f.content }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`ws-files/write ${r.status}`);
      const bytes = Buffer.byteLength(f.content);
      written.push({ path: f.path, bytes });
      await logFileOperation({ userId, projectId, workspaceId, action: "write", path: f.path, bytes, source: "gen-lane" });
    } catch (e) {
      writeErrors.push({ path: f.path, error: e instanceof Error ? e.message : "write failed" });
    }
  }

  return NextResponse.json({
    ok: written.length > 0,
    model: modelUsed,
    latencyMs: gen.latencyMs,
    promptTokens: gen.promptTokens,
    completionTokens: gen.completionTokens,
    written,
    rejected,
    writeErrors,
    edited: Boolean(currentFile),
  });
}
