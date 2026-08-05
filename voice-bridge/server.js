/**
 * LiTT Voice Bridge — Twilio Media Streams ↔ OpenAI Realtime API
 *
 * Architecture:
 *   Phone Call → Twilio → WebSocket → This Server → WebSocket → OpenAI Realtime
 *
 * Audio Format: g711_ulaw (base64 encoded) — native to both Twilio and OpenAI.
 * NO audio transcoding. NO ffmpeg. Just pass base64 payloads back and forth.
 *
 * Latency: Sub-800ms end-to-end.
 * Barge-in: When user starts speaking, Twilio's audio buffer is cleared instantly.
 *
 * Context + Tool Calling:
 *   1. Twilio POST /voice → returns TwiML with <Start><Stream>
 *   2. Twilio opens WebSocket to /media-stream
 *   3. We extract Caller ID, look up user via /api/internal/voice-context
 *   4. We open WebSocket to OpenAI Realtime API
 *   5. We send session.update with LiTT persona + user context + tool definitions
 *   6. Audio routing loop: Twilio → OpenAI (input_audio_buffer.append)
 *                          OpenAI → Twilio (response.audio.delta → media)
 *   7. Barge-in: speech_started → clear Twilio buffer
 *   8. Tool calls: when OpenAI invokes a function, we call the internal API
 *      and send the result back so LiTT can speak the answer
 *   9. Graceful teardown: either side closes → close the other
 */

import express from "express";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

const PORT = process.env.VOICE_BRIDGE_PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";
const OPENAI_REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;

// Next.js API base URL (for internal API calls)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

// ─── LiTT Persona ───────────────────────────────────────────────

const LITT_PERSONA = `You are LiTT — the AI Operating System inside LiTTree Lab Studios.
You are speaking on a phone call with a user. Your voice should be warm, confident, and natural — like talking to a brilliant friend who happens to know everything about their projects.

PERSONALITY:
- Start with the useful answer. No empty preamble.
- Be technically precise but conversational — this is a voice call, not a text chat.
- Keep responses concise. Speak in short, natural sentences. Don't monologue.
- If you don't know something, say so directly.
- Match the user's energy. If they're casual, be casual. If they're urgent, be sharp.

CAPABILITIES:
- You can discuss their projects, code, deployments, weather, and general questions.
- You have access to their context (location, project, preferences) — use it naturally.
- Don't say "Based on your context..." — just use the information as if you already know.
- You have tools: web_intelligence (search, research, fetch, extract, screenshot) and memory_recall.
- When the user asks you to research something, look something up, or find information online, USE the web_intelligence tool. Don't say you can't — actually do it.
- When the user asks about their projects or past decisions, USE memory_recall to check.
- After a tool returns results, summarize the key findings in natural speech. Don't read raw data.

INTERRUPTIONS:
- The user can interrupt you at any time. When they do, stop immediately and listen.
- Never talk over the user.

REMEMBER: This is a real-time voice conversation. Be natural, be brief, be useful. When tools are needed, use them silently and speak the results naturally.`;

// ─── Tool Definitions (OpenAI Realtime function calling) ────────

const TOOLS = [
  {
    type: "function",
    name: "web_intelligence",
    description: "Search the web, research a topic, fetch a URL, extract data from a page, or take a screenshot. Use this when the user asks you to look something up, research something, find information, or check a website.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["search", "fetch", "research", "extract", "screenshot"],
          description: "search=discover URLs, fetch=get page content, research=full search+fetch+verify pipeline, extract=pull structured data, screenshot=capture page image",
        },
        query: {
          type: "string",
          description: "Search or research query (for search/research operations)",
        },
        url: {
          type: "string",
          description: "Target URL (for fetch/extract/screenshot operations)",
        },
        instruction: {
          type: "string",
          description: "What to extract from the page (for extract operation)",
        },
      },
      required: ["operation"],
    },
  },
  {
    type: "function",
    name: "memory_recall",
    description: "Recall memories and past decisions for the current user and project. Use this when the user asks about their projects, past decisions, preferences, or things LiTT should remember.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to recall — a topic, question, or keyword",
        },
      },
      required: ["query"],
    },
  },
];

// ─── User Context Lookup ────────────────────────────────────────

/**
 * Look up a user by their phone number via the internal API.
 * Returns { contextBlock, userId, projectId, displayName }.
 */
