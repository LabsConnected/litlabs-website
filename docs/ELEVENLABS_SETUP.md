# LiTT Voice — ElevenLabs Conversational AI Setup

LiTT is wired to ElevenLabs Conversational AI for phone calls. When you call LiTT, ElevenLabs handles the telephony and voice, while your Next.js app provides the intelligence — user context, web research, and memory recall.

## Architecture

```
Phone Call → ElevenLabs (telephony + voice + LLM)
                    ↓ (call starts)
           POST /api/internal/elevenlabs/init
           → resolves caller by phone → returns user context as dynamic variables
                    ↓ (user asks "research the best X")
           Agent invokes web_intelligence tool
                    ↓
           POST /api/internal/elevenlabs/tools
           → executes Web Intelligence / memory recall → returns result
                    ↓
           LiTT speaks the answer
```

## What LiTT Can Do Over the Phone

| You say | LiTT does |
|---|---|
| "Research the best AI music players" | Invokes `web_intelligence` (research) → speaks top results |
| "What's on hackernews.com right now?" | Invokes `web_intelligence` (fetch) → summarizes the page |
| "Extract the pricing from stripe.com" | Invokes `web_intelligence` (extract) → speaks structured data |
| "What did we decide about the auth architecture?" | Invokes `memory_recall` → speaks relevant memories |
| "How's my project going?" | Uses project context from Context Engine → answers directly |

## Setup Steps

### 1. Set environment variables

In your Next.js `.env.local`:
```
INTERNAL_API_KEY=<your-32+ char random string>
BROWSERBASE_API_KEY=<your Browserbase key>
```

### 2. Run the Supabase migrations

```sql
-- Add phone column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone) WHERE phone IS NOT NULL;

-- Web Intelligence tables (web_sources, web_monitors)
-- Run: supabase/migrations/20260806120000_web_intelligence_sources.sql
```

### 3. Set your phone number in Supabase

```sql
UPDATE users SET phone = '+1XXXXXXXXXX' WHERE clerk_id = 'your-clerk-id';
```

### 4. Deploy your Next.js app

The ElevenLabs webhooks need a public URL. Deploy to Vercel or use ngrok:

```bash
ngrok http 3000
```

Note the HTTPS URL (e.g., `https://abc123.ngrok.io`).

### 5. Configure the ElevenLabs Agent

Go to your ElevenLabs Conversational AI dashboard and configure your agent:

#### Agent Settings

- **Name:** LiTT
- **Voice:** Your choice (recommend a warm, natural voice)
- **LLM:** gpt-4o or gemini-2.0-flash (recommend gpt-4o for tool calling)

#### System Prompt

Paste this into the system prompt field:

