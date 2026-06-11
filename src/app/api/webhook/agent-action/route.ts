import { NextRequest, NextResponse } from "next/server";

// In-memory queue for agent actions (cleared on restart/deploy)
interface AgentAction {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  target: string;
  payload: Record<string, unknown>;
  status: "pending" | "applied" | "rejected";
}

let actionQueue: AgentAction[] = [];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, target, payload, source = "activepieces" } = body;

    if (!action || !target) {
      return NextResponse.json(
        { error: "Missing 'action' or 'target' field" },
        { status: 400 }
      );
    }

    const newAction: AgentAction = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source,
      action,
      target,
      payload: payload || {},
      status: "pending",
    };

    actionQueue.unshift(newAction);

    // Keep only last 50 actions
    if (actionQueue.length > 50) {
      actionQueue = actionQueue.slice(0, 50);
    }

    // Agent action queued

    return NextResponse.json({
      success: true,
      actionId: newAction.id,
      message: `Action '${action}' on '${target}' queued.`,
      queueLength: actionQueue.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    actions: actionQueue,
    pendingCount: actionQueue.filter((a) => a.status === "pending").length,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    const action = actionQueue.find((a) => a.id === id);
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    action.status = status;
    return NextResponse.json({ success: true, action });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}
