import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateComponent, directorPlan, executorCode } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case "generate-component": {
        const { description, existingCode } = params;
        if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
        const code = await generateComponent(description, existingCode);
        return NextResponse.json({ code });
      }

      case "director-plan": {
        const { backlog, completed, projectContext } = params;
        const plan = await directorPlan(backlog || "", completed || "", projectContext || "");
        try {
          const parsed = JSON.parse(plan);
          return NextResponse.json({ plan: parsed });
        } catch {
          return NextResponse.json({ plan: plan, raw: true });
        }
      }

      case "executor-code": {
        const { instructions, targetFile, existingCode, errorLogs } = params;
        if (!instructions || !targetFile) return NextResponse.json({ error: "instructions and targetFile required" }, { status: 400 });
        const code = await executorCode(instructions, targetFile, existingCode, errorLogs);
        return NextResponse.json({ code });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Build error: ${msg}` }, { status: 502 });
  }
}
