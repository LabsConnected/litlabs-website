# LiTT Voice Bridge

Ultra-low-latency voice telephony bridge between **Twilio Media Streams** and the **OpenAI Realtime API** — with **full user context** and **tool calling**.

## Architecture

```
Phone Call → Twilio → WebSocket → This Server → WebSocket → OpenAI Realtime API
                                         ↓
                              Next.js Internal API
                              (user context + tools)
```

- **Audio format:** `g711_ulaw` (base64) — native to both Twilio and OpenAI. Zero transcoding.
- **Latency:** Sub-800ms end-to-end.
- **Barge-in:** When the user starts speaking, Twilio's audio buffer is cleared instantly so LiTT stops talking and listens.
- **Context injection:** The `LittUserContext` (location, project, preferences, memories) is injected into the OpenAI session instructions so LiTT knows who's calling.
- **Tool calling:** LiTT can invoke `web_intelligence` (search, research, fetch, extract, screenshot) and `memory_recall` mid-call. Results are spoken back naturally.

## What LiTT Can Do Over the Phone

| You say | LiTT does |
|---|---|
| "Research the best AI music players" | Invokes `web_intelligence` with `operation: "research"` → speaks the top results |
| "What's on hackernews.com right now?" | Invokes `web_intelligence` with `operation: "fetch"` → summarizes the page |
| "What did we decide about the auth architecture?" | Invokes `memory_recall` → speaks relevant memories |
| "Extract the pricing from stripe.com" | Invokes `web_intelligence` with `operation: "extract"` → speaks the structured data |
| "What's the weather?" | Uses your location from the Context Engine → answers directly |
| "How's my project going?" | Uses project context from the Context Engine → answers directly |

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp voice-bridge/env.example voice-bridge/.env
# Edit .env with your actual keys
```

You need:
- `OPENAI_API_KEY` — with Realtime API access
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
- A Twilio phone number
- `NEXT_PUBLIC_API_BASE` — URL of your running Next.js app (default: `http://localhost:3000`)
- `INTERNAL_API_KEY` — must match the `INTERNAL_API_KEY` in your Next.js `.env.local`

### 3. Set your phone number in Supabase

The voice bridge looks up users by phone number. Add your phone number (E.164 format) to the `users` table:

```sql
UPDATE users SET phone = '+1234567890' WHERE clerk_id = 'your-clerk-id';
```

### 4. Start the Next.js server

```bash
pnpm dev
```

The voice bridge calls the Next.js internal API for user context and tool execution, so Next.js must be running.

### 5. Start the voice bridge

```bash
node voice-bridge/server.js
```

The server runs on port 3001 by default.

### 6. Start ngrok

```bash
ngrok http 3001
```

Copy the ngrok HTTPS URL (e.g., `https://abc123.ngrok.io`).

### 7. Configure Twilio

1. Go to your [Twilio Console](https://console.twilio.com/)
2. Navigate to **Phone Numbers → Active Numbers**
3. Click your phone number
4. Under **Voice Configuration**, set:
   - **A CALL COMES IN** → **Webhook**
   - URL: `https://<your-ngrok-url>/voice`
   - Method: **HTTP POST**

### 8. Call your number

Pick up the phone and call your Twilio number. LiTT will answer in under a second, greet you by name, and handle anything you ask.

## How It Works

### TwiML Webhook (`POST /voice`)

When Twilio receives a call, it hits this endpoint. The server returns TwiML that tells Twilio to:
1. Start a media stream to `wss://<host>/media-stream`
2. Pass the caller's phone number as a custom parameter
3. Keep the call alive with a long pause

### User Context Lookup

When the WebSocket connects:
1. The server extracts the caller's phone number from Twilio's `start` event
2. It calls `POST /api/internal/voice-context` with the phone number
3. The Next.js API looks up the user in Supabase, recalls memories, and builds a full `LittUserContext` via the Context Engine
4. The formatted context is injected into the OpenAI session instructions

### Tool Calling

When LiTT decides to invoke a tool (e.g., "research the best X"):
1. OpenAI sends `response.function_call_arguments.done` with the tool name + arguments
2. The voice bridge calls the appropriate internal API endpoint
3. The result is sent back to OpenAI as a `function_call_output`
4. LiTT generates a natural-language summary and speaks it

### WebSocket Bridge (`/media-stream`)

1. **Start event** — Extract `streamSid` and caller ID. Look up user context. Send `session.update` to OpenAI with persona + context + tools.
2. **Media events** — Forward base64 `g711_ulaw` audio from Twilio → OpenAI as `input_audio_buffer.append`.
3. **Audio responses** — Forward `response.audio.delta` from OpenAI → Twilio as `media` messages.
4. **Barge-in** — When OpenAI sends `input_audio_buffer.speech_started`, send `clear` to Twilio.
5. **Tool calls** — When OpenAI sends `response.function_call_arguments.done`, execute the tool and send the result back.
6. **Transcripts** — Log user and LiTT transcripts to the console.
7. **Graceful teardown** — If either WebSocket closes, the other is closed immediately.

## Health Check

```bash
curl http://localhost:3001/health
```

Returns:
```json
{
  "status": "ok",
  "service": "litt-voice-bridge",
  "openaiConnected": 0,
  "activeCalls": 0,
  "apiBase": "http://localhost:3000",
  "internalKeyConfigured": true
}
```

## Production Notes

- Run behind a reverse proxy with TLS (not ngrok).
- Add rate limiting and authentication for the webhook endpoint.
- Monitor OpenAI Realtime API usage — it's billed per minute of audio.
- The `INTERNAL_API_KEY` must be a strong random string (32+ chars) and must match between the voice bridge and Next.js.
- For production, set `NEXT_PUBLIC_API_BASE` to your deployed Next.js URL.
