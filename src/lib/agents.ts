// Agent Orchestrator System - LiTTree-LabStudios
// 5 consolidated, role-merged agents with project-context awareness
import { generateText } from "@/lib/llm";
import { mergeLittIdentityWithProject } from "@/lib/litt-identity";

export interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  systemPrompt: string;
  status: "online" | "offline" | "busy";
  lastActivity: Date;
  memory: string[];
  /** Which capability domains this agent covers */
  domains: string[];
  /** Short tag shown in terminal sidebar */
  tag: string;
  /** Brand hex colour for the terminal UI */
  color: string;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  type: "chat" | "command" | "insight" | "task";
  metadata?: Record<string, unknown>;
}

export interface AgentConversation {
  id: string;
  participants: string[];
  messages: AgentMessage[];
  topic: string;
  status: "active" | "paused" | "completed";
  startedAt: Date;
  lastMessageAt: Date;
}

/** Per-user project context injected into every agent call */
export interface ProjectContext {
  name?: string;
  description?: string;
  stack?: string;
  goals?: string;
  repoUrl?: string;
  customInstructions?: string;
}

/* ------------------------------------------------------------------ */
/*  Helper — inject project context into a system prompt               */
/* ------------------------------------------------------------------ */
export function buildSystemPrompt(base: string, ctx?: ProjectContext): string {
  // 1) Static project identity (always on). This is the part that makes
  //    the system "know we're working on litlabs.net" without being told.
  const identity = mergeLittIdentityWithProject(ctx);

  // 2) Agent's own system prompt on top, so role/personality rules win.
  return `${identity}\n\n---\n\n${base}`;
}

/* ------------------------------------------------------------------ */
/*  2 consolidated agents: LiTT-Code + LiTTle-Bit                      */
/* ------------------------------------------------------------------ */
export const AGENTS: Record<string, Agent> = {

  /* ── 1. LiTT-Code — Engineering, Build, Architecture, DevOps ─────── */
  littcode: {
    id: "littcode",
    name: "LiTT-Code",
    role: "Engineer & Architect",
    tag: "CODE",
    color: "#22d3ee",
    domains: ["code", "architecture", "debugging", "devops", "api", "database", "typescript", "react", "nextjs", "supabase", "vercel"],
    personality: "Technically precise, opinionated on quality, ships fast, no preamble",
    status: "online",
    lastActivity: new Date(),
    memory: [],
    systemPrompt: `You are LiTT-Code — senior engineer and architect at LiTTree-LabStudios. You think in systems, write clean TypeScript, and ship production-ready code. You'll tell someone when their code isn't good — once, briefly, with the fix.

PERSONALITY:
- No preamble. Cut straight to the solution or the question that unblocks it.
- Technically precise. Handwaving implementation details is not your style.
- Share opinions on architecture, naming, and patterns — with reasons, not dogma.
- Dry humor about tech debt is fine. Condescension isn't.

CORE STACK:
TypeScript · React 19 · Next.js 16 (App Router) · Supabase (Postgres + Auth + RLS) · Clerk · Tailwind 4 · Gemini API · OpenRouter · Vercel · Node.js · REST + WebSockets

CAPABILITIES:
- Write, review, refactor, and debug code in any of the above
- Design API routes, database schemas, RLS policies
- Architect agent systems, streaming endpoints, real-time features
- Explain complex code simply when asked
- Catch security issues, race conditions, memory leaks
- Suggest specific libraries with reasons

When the user's project context includes a stack or repo, adapt all recommendations to it. If you write code, write production-ready code — not toy examples. If something is wrong, say why in one sentence, then fix it.

Default response: code first, brief explanation after only if it adds value.

---------------------------------------------------------------
CONVERSATIONAL TURN RULE (NON-NEGOTIABLE - overrides everything above)
---------------------------------------------------------------
The user is talking to you live, often by voice. Structure every turn like a back-and-forth, NOT a memo.

- ONE question per turn. Never bundle two questions in one message.
- NEVER list more than 2 ideas or facts before asking. If you have more, hold them for the next turn.
- DO NOT dump project conventions, file structure, or "here's how we do things" unsolicited. The user already knows. Only surface them if the user explicitly asks "what are the conventions?" or the answer is the only way to unblock them.
- When you need information to proceed, ask FIRST. Do not preemptively write code based on guesses.
- If the user's request is ambiguous, ask one short clarifying question instead of guessing and producing a wall of options.
- When you do produce options, format them as a short numbered list (max 3) the user can tap, NOT a long markdown comparison.
- Prefer short responses (2-5 sentences) unless the user explicitly asks for a deep dive. If the answer is longer than ~120 words, break it into multiple turns yourself: answer the first part, then ask if they want the rest.
- Never repeat facts you already stated earlier in the conversation.
- For voice: keep replies to ~2 sentences so they finish speaking in under 12 seconds.

IMAGE GENERATION EXCEPTION:
If the user asks to generate/create/make/draw an image and does not provide a specific prompt, do NOT ask them to describe it. Infer the image prompt from the project context, file names, and conversation, or generate a sensible default for the project. State the prompt you are using and confirm the image is ready.`,
  },

  /* ── 2. LiTTle-Bit — Everything else: strategy, creative, ops ────── */
  littlebit: {
    id: "littlebit",
    name: "LiTTle-Bit",
    role: "Director, Growth, Creative & Operations",
    tag: "BIT",
    color: "#e879f9",
    domains: ["strategy", "orchestration", "general", "planning", "qa", "marketing", "content", "seo", "analytics", "copywriting", "social", "growth", "data", "image-generation", "visual", "brand", "design", "creative", "ui", "ux", "storytelling", "music", "audio", "sound", "home-assistant", "automation", "iot", "integrations", "webhooks", "smart-home"],
    personality: "Sharp, strategic, creative, and loyal — the operator that ties everything together",
    status: "online",
    lastActivity: new Date(),
    memory: [],
    systemPrompt: `You are LiTTle-Bit — the Director of Operations at LiTTree-LabStudios. You handle everything that isn't pure engineering: strategy, growth, content, creative direction, brand, and integrations. You're not a stiff assistant. You have personality: sharp, confident, occasionally sardonic, and deeply loyal to the user (address them as "{userName}" when it feels natural — not every message).

PERSONALITY:
- Short punchy sentences. No filler words, no hedge phrases.
- Opinions when warranted — if something's a bad idea, say so once, cleanly.
- Reference conversation context naturally. Never repeat what was just said.
- Wit is allowed. Dark humor on occasion. Never sycophantic.
- Match the user's energy: casual gets casual, depth gets depth.

WHAT YOU KNOW ABOUT THIS PLATFORM:
- LiTTree-LabStudios: creator platform with AI agents, Studio (image/video/audio gen), social feed, marketplace, game emulator
- Stack: Next.js 16, React 19, TypeScript, Supabase, Clerk Auth, Stripe, Google Gemini 2.5 Flash, OpenRouter
- Deployed on Vercel → litlabs.net
- 2 active agents: LiTT-Code (engineering) and LiTTle-Bit (you)
- Mission: become the go-to creator network with AI agents at the center

CAPABILITIES:
- Strategy, planning, roadmap advice
- Growth, marketing, content, SEO, and analytics
- Creative direction, image prompts, brand, UI/UX feedback
- Home automation, integrations, webhooks, IoT guidance
- Coordinating and describing what LiTT-Code can do
- Project reviews, priority calls, business questions

When the user shares project context, immediately internalize it and reference it throughout the conversation. If you don't know something specific about their project, ask one focused question.

IMAGE GENERATION RULE:
When the user asks to generate/create/make/draw an image, do NOT ask them for a description. Infer the image prompt from the project context, file names, and conversation. If no clear direction exists, generate a sensible default image for the project and state the prompt you are using. Confirm the image is ready.

Keep responses tight: 2-4 sentences unless deep detail is explicitly needed.`,
  },
};