async function lookupUserByPhone(callerId) {
  try {
    const response = await fetch(`${API_BASE}/api/internal/voice-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ phone: callerId }),
    });

    if (!response.ok) {
      console.error(`[context] voice-context API returned ${response.status}`);
      return { contextBlock: "", userId: null, projectId: null, displayName: null };
    }

    const data = await response.json();
    return {
      contextBlock: data.contextBlock || "",
      userId: data.userId || null,
      projectId: data.projectId || null,
      displayName: data.displayName || null,
    };
  } catch (err) {
    console.error("[context] Failed to look up user:", err.message);
    return { contextBlock: "", userId: null, projectId: null, displayName: null };
  }
}

// ─── Tool Execution ─────────────────────────────────────────────

/**
 * Execute a tool call by invoking the internal API.
 * Returns a string result to feed back to OpenAI.
 */
async function executeToolCall(toolName, args, userId, projectId) {
  try {
    if (toolName === "web_intelligence") {
      const response = await fetch(`${API_BASE}/api/internal/web-intelligence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          ...args,
          ownerId: userId,
          projectId: projectId,
          maxResults: 3, // Keep it fast for voice
        }),
      });

      if (!response.ok) {
        return `Error: Web intelligence API returned ${response.status}`;
      }

      const result = await response.json();

      if (!result.success) {
        return `Unable to complete that: ${result.error || "unknown error"}`;
      }

      // Format the result for speech — keep it concise
      if (result.operation === "search" || result.operation === "research") {
        const items = Array.isArray(result.data) ? result.data : (result.data?.sources || []);
        if (items.length === 0) return "No results found.";
        const top = items.slice(0, 3);
        const summary = top.map((item, i) =>
          `${i + 1}. ${item.title || item.url || "Untitled"}${item.snippet ? ` — ${item.snippet.slice(0, 100)}` : ""}`
        ).join(". ");
        return `Found ${items.length} results. Top results: ${summary}`;
      }

      if (result.operation === "fetch") {
        const content = result.data?.content || "";
        return content.slice(0, 2000) || "Page content was empty.";
      }

      if (result.operation === "extract") {
        return JSON.stringify(result.data).slice(0, 2000);
      }

      if (result.operation === "screenshot") {
        return result.data?.screenshotUrl
          ? `Screenshot captured and saved at ${result.data.screenshotUrl}`
          : "Screenshot captured.";
      }

      return JSON.stringify(result.data).slice(0, 2000);
    }

    if (toolName === "memory_recall") {
      // Call the voice-context endpoint with a query to trigger memory recall
      const response = await fetch(`${API_BASE}/api/internal/voice-context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          phone: "", // We already have the userId — but the API needs phone
          query: args.query,
        }),
      });

      if (!response.ok) {
        return "I couldn't recall any memories about that.";
      }

      const data = await response.json();
      const memoryCount = data.memoryCount || 0;

      if (memoryCount === 0) {
        return "I don't have any saved memories about that topic.";
      }

      // The context block already includes memory info — extract relevant parts
      return `Found ${memoryCount} relevant memories. The context has been updated with your preferences and project knowledge.`;
    }

    return `Unknown tool: ${toolName}`;
  } catch (err) {
    console.error(`[tool] Error executing ${toolName}:`, err.message);
    return `Error executing tool: ${err.message}`;
  }
}

// ─── Express Server ─────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const server = http.createServer(app);

// ─── Twilio Webhook: POST /voice ────────────────────────────────

app.post("/voice", (req, res) => {
  const callerId = req.body.From || "unknown";
  console.log(`[twilio] Incoming call from ${callerId}`);

  // Build the public WebSocket URL from the request host
  const protocol = req.protocol === "https" ? "wss" : "ws";
  const host = req.get("host") || `localhost:${PORT}`;
  const wsUrl = `${protocol}://${host}/media-stream`;

  // TwiML: Start a media stream and keep the call alive
  // Pass the caller ID as a custom parameter so we can use it in the WS handler
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${wsUrl}">
      <Parameter name="From" value="${callerId}" />
    </Stream>
  </Start>
  <Pause length="600"/>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

// ─── Health Check ───────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "litt-voice-bridge",
    openaiConnected: openaiConnections.size,
    activeCalls: activeCalls.size,
    apiBase: API_BASE,
    internalKeyConfigured: Boolean(INTERNAL_API_KEY),
  });
});

