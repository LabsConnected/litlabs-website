import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AccessToken, RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

export const runtime = "nodejs";

/**
 * POST /api/voice/livekit-token
 *
 * Creates (or reuses) a LiveKit room and issues an ephemeral access token
 * for the browser to connect via WebRTC. The LiTT Agent Worker joins the
 * same room separately using a server-side token (see terminal-server/livekit-agent.ts).
 *
 * Body: { roomName?: string, agentId?: string, instructions?: string, voice?: string }
 * Returns: { token: string, url: string, roomName: string }
 *
 * Required env:
 *   LIVEKIT_URL       — e.g. wss://your-project.livekit.cloud
 *   LIVEKIT_API_KEY   — LiveKit API key
 *   LIVEKIT_API_SECRET — LiveKit API secret
 *
 * @see https://docs.livekit.io/home/client/data/receiving-data/
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth(req);
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: "LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET." },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      roomName: requestedRoom,
      agentId,
      instructions,
      voice,
    } = body as {
      roomName?: string;
      agentId?: string;
      instructions?: string;
      voice?: string;
    };

    // Deterministic room name per user + agent so reconnection resumes the same room
    const roomName =
      requestedRoom ||
      `litt-${session.userId}-${agentId || "default"}-${Date.now().toString(36)}`;

    // Ensure the room exists (create is idempotent)
    const roomClient = new RoomServiceClient(
      livekitUrl.replace(/^wss?:\/\//, "https://"),
      apiKey,
      apiSecret,
    );
    try {
      await roomClient.createRoom({
        name: roomName,
        emptyTimeout: 10 * 60, // 10 min auto-close after everyone leaves
        maxParticipants: 4, // user + agent + spare
      });
    } catch {
      // Room may already exist — that's fine
    }

    // Explicit dispatch: tell LiveKit to send the LiTT agent worker to this
    // room. The worker registers with agentName "litt" (see livekit-agent.ts),
    // so without this dispatch call it will NOT auto-join the room.
    const agentName = process.env.LIVEKIT_AGENT_NAME || "litt";
    const dispatchClient = new AgentDispatchClient(
      livekitUrl.replace(/^wss?:\/\//, "https://"),
      apiKey,
      apiSecret,
    );
    let dispatchError: string | null = null;
    try {
      await dispatchClient.createDispatch(roomName, agentName);
    } catch (err) {
      // Dispatch may already exist for this room/agent — that's fine.
      // But surface real errors (auth, network, config) so the browser
      // knows the agent may not join. Don't silently swallow everything.
      const msg = err instanceof Error ? err.message : String(err);
      // "already exists" / "duplicate" errors are expected and safe to ignore
      if (!/already|exist|duplicate/i.test(msg)) {
        dispatchError = msg;
      }
    }

    // Build the browser token
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `user-${session.userId}`,
      metadata: JSON.stringify({
        agentId: agentId || "litt",
        instructions: instructions || "",
        voice: voice || "alloy",
        userId: session.userId,
      }),
      ttl: 60 * 60, // 1 hour
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true, // mic + camera
      canSubscribe: true, // assistant audio
      canPublishData: true, // data channel for events
    });

    const jwt = await token.toJwt();

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
      roomName,
      agentDispatched: dispatchError === null,
      ...(dispatchError ? { dispatchError } : {}),
    });
  } catch (err) {
    console.error("[livekit-token] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
