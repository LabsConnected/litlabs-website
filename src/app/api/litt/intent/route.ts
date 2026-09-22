import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { routeIntent, type LiTTIntent } from "@/lib/intent-router";
import { buildPlan } from "@/lib/planner";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    context?: Record<string, unknown>;
  } | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const output = await routeIntent({
    prompt: body.prompt,
    context: {
      activeProjectId: typeof body.context?.activeProjectId === "string" ? body.context.activeProjectId : undefined,
      selectedAssetId: typeof body.context?.selectedAssetId === "string" ? body.context.selectedAssetId : undefined,
      openFiles: Array.isArray(body.context?.openFiles) ? body.context.openFiles.filter((file): file is string => typeof file === "string") : undefined,
      deploymentState: ["deployed", "pending", "failed", "none"].includes(String(body.context?.deploymentState))
        ? body.context?.deploymentState as "deployed" | "pending" | "failed" | "none"
        : undefined,
      recentIntents: Array.isArray(body.context?.recentIntents) ? body.context.recentIntents.filter((intent): intent is LiTTIntent => typeof intent === "string") : undefined,
    },
  });

  if (output.type === "clarification") return NextResponse.json(output);
  const plan = buildPlan(body.prompt, output.result);
  return NextResponse.json({ ...output, plan });
}
