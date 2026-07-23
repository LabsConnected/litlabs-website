import { config } from "dotenv";
config({ path: "../.env.local" });
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { verifyVoiceToken } from "./auth";
import { buildSessionUpdate } from "./inworld-config";

const PORT = Number(process.env.VOICE_SERVER_PORT || 4002);
const ALLOWED_ORIGIN = process.env.VOICE_ALLOWED_ORIGIN || "http://localhost:3000";

const INWORLD_ENDPOINT = "wss://api.inworld.ai/api/v1/realtime/session";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());

const server = http.createServer(app);

app.get("/health", (_req, res) => {
  const apiKey = process.env.INWORLD_API_KEY;
  res.json({
    ok: true,
    inworldConfigured: !!apiKey,
    authConfigured: (process.env.VOICE_AUTH_SECRET?.length ?? 0) >= 32,
  });
});

const wss = new WebSocketServer({ server, path: "/voice" });

interface RelaySession {
  clientWs: WebSocket;
  inworldWs: WebSocket | null;
  userId: string;
  configured: boolean;
  interrupted: boolean;
}

const sessions = new Map<WebSocket, RelaySession>();

wss.on("connection", (clientWs: WebSocket, req) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const token = url.searchParams.get("token");

  let userId: string;
  try {
    userId = verifyVoiceToken(token).sub;
  } catch {
    clientWs.close(4001, "Unauthorized");
    return;
  }

  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    clientWs.close(4002, "Inworld API key not configured");
    return;
  }

  const session: RelaySession = {
    clientWs,
    inworldWs: null,
    userId,
    configured: false,
    interrupted: false,
  };
  sessions.set(clientWs, session);

  console.log(`[Voice] Client connected: ${userId}`);

  // Open WebSocket to Inworld
  const timestamp = Date.now();
  const inworldUrl = `${INWORLD_ENDPOINT}?key=voice-${timestamp}&protocol=realtime`;

  const inworldWs = new WebSocket(inworldUrl, {
    headers: {
      Authorization: `Basic ${apiKey}`,
    },
  });

  session.inworldWs = inworldWs;

  // --- Inworld → Client relay ---
  inworldWs.on("open", () => {
    console.log(`[Voice] Inworld connected for ${userId}`);
    // Send session.update with LiTT config
    const sessionUpdate = buildSessionUpdate();
    inworldWs.send(JSON.stringify(sessionUpdate));
  });

  inworldWs.on("message", (data: Buffer) => {
    const message = data.toString("utf8");

    // Parse to handle special events
    try {
      const event = JSON.parse(message);

      // On session.updated, notify client
      if (event.type === "session.created") {
        console.log(`[Voice] Session created for ${userId}`);
      }

      if (event.type === "session.updated") {
        session.configured = true;
        console.log(`[Voice] Session configured for ${userId}`);
      }

      // On speech_started, mark interrupted so we can discard buffered audio
      if (event.type === "input_audio_buffer.speech_started") {
        session.interrupted = true;
      }

      // On new response starting, clear interrupted flag
      if (event.type === "response.done") {
        session.interrupted = false;
      }
    } catch {
      // Non-JSON, pass through
    }

    // Forward all messages to client
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });

  inworldWs.on("error", (err: Error) => {
    console.error(`[Voice] Inworld error for ${userId}:`, err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: "error",
        message: "Voice provider error. Please try again.",
      }));
    }
  });

  inworldWs.on("close", (code: number, reason: Buffer) => {
    console.log(`[Voice] Inworld closed for ${userId}: ${code} ${reason.toString()}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, "Voice session ended");
    }
  });

  // --- Client → Inworld relay ---
  clientWs.on("message", (data: Buffer) => {
    if (!inworldWs || inworldWs.readyState !== WebSocket.OPEN) return;

    try {
      const message = JSON.parse(data.toString("utf8"));

      // Forward allowed message types to Inworld
      const allowedTypes = [
        "input_audio_buffer.append",
        "input_audio_buffer.commit",
        "conversation.item.create",
        "response.create",
        "response.cancel",
      ];

      if (allowedTypes.includes(message.type)) {
        inworldWs.send(JSON.stringify(message));
      }
    } catch {
      // Non-JSON or parse error — ignore
    }
  });

  clientWs.on("close", () => {
    console.log(`[Voice] Client disconnected: ${userId}`);
    if (inworldWs.readyState === WebSocket.OPEN || inworldWs.readyState === WebSocket.CONNECTING) {
      inworldWs.close();
    }
    sessions.delete(clientWs);
  });

  clientWs.on("error", (err: Error) => {
    console.error(`[Voice] Client error for ${userId}:`, err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🎙️  LiTTree Voice Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`   Inworld configured: ${!!process.env.INWORLD_API_KEY}`);
  console.log(`   Auth configured: ${(process.env.VOICE_AUTH_SECRET?.length ?? 0) >= 32}`);
});
