import { AGENT_AVATARS } from "@/lib/avatars";

export type CoreAgent = {
  id: string;
  slug: string;
  display_name: string;
  description: string;
  role: string;
  system_prompt: string;
  personality: string;
  model: string;
  is_core: boolean;
  is_public: boolean;
  is_featured: boolean;
  avatar_url: string;
  features: string[];
  price_cents: number;
  rating: number;
  installs: number;
  created_at: string;
  updated_at: string;
};

export const CORE_AGENTS: CoreAgent[] = [
  {
    id: "core-director",
    slug: "director",
    display_name: "Director",
    description:
      "Strategic orchestrator that plans multi-agent workflows, breaks down goals, and dispatches work to the right specialist.",
    role: "orchestrator",
    system_prompt:
      "You are Director, the strategic orchestrator for LiTTree Lab Studios. You analyze user goals, create step-by-step plans, and delegate tasks to the right agents. You speak decisively and concisely. Always return a structured plan with assigned agents, expected outputs, and success criteria.",
    personality: "Strategic, decisive, concise",
    model: "gemini-2.5-flash",
    is_core: true,
    is_public: true,
    is_featured: true,
    avatar_url: AGENT_AVATARS.director,
    features: [
      "Multi-agent orchestration",
      "Goal decomposition",
      "Workflow planning",
      "Progress tracking",
    ],
    price_cents: 0,
    rating: 4.9,
    installs: 1240,
    created_at: "2024-01-15T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
  },
  {
    id: "core-builder",
    slug: "builder",
    display_name: "Builder",
    description:
      "Hands-on engineer agent that writes, reviews, and ships code across the stack. Installs into your IDE and terminal via PowerShell 7.",
    role: "developer",
    system_prompt:
      "You are Builder, the hands-on engineer at LiTTree Lab Studios. You write clean, production-ready code, review existing code, and help ship features. You prefer complete, working examples with minimal commentary. When given a task, produce the file(s), commands, or edits needed.",
    personality: "Pragmatic, precise, shipping-focused",
    model: "gemini-2.5-flash",
    is_core: true,
    is_public: true,
    is_featured: false,
    avatar_url: AGENT_AVATARS["support-agent"],
    features: [
      "Full-stack code generation",
      "Code review & refactoring",
      "Terminal/CLI commands",
      "PowerShell 7 integration",
    ],
    price_cents: 0,
    rating: 4.8,
    installs: 856,
    created_at: "2024-02-01T00:00:00Z",
    updated_at: "2024-02-01T00:00:00Z",
  },
];

export function getCoreAgents(): CoreAgent[] {
  return CORE_AGENTS.map((a) => ({ ...a }));
}

export function getCoreAgentBySlug(slug: string): CoreAgent | undefined {
  return CORE_AGENTS.find((a) => a.slug === slug);
}
