/**
 * LiTT LiveKit Agent Worker
 *
 * Server-side agent that joins a LiveKit room as a bot participant.
 * Handles the full voice round trip:
 *   user audio → STT (OpenAI Whisper) → LLM (OpenAI) → TTS (OpenAI) → assistant audio
 *
 * Built against @livekit/agents v1.6.2 (AgentSession-orchestrated architecture):
 *   - Agent       = instructions + tools (the "brain" config)
 *   - AgentSession = STT/LLM/TTS voice pipeline + room I/O orchestrator
 *   - session.start({ agent, room }) binds them and connects to LiveKit.
 *
 * LiveKit's built-in turn detection + VAD handle natural conversation and
 * barge-in automatically (when the user starts speaking while the agent is
 * responding, the agent stops mid-sentence).
 *
 * Events are sent to the browser via LiveKit data channel (publishData):
 *   { type: "user_transcript.delta", text: "..." }
 *   { type: "user_transcript.completed", text: "..." }
 *   { type: "assistant_transcript.completed", text: "..." }
 *   { type: "agent.thinking" }
 *   { type: "agent.speaking" }
 *   { type: "agent.idle" }
 *   { type: "tool.call", name: "...", args: {...}, callId: "..." }
 *   { type: "tool.result", name: "...", callId: "...", result: {...} }
 *
 * LiTT identity is preserved — the system instruction says "You are LiTT,
 * not OpenAI." The underlying provider is replaceable.
 *
 * Required env:
 *   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 *   OPENAI_API_KEY
 *   LITT_AGENT_WORKER_PORT (default 8081, for the worker's own liveness HTTP endpoint)
 *
 * This is a dedicated realtime voice worker entrypoint, compiled as ESM via
 * tsconfig.worker.json. It is intentionally separate from server.ts (the HTTP
 * terminal/tool server). Railway should run both processes independently.
 *
 * @see https://docs.livekit.io/agents/overview/
 */

import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import dotenv from "dotenv";
import path from "node:path";

// Load .env.local then .env (shared with the terminal server)
const cwd = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(cwd, f);
  try {
    dotenv.config({ path: p });
  } catch {}
}

import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  llm,
  zipFunctionCallsAndOutputs,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";

// ─── LiTT system instruction ────────────────────────────────────────────────

function buildLiTTInstruction(metadata: Record<string, unknown> | undefined): string {
  const parts: string[] = [
    "You are LiTT, the AI copilot, engineer, and creator inside LiTTree Lab Studios.",
    "You are NOT OpenAI or ChatGPT — you are LiTT. Never reveal the underlying provider.",
    "You are operating inside the Studio, a unified workspace for code, creation, and deployment.",
    "",
    "You can hear the user's voice. You respond with spoken audio.",
    "You can call tools to act on the user's behalf.",
    "",
    "SAFETY RULES:",
    "- Always ask for approval before: deployment, git push, file deletion, database migrations, secret changes, package installation.",
    "- Never execute destructive actions without explicit confirmation.",
    "- Be concise in spoken responses — avoid long monologues.",
    "- If you cannot hear the user, clearly state that audio is not connected.",
  ];

  if (metadata) {
    parts.push("", "CURRENT CONTEXT:");
    if (metadata.userName) parts.push(`- User: ${metadata.userName}`);
    if (metadata.projectName) parts.push(`- Project: ${metadata.projectName}`);
    if (metadata.repository) parts.push(`- Repository: ${metadata.repository}`);
    if (metadata.branch) parts.push(`- Branch: ${metadata.branch}`);
    if (metadata.currentMission) parts.push(`- Current Mission: ${metadata.currentMission}`);
    if (metadata.instructions) parts.push(`- Additional instructions: ${metadata.instructions}`);
  }

  return parts.join("\n");
}

// ─── Data channel helper ────────────────────────────────────────────────────

interface LiTTDataEvent {
  type: string;
  [key: string]: unknown;
}

async function sendEvent(ctx: JobContext, event: LiTTDataEvent): Promise<void> {
  try {
    const participant = ctx.room.localParticipant;
    if (!participant) {
      // Not connected yet (or already disconnected) — drop silently.
      return;
    }
    const encoded = new TextEncoder().encode(JSON.stringify(event));
    await participant.publishData(encoded, { reliable: true });
  } catch (err) {
    console.error("[litt-agent] failed to send data event:", err);
  }
}

// Safely parse a FunctionCall.args JSON string into an object.
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ─── Agent definition ───────────────────────────────────────────────────────

