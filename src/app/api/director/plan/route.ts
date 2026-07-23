import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { DirectorGraphPlanner } from "@/lib/director-graph";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const goal =
      typeof body?.goal === "string" && body.goal.trim().length > 0
        ? body.goal.trim()
        : "";

    if (!goal) {
      return NextResponse.json({ error: "Missing goal" }, { status: 400 });
    }

    const planner = new DirectorGraphPlanner();
    const graph = planner.buildPlan(goal);
    const origin = new URL(request.url).origin;

    const enqueuedTasks: Array<{ id?: string; taskId?: string }> = [];

    for (const step of graph.tasks) {
      try {
        const res = await fetch(`${origin}/api/agent-tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: body?.sessionId || "session-director-001",
            workflowId: body?.workflowId || "workflow-director-001",
            assignedTo: step.agentSlug,
            dispatcher: "director-plan",
            taskInput: {
              prompt: step.prompt,
              context: { source: "director-plan" },
              agentSlug: step.agentSlug,
              provider: step.provider,
              model: step.model,
              dependsOn: step.dependsOn,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`❌ Intake rejected step ${step.agentSlug}:`, errText);
          enqueuedTasks.push({ id: undefined, taskId: undefined });
        } else {
          const saved = await res.json();
          enqueuedTasks.push(saved);
        }
      } catch (networkError) {
        console.error(
          `❌ Network error enqueuing ${step.agentSlug}:`,
          networkError,
        );
        enqueuedTasks.push({ id: undefined, taskId: undefined });
      }
    }

    return NextResponse.json(
      {
        success: true,
        msg: `Successfully parsed macro goal into ${graph.tasks.length} task threads.`,
        plan: graph,
        enqueuedTasks,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Director plan failed:", error);
    return NextResponse.json(
      { error: "Failed to build plan" },
      { status: 500 },
    );
  }
}
