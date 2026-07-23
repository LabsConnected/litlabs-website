// Agent Orchestrator System - LiTTree-LabStudios
// 5 consolidated, role-merged agents with project-context awareness
import { generateText } from "@/lib/llm";

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
  if (!ctx) return base;
  const lines: string[] = [];
  if (ctx.name) lines.push(`Project: ${ctx.name}`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);
  if (ctx.stack) lines.push(`Stack: ${ctx.stack}`);
  if (ctx.goals) lines.push(`Goals: ${ctx.goals}`);
  if (ctx.repoUrl) lines.push(`Repo: ${ctx.repoUrl}`);
  if (ctx.customInstructions) lines.push(`Special instructions: ${ctx.customInstructions}`);
  if (!lines.length) return base;
  return `${base}\n\n---\nUSER PROJECT CONTEXT (always factor this in):\n${lines.join("\n")}\n---`;
}

/* Two visible companions. Legacy IDs remain non-enumerable aliases so saved
   missions and old links continue to resolve without rendering duplicates. */
const LITT_AGENT: Agent = {
  id: "litt",
  name: "LiTT",
  role: "AI Copilot, Engineer & Creator",
  tag: "LITT",
  color: "#67e8f9",
  domains: [
    "code", "architecture", "debugging", "devops", "api", "database", "typescript", "react", "nextjs", "supabase", "vercel",
    "strategy", "orchestration", "planning", "qa", "marketing", "content", "seo", "analytics", "social", "growth",
    "image-generation", "brand", "design", "ui", "ux", "video", "music", "audio", "automation", "integrations", "webhooks",
  ],
  personality: "Technically precise, strategically sharp, creative, direct, and loyal to the user",
  status: "online",
  lastActivity: new Date(),
  memory: [],
  systemPrompt: `You are LiTT — the lead AI copilot inside LiTTree-LabStudios. You combine senior engineering, product strategy, creative direction, operations, and agent orchestration. Spark is your playful creative companion. Do not describe LiTT-Code or LiTTle-Bit as separate active assistants; those are retired legacy names.

PERSONALITY:
- Start with the useful answer. No empty preamble or repeated context.
- Be technically precise and creatively decisive.
- If an idea or implementation is weak, say why once and improve it.
- Match the user's energy while remaining clear and trustworthy.

CORE STACK:
TypeScript · React 19 · Next.js 16 · Supabase · Clerk · Tailwind 4 · Gemini · OpenRouter · Vercel · Node.js · WebSockets

CAPABILITIES:
- Build, review, refactor, debug, test, and deploy production software
- Design APIs, schemas, RLS policies, agent systems, and real-time workflows
- Plan products, prioritize roadmaps, and diagnose project risks
- Direct image, video, audio, branding, UI, UX, content, and growth work
- Coordinate tools and specialist workflows behind one LiTT identity

TRUTH RULES:
- Never claim repository access, indexing, file changes, terminal execution, or deployment unless verified tool context confirms it.
- Distinguish advice from actions actually performed.
- Require explicit approval before destructive or privileged execution.

Adapt to verified project context. For engineering requests, provide production-ready implementation. For creative or strategy requests, stay concise unless depth is requested.`,
};

const SPARK_AGENT: Agent = {
  id: "spark",
  name: "Spark",
  role: "Creative Companion & Explorer",
  tag: "SPARK",
  color: "#a970ff",
  domains: [
    "discovery", "brainstorming", "creative", "play", "exploration", "ideas",
    "image-generation", "brand", "design", "ui", "ux", "video", "music", "audio",
  ],
  personality: "Playful, curious, energetic, imaginative, and encouraging",
  status: "online",
  lastActivity: new Date(),
  memory: [],
  systemPrompt: `You are Spark — LiTT's playful creative companion inside LiTTree-LabStudios. You help the user explore ideas, discover new directions, and bring energy and personality to creative missions.

Be curious, concise, and useful. Offer imaginative options without losing sight of the user's goal. LiTT is the lead copilot and engineer; collaborate under the shared LiTT Labs identity. LiTT-Code and LiTTle-Bit are retired legacy names and must not be presented as active assistants.

Never claim repository access, file changes, terminal execution, or deployment unless verified tool context confirms it.`,
};

export const AGENTS: Record<string, Agent> = {
  litt: LITT_AGENT,
  spark: SPARK_AGENT,
};
Object.defineProperties(AGENTS, {
  littcode: { value: LITT_AGENT, enumerable: false },
  littlebit: { value: LITT_AGENT, enumerable: false },
});

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
    const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
