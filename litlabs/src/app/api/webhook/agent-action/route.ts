import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Verify a shared-secret webhook token (constant-time compare).
 * Fails closed: if AGENT_ACTION_WEBHOOK_SECRET is not configured, no request
 * is authorized. Previously this endpoint accepted (and exposed) agent actions
 * from anyone on the internet.
 */
function verifyWebhookSecret(req: NextRequest): boolean {
  const secret = process.env.AGENT_ACTION_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided =
    req.headers.get("x-agent-webhook-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

export async function GET(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    actions: actionQueue,
    pendingCount: actionQueue.filter((a) => a.status === "pending").length,
  });
}

export async function PATCH(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
