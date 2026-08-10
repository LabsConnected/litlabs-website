import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  startSession,
  closeSession,
  pauseSession,
  takeControl,
  returnControl,
  getSession,
  dbGetActiveSessions,
  dbGetActions,
  takeScreenshot,
  closeIdleSessions,
} from "@/lib/litt-intelligence/browser-session-manager";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/litt/browser/session
 * Start a new browser session.
 * Body: { action: "start", task?, projectId?, conversationId?, model?, useProxies? }
 *
 * POST /api/litt/browser/session
 * Control an existing session.
 * Body: { action: "pause"|"take_control"|"return_control"|"close"|"screenshot", sessionId }
 *
 * GET /api/litt/browser/session
 * List active sessions for the authenticated user.
 *
 * GET /api/litt/browser/session?sessionId=xxx
 * Get a specific session with recent actions.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── GET: list sessions or get specific session ───────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    if (sessionId) {
      const session = await getSession(sessionId, userId);
      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const actions = await dbGetActions(sessionId, userId, 50);
      return NextResponse.json({ session, actions });
    }

    const sessions = await dbGetActiveSessions(userId);
    return NextResponse.json({ sessions });
  }

  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ─── POST: session control ────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = body.action as string | undefined;
  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    switch (action) {
      // ── Start new session ──────────────────────────────────────
      case "start": {
        const task = typeof body.task === "string" ? body.task : undefined;
        const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
        const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
        const model = typeof body.model === "string" ? body.model : undefined;
        const useProxies = body.useProxies === true;

        // Clean up idle sessions before starting a new one
        await closeIdleSessions().catch(() => {});

        const session = await startSession({
          userId,
          projectId,
          conversationId,
          task,
          model,
          useProxies,
        });

        return NextResponse.json({ session });
      }

      // ── Pause agent control ────────────────────────────────────
      case "pause": {
        const sessionId = body.sessionId as string;
        if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

        const session = await pauseSession(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        return NextResponse.json({ session });
      }

      // ── Take control (human) ───────────────────────────────────
      case "take_control": {
        const sessionId = body.sessionId as string;
        if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

        const session = await takeControl(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        return NextResponse.json({ session });
      }

      // ── Return control to agent ────────────────────────────────
      case "return_control": {
        const sessionId = body.sessionId as string;
        if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

        const session = await returnControl(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        return NextResponse.json({ session });
      }

      // ── Close session ──────────────────────────────────────────
      case "close": {
        const sessionId = body.sessionId as string;
        if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

        await closeSession(sessionId, userId);
        return NextResponse.json({ success: true });
      }

      // ── Screenshot ─────────────────────────────────────────────
      case "screenshot": {
        const sessionId = body.sessionId as string;
        if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

        const screenshot = await takeScreenshot(sessionId);
        if (!screenshot) return NextResponse.json({ error: "Failed to capture screenshot" }, { status: 500 });

        return NextResponse.json({ screenshot });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 30, 60);
export const POST = withRateLimit(handler, 20, 60);
