import { NextRequest, NextResponse } from "next/server";
import { processPendingGenerations } from "@/lib/music/generation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/music/worker
 *
 * Durable worker endpoint that processes pending and stale music generations.
 *
 * This solves the serverless background-job problem: instead of relying on
 * `void processGeneration()` after the HTTP response (which can freeze on
 * Vercel), this endpoint is called to process queued jobs synchronously.
 *
 * Can be triggered by:
 *   - Vercel Cron (vercel.json schedule)
 *   - The client polling the status and detecting a stale job
 *   - A manual admin call
 *
 * Security: protected by a shared secret header (MUSIC_WORKER_SECRET).
 * In development with no secret configured, the endpoint is open.
 */
async function handler(req: NextRequest) {
  const workerSecret = process.env.MUSIC_WORKER_SECRET;
  if (workerSecret) {
    const provided = req.headers.get("x-worker-secret");
    if (provided !== workerSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await processPendingGenerations();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker failed";
    console.error(`[music:worker] error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handler;
export const GET = handler;