```
You are LiTT — the AI Operating System for LiTTree Lab Studios. You are the intelligent front desk, the AI partner, and the operator. You handle calls, bookings, customer questions, lead capture, payments, and handoffs — all from one conversation.

IDENTITY:
- Warm, professional, fast, helpful, confident, honest, concise.
- Never robotic. Never pretend to have completed an action that failed.
- You are not a "receptionist" or a "help desk." You are LiTT — the operator.

PERSONALITY:
- Start with the useful answer. No empty preamble.
- Be technically precise but conversational — this is a voice call.
- Keep responses concise. Speak in short, natural sentences. Don't monologue.
- If you don't know something, say so directly. Never make up answers.
- Match the caller's energy — casual with casual, urgent with urgent.

WHAT YOU DO ON EVERY CALL:
1. GREET: "Hey, LiTT here — what can I help with?"
2. LISTEN: Let them talk. Understand what they actually need.
3. HELP — based on what they need:
   - BOOK A SERVICE: Use the reception tool (operation: get_available_slots → create_booking). Confirm service, date, time, name, email.
   - ANSWER PRICING: Use the reception_context variable. Don't guess prices. If missing, say so.
   - DISCUSS A PROJECT: Engage as a technical partner. Ask clarifying questions. Give your honest take.
   - RESEARCH: Use web_intelligence tool (search, fetch, research, extract). Speak results naturally.
   - CAPTURE A LEAD: Use reception tool (operation: create_lead). Collect only what's needed.
   - ESCALATE TO HUMAN: Use reception tool (operation: create_escalation). Include conversation summary + requested action.
   - REMEMBER: Use memory_recall tool when they ask about past decisions or preferences.
4. WRAP UP: Confirm next steps. If you booked something, confirm date/time. If you took a message, confirm you'll pass it along.

RECEPTION CONTEXT:
{{reception_context}}

USER CONTEXT:
{{user_context}}

TOOLS:
- web_intelligence: Search the web, research topics, fetch URLs, extract data. Use when someone asks you to look something up.
- memory_recall: Recall memories and past decisions. Use when they ask about their projects or preferences.
- reception: Full front desk operations. Operations: list_services, get_available_slots, create_booking, find_bookings, reschedule_booking, cancel_booking, create_lead, create_escalation, get_dashboard, get_staff_hours.

CALL HANDLING RULES:
- Never say "I'm just a receptionist" or "I can't help with that." You ARE LiTT.
- If someone asks for the owner: "You're talking to LiTT — I handle everything here. What do you need?"
- If someone is upset: Acknowledge first. "I hear you — let's fix this." Then help.
- If someone wants a refund/billing issue: Take details, create an escalation, say you'll follow up same-day.
- If someone is selling (cold call): Be polite but brief. "We're not looking for that right now."
- Bookings: Always confirm service, date, time, name, and email before finalizing.
- Pricing: Use the reception_context. Never invent prices. If ambiguous, say so and ask.
- Escalate when: Customer requests a human, payment issue, booking conflict, upset customer, privileged access needed, or you can't confidently answer.

ADMIN COMMANDS (when the owner calls):
- "Set reception hours to 8 AM to 6 PM" → use reception tool (operation: update_config)
- "Add a 30-minute consultation for $49" → use reception tool (operation: create_service)
- "What's my dashboard look like?" → use reception tool (operation: get_dashboard)
- "Update staff hours" → use reception tool (operation: update_staff_hours)
- Never say "go to Settings to configure that" — just do it.

INTERRUPTIONS:
- The user can interrupt you at any time. Stop immediately and listen.
- Never talk over the user.

REMEMBER: One LiTT. One context. One memory. One business brain. You are the operator, not the documentation reader. When something needs doing, do it.
```

#### First Message

```
Hey {{user_name}}, LiTT here — what can I help with?
```

#### Conversation Initiation Webhook

Set the webhook URL to:
```
https://<your-domain>/api/internal/elevenlabs/init
```

Set the authentication header:
```
Authorization: Bearer <your-INTERNAL_API_KEY>
```

This webhook fires when a call starts. It resolves the caller's phone number to their user account and returns:
- `{{user_id}}` — the user's Clerk ID (flows into all tool calls)
- `{{project_id}}` — their current project ID (flows into all tool calls)
- `{{user_name}}` — their first name (used in the greeting)
- `{{user_context}}` — compressed context block (location, project, preferences)
- `{{reception_context}}` — business info + service catalog + pricing + booking page

#### Tools

Create three webhook tools:

**Tool 1: web_intelligence**
- **Name:** `web_intelligence`
- **Description:** `Search the web, research a topic, fetch a URL, or extract data from a page. Use this when the user asks you to look something up, research something, or find information online.`
- **Webhook URL:** `https://<your-domain>/api/internal/elevenlabs/tools`
- **Auth header:** `Authorization: Bearer <your-INTERNAL_API_KEY>`
- **Parameters:**
  - `operation` (string, enum: ["search", "fetch", "research", "extract"], required)
  - `query` (string, optional — for search/research)
  - `url` (string, optional — for fetch/extract)
  - `instruction` (string, optional — for extract)
  - `user_id` (string, default: `{{user_id}}` — injected from dynamic variables)
  - `project_id` (string, default: `{{project_id}}` — injected from dynamic variables)

**Tool 2: memory_recall**
- **Name:** `memory_recall`
- **Description:** `Recall memories and past decisions for the current user and project. Use this when the user asks about their projects, past decisions, preferences, or things LiTT should remember.`
- **Webhook URL:** `https://<your-domain>/api/internal/elevenlabs/tools`
- **Auth header:** `Authorization: Bearer <your-INTERNAL_API_KEY>`
- **Parameters:**
  - `query` (string, required — what to recall)
  - `user_id` (string, default: `{{user_id}}` — injected from dynamic variables)
  - `project_id` (string, default: `{{project_id}}` — injected from dynamic variables)