export default defineAgent({
  entry: async (ctx: JobContext) => {
    let metadata: Record<string, unknown> | undefined;
    const rawMetadata = ctx.job?.metadata;
    if (rawMetadata) {
      try {
        metadata = JSON.parse(rawMetadata);
      } catch {
        metadata = undefined;
      }
    }

    console.log(
      "[litt-agent] joining room:",
      ctx.room.name,
      "agentId:",
      metadata?.agentId ?? "(none)",
    );

    // Voice pipeline: OpenAI Realtime API (gpt-realtime — GA model).
    // Single streaming WebSocket handles STT + LLM + TTS together — audio in,
    // audio out with ~300-500ms to first audio byte (vs 2-5s with the old
    // 3-stage Whisper → gpt-4o-mini → gpt-4o-mini-tts batch pipeline).
    // inputAudioTranscription uses whisper-1 so user transcripts still arrive
    // via the UserInputTranscribed event for the data channel.
    //
    // Model history:
    //   gpt-4o-realtime-preview — deprecated/removed by OpenAI
    //   gpt-realtime — current GA speech-to-speech model (20% cheaper)
    const session = new AgentSession({
      llm: new openai.realtime.RealtimeModel({
        model: "gpt-realtime",
        voice: (metadata?.voice as openai.realtime.Voice) || "alloy",
        inputAudioTranscription: { model: "whisper-1" },
        // Server-side VAD with 500ms silence → endpoint. The Realtime API
        // handles turn detection natively; we keep the same 500ms silence
        // duration as the old endpointing config.
        turnDetection: {
          type: "server_vad",
          threshold: 0.7,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
        },
      }),
      // Barge-in (interruption) still enabled — the Realtime API supports
      // native interruption via truncate.
      turnHandling: {
        interruption: { enabled: true },
      },
    });

    // The Agent holds instructions + tools (the "brain"). Models are provided
    // by the session above.
    const agent = new Agent({
      instructions: buildLiTTInstruction(metadata),
    });

    // ─── Wire session events to the data channel BEFORE start ────────────

    // User speech transcripts (interim + final).
    session.on(AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      const text = ev.transcript;
      if (ev.isFinal) {
        sendEvent(ctx, { type: "user_transcript.completed", text });
      } else {
        sendEvent(ctx, { type: "user_transcript.delta", text });
      }
    });

    // Assistant messages added to the chat context (final assistant text).
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item instanceof llm.ChatMessage && item.role === "assistant") {
        const text = item.textContent;
        if (text) {
          sendEvent(ctx, { type: "assistant_transcript.completed", text });
        }
      }
    });

    // Agent state changes → thinking / speaking / idle.
    session.on(AgentSessionEventTypes.AgentStateChanged, (ev) => {
      switch (ev.newState) {
        case "thinking":
          sendEvent(ctx, { type: "agent.thinking" });
          break;
        case "speaking":
          sendEvent(ctx, { type: "agent.speaking" });
          break;
        case "idle":
        case "listening":
          sendEvent(ctx, { type: "agent.idle" });
          break;
        default:
          break;
      }
    });

    // LLM tool calls + outputs (paired). v1.6.2 emits a single event after
    // tools have executed, so we report both the call and its result together.
    session.on(AgentSessionEventTypes.FunctionToolsExecuted, (ev) => {
      for (const [call, output] of zipFunctionCallsAndOutputs(ev)) {
        sendEvent(ctx, {
          type: "tool.call",
          name: call.name,
          args: parseArgs(call.args),
          callId: call.callId,
        });
        sendEvent(ctx, {
          type: "tool.result",
          name: call.name,
          callId: call.callId,
          result: output.output,
        });
      }
    });

    // Start the session — connects to the room and wires room audio I/O.
    await session.start({ agent, room: ctx.room });

    console.log("[litt-agent] ready in room:", ctx.room.name);
  },
});

// ─── Worker entry point ─────────────────────────────────────────────────────

// The LiveKit agents framework (v1.6.2) forks child processes via IPC to run
// individual agent jobs. Each child imports this module to load the default
// export, which means all top-level code runs again in the child. We must NOT
// bind the liveness HTTP server or launch the CLI in child processes — only
// in the main/parent process.
//
// `process.send` exists only in forked children (Node IPC channel). In the
// main process it is undefined.
const isMainWorkerProcess = !process.send;

// Minimal liveness HTTP server for the worker. This is intentionally a
// process-alive probe only (equivalent to the terminal server's /health/live)
// and does NOT report voice-pipeline readiness. Keep it separate from the
// terminal server's /health readiness gate.
if (isMainWorkerProcess) {
  // Railway injects PORT automatically. Use it for the health endpoint so
  // Railway's healthcheck can reach us. LITT_AGENT_WORKER_PORT is an explicit
  // override (e.g. for local dev where PORT may be set by another process).
  // Default to 8082 (not 8081 — the LiveKit framework's internal broker uses 8081).
  const HEALTH_PORT = Number(process.env.LITT_AGENT_WORKER_PORT || process.env.PORT || 8082);

  const healthServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        service: "litt-livekit-worker",
        status: "alive",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }),
    );
  });

  healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
    console.log(`[litt-agent] liveness endpoint listening on 0.0.0.0:${HEALTH_PORT}/`);
  });

  // Run via the LiveKit agents CLI (spawns/coordinates worker processes).
  // Only the main process should start the CLI orchestrator.
  //
  // agentName enables explicit dispatch: the worker will NOT auto-join every
  // room. Instead, the browser token must specify `agentName: "litt"` in its
  // grants, or AgentDispatch.createDispatch must be called. This prevents
  // unrelated rooms from triggering the LiTT voice pipeline.
  // Override via LIVEKIT_AGENT_NAME env var if needed.
  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    cli.runApp(
      new ServerOptions({
        agent: fileURLToPath(import.meta.url),
        agentName: process.env.LIVEKIT_AGENT_NAME || "litt",
      }),
    );
  }
}
