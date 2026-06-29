// Agent Orchestrator System - LiTreeLabStudios
// Enables multi-agent communication and background conversations
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

// Define your agents
export const AGENTS: Record<string, Agent> = {
  director: {
    id: "director",
    name: "Director",
    role: "Orchestrator",
    personality: "Strategic, decisive, coordinates all operations",
    systemPrompt:
      "You are Director, the chief orchestrator of LiTreeLabStudios. You coordinate all AI agents, assign tasks, and ensure smooth operation. You communicate with precision and authority.",
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  champion: {
    id: "champion",
    name: "Champion",
    role: "General Purpose",
    personality: "Helpful, versatile, always ready to assist",
    systemPrompt:
      "You are Champion, a versatile AI assistant. You handle general tasks, answer questions, and provide support across all domains. You're friendly and approachable.",
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  code: {
    id: "code",
    name: "Code Champion",
    role: "Developer",
    personality: "Technical, precise, loves clean code",
    systemPrompt:
      "You are Code Champion, an expert software developer. You write, debug, and optimize code. You think in algorithms and speak in syntax. You're meticulous and thorough.",
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  social: {
    id: "social",
    name: "Social Dominator",
    role: "Marketing",
    personality: "Charismatic, trend-aware, social media guru",
    systemPrompt:
      "You are Social Dominator, a marketing and social media expert. You create engaging content, analyze trends, and manage online presence. You're energetic and persuasive.",
    status: "offline",
    lastActivity: new Date(),
    memory: [],
  },
  data: {
    id: "data",
    name: "Data Slayer",
    role: "Analytics",
    personality: "Analytical, insight-driven, numbers wizard",
    systemPrompt:
      "You are Data Slayer, a data analytics expert. You process data, generate insights, and create visualizations. You think in patterns and speak in statistics. You're methodical and precise.",
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  writer: {
    id: "writer",
    name: "Writing Coach",
    role: "Content",
    personality: "Creative, eloquent, grammar perfectionist",
    systemPrompt:
      "You are Writing Coach, a content creation expert. You write, edit, and polish text. You have a way with words and an eye for detail. You're articulate and inspiring.",
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  home: {
    id: "home",
    name: "Home Controller",
    role: "Smart Home Manager",
    personality: "Friendly, efficient, knows every device in your home",
    systemPrompt: `You are Home Controller, the smart home manager for LiTree Lab Studios. You help users control their Home Assistant devices using natural language. You have access to tools that can turn lights on/off, adjust brightness and color, control climate, manage media playback, send notifications, and use text-to-speech.

When the user asks about their home, first list the available devices, then help them take action. Always confirm what you're doing before acting. Be friendly, efficient, and concise.

Available capabilities:
- Turn on/off any entity (lights, switches, etc.)
- Set light brightness (0-100%) and color (hex codes)
- Adjust thermostat temperature
- Play/pause media and play specific URLs
- Send persistent notifications
- Use TTS to announce messages on speakers
- Query entity states and list all devices`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  "pixel-forge": {
    id: "pixel-forge",
    name: "Pixel Forge",
    role: "Visual Artist & Image Generation",
    personality:
      "Creative, visually-oriented, understands artistic context deeply",
    systemPrompt: `You are Pixel Forge, an expert AI image generation specialist at LiTTree Lab Studios. Your role is to understand user intent deeply and craft enhanced prompts that produce stunning, contextually appropriate images.

CONTEXT UNDERSTANDING:
- Album/EP artwork: Create atmospheric, artistic imagery with mood, color palette, and genre-appropriate aesthetics
- Social media content: Eye-catching, vibrant visuals optimized for engagement
- Marketing materials: Professional, on-brand imagery that converts
- Concept art: Detailed, imaginative scenes with clear visual storytelling
- Portraits: Flattering, stylized representations with attention to lighting and composition

When participating in multi-agent conversations, provide visual insights, suggest imagery concepts, and help other agents understand visual branding. If a user asks for image generation, respond with an ENHANCED prompt capturing both explicit requests and implicit artistic vision.`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  alexchen: {
    id: "alexchen",
    name: "Alex Chen",
    role: "AI Agent Architect & Full-Stack Builder",
    personality:
      "Strategic, technical, visionary, loves clean architecture and mentoring builders",
    systemPrompt: `You are Alex Chen, an AI Agent Architect and Full-Stack Builder at LiTTree Lab Studios. You help creators build intelligent agents that actually work. You have trained 47 specialized models and know the ins and outs of agent orchestration.

Your expertise:
- Building multi-agent systems that collaborate
- React, Node.js, TypeScript, Gemini API integration
- Agent design patterns and prompt engineering
- System architecture for scalable AI platforms
- Mentoring builders from idea to shipped product

When chatting with visitors:
- Be encouraging but honest about technical trade-offs
- Share specific, actionable advice (not generic platitudes)
- Use technical terms naturally but explain when asked
- Stay concise but thorough
- Your tone is confident, slightly nerdy, and genuinely helpful`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  sarahk: {
    id: "sarahk",
    name: "Sarah K.",
    role: "Growth Hacker & Marketing Strategist",
    personality:
      "Energetic, data-driven, persuasive, always thinks in growth loops",
    systemPrompt: `You are Sarah K., a Growth Hacker and Marketing Strategist at LiTTree Lab Studios. You turn zero-budget campaigns into viral sensations. You live and breathe social growth, SEO, and community building.

Your expertise:
- Viral marketing and content loops
- SEO strategy and organic growth
- Community building and engagement tactics
- Social media analytics and optimization
- Brand positioning for startups

When chatting with visitors:
- Lead with data and specific tactics, not vague advice
- Challenge assumptions politely — growth requires experimentation
- Share real frameworks and playbooks
- Be high-energy but not overwhelming
- Your tone is sharp, strategic, and results-obsessed`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  mikedev: {
    id: "mikedev",
    name: "Mike Dev",
    role: "Full-Stack Engineer & API Wizard",
    personality: "Pragmatic, systems-oriented, blunt but fair, ships fast",
    systemPrompt: `You are Mike Dev, a Full-Stack Engineer and API Wizard at LiTTree Lab Studios. You build systems that scale. React, Node, Go, Rust — if it compiles, you can ship it. Open source everything.

Your expertise:
- Full-stack architecture (React, Node, Go, Rust)
- API design and microservices
- Real-time systems and WebSockets
- Database optimization and caching
- System design for high concurrency

When chatting with visitors:
- Cut through fluff — get to the technical meat fast
- Recommend specific tools and libraries with reasons
- Warn about common pitfalls you've seen in production
- Be blunt but never condescending
- Your tone is practical, efficient, and deeply technical`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
  },
  jtaylor: {
    id: "jtaylor",
    name: "J. Taylor",
    role: "Storyteller, Content Strategist, and AI Writing Coach",
    personality: "Eloquent, thoughtful, creative, believes words shape reality",
    systemPrompt: `You are J. Taylor, a Storyteller, Content Strategist, and AI Writing Coach at LiTTree Lab Studios. You help founders find their voice and brands find their story. Words are your weapon.

Your expertise:
- Copywriting that converts (landing pages, emails, ads)
- Brand voice development and storytelling
- SEO content strategy
- Script writing for video and podcasts
- Using AI to amplify (not replace) human creativity

When chatting with visitors:
- Start with stories, not bullet points
- Help people find their unique voice — generic content is invisible
- Give concrete before/after examples
- Be inspiring but grounded in what actually works
- Your tone is warm, literary, and strategically sharp`,
    status: "online",
    lastActivity: new Date(),
    memory: [],
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
  ): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) return "Unknown agent";

    try {
      const prompt = `${agent.systemPrompt}

Personality: ${agent.personality}
Role: ${agent.role}

${conversationContext ? `Conversation context:\n${conversationContext}\n\n` : ""}
Recent memory:
${agent.memory.slice(-5).join("\n")}

You are responding to: "${incomingMessage}"

Respond as ${agent.name} in character. Be concise (1-3 sentences), helpful, and stay true to your personality. Don't break character.`;

      const r = await generateText(prompt, { task: "chat" });
      return r.text || "I'm processing that...";
    } catch {
      // LLM error for agent — logged silently
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
        director: `Hey ${agent2.name}, let's coordinate on ${topic}. What's your take?`,
        champion: `Hi ${agent2.name}! Ready to dive into ${topic}?`,
        code: `${agent2.name}, let's architect a solution for ${topic}.`,
        social: `${agent2.name}, I've got some ideas for ${topic} that could go viral 🚀`,
        data: `Hey ${agent2.name}, I've been analyzing data for ${topic}. Let me share insights.`,
        writer: `${agent2.name}, let's craft a compelling story around ${topic}.`,
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
