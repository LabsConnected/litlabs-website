export type PluginStatus =
  | "available"
  | "connecting"
  | "connected"
  | "degraded"
  | "error"
  | "disconnected"
  | "expired"
  | "offline";

export type PluginCategory =
  | "Development"
  | "AI"
  | "Media"
  | "Social"
  | "Local";

export type AuthMethod = "oauth" | "api-key" | "none" | "token" | "endpoint";

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  icon?: string;
  authMethod: AuthMethod;
  connectUrl?: string;
  status: PluginStatus;
  installed: boolean;
  enabled: boolean;
  accountName?: string;
  resourceCount?: number;
  capabilities: string[];
  lastSync?: string | null;
}

export const PLUGIN_REGISTRY: PluginDefinition[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Connect repositories, manage issues and PRs.",
    category: "Development",
    authMethod: "oauth",
    connectUrl: "/api/github/connect",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["repos", "issues", "pulls"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access 100+ AI models through a single API.",
    category: "AI",
    authMethod: "api-key",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["chat", "completion"],
  },
  {
    id: "fal",
    name: "Fal.ai",
    description: "Image and video generation.",
    category: "Media",
    authMethod: "api-key",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["image", "video"],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Text-to-speech and voice cloning.",
    category: "AI",
    authMethod: "api-key",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["tts", "voice"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "Skybox and 3D space generation.",
    category: "Media",
    authMethod: "api-key",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["skybox", "3d"],
  },
  {
    id: "terminal",
    name: "Terminal Server",
    description: "Connect to a remote PTY for real shell access.",
    category: "Local",
    authMethod: "none",
    status: "available",
    installed: false,
    enabled: false,
    capabilities: ["shell", "exec"],
  },
];