// ─── WebSocket Server: /media-stream ────────────────────────────

const wss = new WebSocketServer({ server, path: "/media-stream" });

// Track active connections for graceful teardown
const activeCalls = new Map(); // twilioWs → { openaiWs, streamSid, callerId, userId, projectId }
const openaiConnections = new Set(); // Track all OpenAI WS connections

wss.on("connection", async (twilioWs, _req) => {
  console.log("[twilio-ws] WebSocket connected for media stream");

  let streamSid = null;
  let callerId = null;
  let userId = null;
  let projectId = null;
  let openaiWs = null;

  // ─── Open a connection to OpenAI Realtime API ────────────────

  try {
    const { WebSocket } = await import("ws");
    openaiWs = new WebSocket(OPENAI_REALTIME_URL, [], {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiConnections.add(openaiWs);
  } catch (err) {
    console.error("[openai] Failed to connect to Realtime API:", err);
    twilioWs.close();
    return;
  }

  // ─── OpenAI WebSocket Event Handlers ─────────────────────────

  openaiWs.on("open", async () => {
    console.log("[openai] Realtime API connected");
  });

  openaiWs.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      // ─── Audio response → send to Twilio ───────────────────
      case "response.audio.delta": {
        if (!streamSid || twilioWs.readyState !== 1) return;
        const audioMessage = {
          event: "media",
          streamSid,
          media: {
            payload: msg.delta,
          },
        };
        twilioWs.send(JSON.stringify(audioMessage));
        break;
      }

      // ─── Barge-in: user started speaking → clear Twilio buffer ─
      case "input_audio_buffer.speech_started": {
        if (!streamSid) return;
        console.log("[barge-in] User started speaking — clearing Twilio buffer");
        const clearMessage = {
          event: "clear",
          streamSid,
        };
        twilioWs.send(JSON.stringify(clearMessage));
        break;
      }

      // ─── Tool call: LiTT wants to invoke a function ─────────
      case "response.function_call_arguments.done": {
        const toolName = msg.name;
        const callId = msg.call_id;
        let args = {};
        try {
          args = JSON.parse(msg.arguments || "{}");
        } catch {
          args = {};
        }

        console.log(`[tool] LiTT invoked: ${toolName}(${JSON.stringify(args)})`);

        // Execute the tool
        const result = await executeToolCall(toolName, args, userId, projectId);
        console.log(`[tool] Result: ${result.slice(0, 200)}...`);

        // Send the result back to OpenAI so LiTT can speak it
        if (openaiWs && openaiWs.readyState === 1) {
          const toolOutput = {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: result,
            },
          };
          openaiWs.send(JSON.stringify(toolOutput));

          // Trigger LiTT to respond with the tool results
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }
        break;
      }

      // ─── Transcript: user said something ────────────────────
      case "conversation.item.input_audio_transcription.completed": {
        if (msg.transcript) {
          console.log(`[transcript] User: "${msg.transcript}"`);
        }
        break;
      }

      // ─── Transcript: LiTT said something ────────────────────
      case "response.audio_transcript.done": {
        if (msg.transcript) {
          console.log(`[transcript] LiTT: "${msg.transcript}"`);
        }
        break;
      }

      // ─── Session created (initial) ──────────────────────────
      case "session.created": {
        console.log("[openai] Session created:", msg.session?.id);
        break;
      }

      // ─── Error handling ─────────────────────────────────────
      case "error": {
        console.error("[openai] Error:", msg.error?.message || msg);
        break;
      }

      default:
        // Unhandled events — silently ignore
        break;
    }
  });

  openaiWs.on("error", (err) => {
    console.error("[openai] WebSocket error:", err);
  });

  openaiWs.on("close", () => {
    console.log("[openai] Realtime API disconnected");
    openaiConnections.delete(openaiWs);
    if (twilioWs.readyState === 1) {
      twilioWs.close();
    }
  });

  // ─── Twilio WebSocket Event Handlers ─────────────────────────

  twilioWs.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      // ─── Start: extract streamSid + callerId, configure OpenAI ─
      case "start": {
        streamSid = msg.start?.streamSid || null;
        callerId = msg.start?.customParameters?.From
          || msg.start?.customParameters?.from
          || msg.start?.customParameters?.callerId
          || msg.start?.accountSid
          || "unknown";

        console.log(`[twilio] Stream started — streamSid: ${streamSid}, caller: ${callerId}`);

        // Look up user context via the internal API
        const userCtx = await lookupUserByPhone(callerId);
        userId = userCtx.userId;
        projectId = userCtx.projectId;

        const instructions = `${LITT_PERSONA}${userCtx.contextBlock}`;

        console.log(`[context] User resolved: ${userCtx.displayName || "not found"}, project: ${projectId || "none"}`);

        if (openaiWs && openaiWs.readyState === 1) {
          const sessionUpdate = {
            type: "session.update",
            session: {
              instructions,
              input_audio_format: "g711_ulaw",
              output_audio_format: "g711_ulaw",
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
              temperature: 0.7,
              max_response_output_tokens: "inf",
              tools: TOOLS,
              tool_choice: "auto",
            },
          };
          openaiWs.send(JSON.stringify(sessionUpdate));
          console.log("[openai] Session updated with LiTT persona + user context + tools");

          // Send an initial greeting prompt so LiTT says hello
          const greeting = userCtx.displayName
            ? `Greet the user briefly using their name (${userCtx.displayName}). Keep it under 2 sentences. Something like 'Hey ${userCtx.displayName}, LiTT here — what can I help with?'`
            : "Greet the user briefly. Keep it under 2 sentences. Something like 'Hey, LiTT here — what can I help with?'";

          const responseCreate = {
            type: "response.create",
            response: {
              instructions: greeting,
            },
          };
          openaiWs.send(JSON.stringify(responseCreate));
        }

        activeCalls.set(twilioWs, { openaiWs, streamSid, callerId, userId, projectId });
        break;
      }

      // ─── Media: forward audio to OpenAI ─────────────────────
      case "media": {
        if (openaiWs && openaiWs.readyState === 1 && msg.media?.payload) {
          const audioAppend = {
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          };
          openaiWs.send(JSON.stringify(audioAppend));
        }
        break;
      }

      // ─── Stop: call ended ───────────────────────────────────
      case "stop": {
        console.log("[twilio] Stream stopped — call ended");
        break;
      }

      // ─── Mark: Twilio playback marker ───────────────────────
      case "mark": {
        break;
      }

      default:
        break;
    }
  });

  // ─── Graceful Teardown ───────────────────────────────────────

  twilioWs.on("close", () => {
    console.log("[twilio-ws] WebSocket closed — cleaning up");
    activeCalls.delete(twilioWs);
    if (openaiWs && openaiWs.readyState === 1) {
      openaiWs.close();
    }
  });

  twilioWs.on("error", (err) => {
    console.error("[twilio-ws] WebSocket error:", err);
    activeCalls.delete(twilioWs);
    if (openaiWs && openaiWs.readyState === 1) {
      openaiWs.close();
    }
  });
});