// Agent Orchestrator Class
export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private conversations: Map<string, AgentConversation> = new Map();
  private messageHandlers: ((msg: AgentMessage) => void)[] = [];

  constructor() {
    // Initialize agents
    Object.values(AGENTS).forEach((agent) => {
      this.agents.set(agent.id, { ...agent });
    });
  }

  // Get agent by ID
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  // Get all agents
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // Update agent status
  setAgentStatus(id: string, status: Agent["status"]): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      agent.lastActivity = new Date();
    }
  }

  // Add message to agent memory
  addToMemory(agentId: string, message: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.memory.push(message);
      // Keep only last 20 memories
      if (agent.memory.length > 20) {
        agent.memory = agent.memory.slice(-20);
      }
    }
  }

  // Create a conversation between agents
  createConversation(participants: string[], topic: string): AgentConversation {
    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const conversation: AgentConversation = {
      id,
      participants,
      messages: [],
      topic,
      status: "active",
      startedAt: new Date(),
      lastMessageAt: new Date(),
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  // Send message between agents
  sendMessage(
    from: string,
    to: string,
    content: string,
    type: AgentMessage["type"] = "chat",
    metadata?: Record<string, unknown>,
  ): AgentMessage {
    const message: AgentMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      from,
      to,
      content,
      timestamp: new Date(),
      type,
      metadata,
    };

    // Add to sender and receiver memory
    this.addToMemory(from, `To ${to}: ${content}`);
    this.addToMemory(to, `From ${from}: ${content}`);

    // Notify handlers
    this.messageHandlers.forEach((handler) => handler(message));

    return message;
  }

  // Add message to specific conversation
  addMessageToConversation(
    conversationId: string,
    message: AgentMessage,
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.messages.push(message);
      conversation.lastMessageAt = new Date();
    }
  }

  // Get conversation by ID
  getConversation(id: string): AgentConversation | undefined {
    return this.conversations.get(id);
  }

  // Get all active conversations
  getActiveConversations(): AgentConversation[] {
    return Array.from(this.conversations.values()).filter(
      (c) => c.status === "active",
    );
  }

  // Subscribe to messages
  onMessage(handler: (msg: AgentMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  // Generate real AI agent response using the unified LLM client with failover
  async simulateAgentResponse(
    agentId: string,
    incomingMessage: string,
    conversationContext?: string,
    projectContext?: ProjectContext,
  ): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) return "Unknown agent";

    try {
      const systemPromptWithCtx = buildSystemPrompt(agent.systemPrompt, projectContext);
      const recentMemory = agent.memory.slice(-5).filter(Boolean).join("\n");

      const prompt = `${systemPromptWithCtx}

${conversationContext ? `CONVERSATION CONTEXT:\n${conversationContext}\n` : ""}${recentMemory ? `RECENT MEMORY:\n${recentMemory}\n` : ""}
USER: ${incomingMessage}

Respond as ${agent.name}. Stay in character. Be direct and useful. Match the user's energy.`;

      const r = await generateText(prompt, { task: "chat" });
      return r.text || "I'm processing that...";
    } catch {
      return `${agent.name} is thinking... (AI service temporarily unavailable)`;
    }
  }

  // Start background conversation between two agents with AI-generated opener
  async startBackgroundConversation(
    agent1Id: string,
    agent2Id: string,
    topic: string,
  ): Promise<AgentConversation> {
    const conversation = this.createConversation([agent1Id, agent2Id], topic);
    const agent1 = this.agents.get(agent1Id);
    const agent2 = this.agents.get(agent2Id);

    if (!agent1 || !agent2) return conversation;

    // Generate AI-powered initial message
    const prompt = `${agent1.systemPrompt}

Personality: ${agent1.personality}
Role: ${agent1.role}

You're starting a conversation with ${agent2.name} (a ${agent2.role}) about: ${topic}

Write a brief, natural opening message to kick off this discussion. Be conversational and show enthusiasm for the topic. 1-2 sentences max.`;

    let initialContent: string;
    try {
      const r = await generateText(prompt, { task: "creative" });
      initialContent = r.text || `Hey ${agent2.name}, let's work on ${topic}!`;
    } catch {
      // Fallback to natural starters
      const fallbackStarters: Record<string, string> = {
        director: `${agent2.name}, let's lock in on ${topic}. What's your read?`,
        forge: `${agent2.name} — ${topic}. What's the current architecture look like?`,
        pulse: `${agent2.name}, got some data on ${topic} worth discussing. Quick sync?`,
        "visionary": `${agent2.name}, thinking about the visual angle on ${topic}. Got ideas.`,
        home: `${agent2.name}, checking the integration state for ${topic}. Stand by.`,
      };
      initialContent =
        fallbackStarters[agent1Id] ||
        `Hey ${agent2.name}, let's work on ${topic}!`;
    }

    const initialMsg = this.sendMessage(
      agent1Id,
      agent2Id,
      initialContent,
      "task",
    );
    this.addMessageToConversation(conversation.id, initialMsg);

    return conversation;
  }

  // Continue background conversation with AI-generated responses
  async continueConversation(
    conversationId: string,
  ): Promise<AgentMessage | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.status !== "active") return null;

    const lastMsg = conversation.messages[conversation.messages.length - 1];
    if (!lastMsg) return null;

    // Determine who should respond
    const responderId = lastMsg.to;
    const senderId = lastMsg.from;
    const responder = this.agents.get(responderId);
    const sender = this.agents.get(senderId);

    if (!responder || !sender) return null;

    // Build conversation context from recent messages
    const contextMessages = conversation.messages.slice(-6);
    const conversationContext = contextMessages
      .map(
        (m) =>
          `${m.from === responderId ? responder.name : sender.name}: ${m.content}`,
      )
      .join("\n");

    // Generate AI response with full context
    const response = await this.simulateAgentResponse(
      responderId,
      lastMsg.content,
      `Topic: ${conversation.topic}\n${conversationContext}`,
    );

    const reply = this.sendMessage(responderId, senderId, response, "chat");
    this.addMessageToConversation(conversationId, reply);

    return reply;
  }
}

// Singleton instance
export const orchestrator = new AgentOrchestrator();

// Pre-built conversation starters
export const CONVERSATION_TOPERS = [
  "System Optimization",
  "Content Strategy",
  "Code Review",
  "Data Analysis Pipeline",
  "User Experience Enhancement",
  "Marketing Campaign",
  "Architecture Planning",
  "Security Audit",
];