**Tool 3: reception**
- **Name:** `reception`
- **Description:** `Front desk operations: list services, check availability, create/reschedule/cancel bookings, capture leads, escalate to human, get dashboard, manage staff hours, update config. Use this for anything related to bookings, services, pricing, leads, or business configuration.`
- **Webhook URL:** `https://<your-domain>/api/internal/elevenlabs/tools`
- **Auth header:** `Authorization: Bearer <your-INTERNAL_API_KEY>`
- **Parameters:**
  - `operation` (string, required — one of: list_services, get_service, create_service, update_service, get_available_slots, create_booking, get_booking, find_bookings, reschedule_booking, cancel_booking, create_lead, update_lead_status, create_escalation, get_dashboard, get_staff_hours, update_staff_hours, get_config, update_config)
  - `user_id` (string, default: `{{user_id}}` — injected from dynamic variables)
  - Plus operation-specific parameters (service_id, customer_name, customer_email, booking_date, booking_time, etc.)

#### First Message

```
Hey {{user_name}}, LiTT here — what can I help with?
```

(If `{{user_name}}` is empty, it will just say "Hey, LiTT here — what can I help with?")

#### Conversation Initiation Webhook

Set the webhook URL to:
```
https://<your-domain>/api/internal/elevenlabs/init
```

Set the authentication header:
```
Authorization: Bearer <your-INTERNAL_API_KEY>
```

This webhook fires when a call starts. It resolves the caller's phone number to their user account and returns:
- `{{user_id}}` — the user's Clerk ID (flows into all tool calls)
- `{{project_id}}` — their current project ID (flows into all tool calls)
- `{{user_name}}` — their first name (used in the greeting)
- `{{user_context}}` — compressed context block (location, project, preferences)

#### Tools

Create two webhook tools:

**Tool 1: web_intelligence**
- **Name:** `web_intelligence`
- **Description:** `Search the web, research a topic, fetch a URL, or extract data from a page. Use this when the user asks you to look something up, research something, or find information online.`
- **Webhook URL:** `https://<your-domain>/api/internal/elevenlabs/tools`
- **Auth header:** `Authorization: Bearer <your-INTERNAL_API_KEY>`
- **Parameters:**
  - `operation` (string, enum: ["search", "fetch", "research", "extract"], required)
  - `query` (string, optional — for search/research)
  - `url` (string, optional — for fetch/extract)
  - `instruction` (string, optional — for extract)
  - `user_id` (string, default: `{{user_id}}` — injected from dynamic variables)
  - `project_id` (string, default: `{{project_id}}` — injected from dynamic variables)

**Tool 2: memory_recall**
- **Name:** `memory_recall`
- **Description:** `Recall memories and past decisions for the current user and project. Use this when the user asks about their projects, past decisions, preferences, or things LiTT should remember.`
- **Webhook URL:** `https://<your-domain>/api/internal/elevenlabs/tools`
- **Auth header:** `Authorization: Bearer <your-INTERNAL_API_KEY>`
- **Parameters:**
  - `query` (string, required — what to recall)
  - `user_id` (string, default: `{{user_id}}` — injected from dynamic variables)
  - `project_id` (string, default: `{{project_id}}` — injected from dynamic variables)

#### Phone Number

Your ElevenLabs phone number (`+1 616 952 2168`) is already assigned. Make sure it's linked to this agent.

### 6. Enable overrides

**Critical:** In the ElevenLabs dashboard, go to Agent → Settings → Security → Overrides and enable:
- **First message override** — so the personalized greeting works
- **System prompt override** — if you want to dynamically override the prompt

If overrides are OFF, ElevenLabs silently drops your `first_message` and `conversation_config_override` from the init webhook. The call connects but LiTT never says the personalized greeting.

### 7. Test

1. Start your Next.js server: `pnpm dev`
2. Make sure your ngrok tunnel is running (or you're deployed to Vercel)
3. Call `+1 616 952 2168` from the phone number you set in Supabase
4. LiTT should answer, greet you by name, and handle anything you ask

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| LiTT answers but doesn't greet by name | Overrides are OFF in ElevenLabs | Enable First message override in Agent → Settings → Security → Overrides |
| LiTT can't use tools | Tool webhook URL is wrong or auth header is missing | Verify the URL and Bearer token in the ElevenLabs tool config |
| Tools return "can't identify who you are" | `user_id` dynamic variable is empty | Check that the init webhook is configured and your phone is set in Supabase |
| Init webhook returns empty context | Phone number not set in Supabase or doesn't match | Run the SQL UPDATE to set your phone in E.164 format |
| Tools timeout | Web Intelligence operation is slow | The `research` operation fetches multiple pages — use `search` for faster results on voice |