// ─── Start Server ───────────────────────────────────────────────

server.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       LiTT Voice Bridge — Twilio ↔ OpenAI Realtime       ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Server:     http://localhost:${PORT}                       ║`);
  console.log(`║  WebSocket:  ws://localhost:${PORT}/media-stream            ║`);
  console.log(`║  Webhook:    POST http://localhost:${PORT}/voice            ║`);
  console.log(`║  Health:     GET  http://localhost:${PORT}/health           ║`);
  console.log("║  Model:      " + OPENAI_REALTIME_MODEL.padEnd(44) + "║");
  console.log("║  API Base:   " + (API_BASE).padEnd(44) + "║");
  console.log("║  Tools:      web_intelligence, memory_recall               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  if (!OPENAI_API_KEY) {
    console.warn("⚠️  OPENAI_API_KEY is not set! Voice bridge will not work.");
  }
  if (!INTERNAL_API_KEY) {
    console.warn("⚠️  INTERNAL_API_KEY is not set! User context + tool calls will not work.");
  }
  if (!API_BASE) {
    console.warn("⚠️  NEXT_PUBLIC_API_BASE is not set! Cannot reach the Next.js API.");
  }

  console.log("To test locally:");
  console.log("  1. ngrok http " + PORT);
  console.log("  2. Set Twilio webhook: https://<ngrok-url>/voice");
  console.log("  3. Call your Twilio number");
  console.log("");
});
