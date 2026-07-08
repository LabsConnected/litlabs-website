export type ConnectorCategory =
  | "developer"
  | "data"
  | "productivity"
  | "operations"
  | "sales"
  | "creative"
  | "communication"
  | "finance"
  | "health";

export interface Connector {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  icon: string;
  color: string;
  envKey?: string;
  enabled: boolean;
}

export const CONNECTOR_CATEGORIES: Record<ConnectorCategory, string> = {
  developer: "Developer",
  data: "Data & Analytics",
  productivity: "Productivity",
  operations: "Operations",
  sales: "Sales & Marketing",
  creative: "Creative",
  communication: "Communication",
  finance: "Finance",
  health: "Health",
};

export const DEFAULT_CONNECTORS: Connector[] = [
  // Developer
  {
    id: "supabase",
    name: "Supabase",
    description: "Build and manage your app's database, auth, and storage.",
    category: "developer",
    icon: "🟢",
    color: "#3ecf8e",
    envKey: "NEXT_PUBLIC_SUPABASE_URL",
    enabled: true,
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Manage teams, projects, and deployments.",
    category: "developer",
    icon: "▲",
    color: "#000000",
    envKey: "VERCEL_TOKEN",
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Read repos, issues, and pull requests.",
    category: "developer",
    icon: "🐙",
    color: "#8b5cf6",
    enabled: false,
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Connect to GitLab projects and webhooks.",
    category: "developer",
    icon: "🦊",
    color: "#fc6d26",
    enabled: false,
  },
  // Data & Analytics
  {
    id: "r2",
    name: "Cloudflare R2",
    description: "Store and retrieve files, images, and assets.",
    category: "data",
    icon: "☁️",
    color: "#f48120",
    envKey: "R2_ACCOUNT_ID",
    enabled: true,
  },
  // Finance
  {
    id: "stripe",
    name: "Stripe",
    description: "Manage payments, subscriptions, and billing.",
    category: "finance",
    icon: "💳",
    color: "#635bff",
    envKey: "STRIPE_SECRET_KEY",
    enabled: false,
  },
  // Communication
  {
    id: "clerk",
    name: "Clerk",
    description: "Authentication and user management.",
    category: "communication",
    icon: "🔐",
    color: "#6c47ff",
    envKey: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    enabled: true,
  },
  // Creative
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Generate text, code, and reasoning.",
    category: "creative",
    icon: "✨",
    color: "#4285f4",
    envKey: "GEMINI_API_KEY",
    enabled: true,
  },
  {
    id: "fal",
    name: "FAL AI",
    description: "Generate images and video.",
    category: "creative",
    icon: "🎨",
    color: "#ff0099",
    envKey: "FAL_KEY",
    enabled: false,
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Run open-source models and datasets.",
    category: "creative",
    icon: "🤗",
    color: "#ffd21e",
    envKey: "HUGGING_FACE_API_KEY",
    enabled: false,
  },
  {
    id: "spotify",
    name: "Spotify",
    description: "Control playback and search tracks.",
    category: "creative",
    icon: "🎵",
    color: "#1db954",
    enabled: false,
  },
  // Operations
  {
    id: "stripe-billing",
    name: "Stripe Billing",
    description: "Subscriptions, invoices, and customer portal.",
    category: "operations",
    icon: "📋",
    color: "#00d4aa",
    enabled: false,
  },
  {
    id: "skybox",
    name: "Skybox AI",
    description: "Generate 360° skyboxes and environments.",
    category: "creative",
    icon: "🌌",
    color: "#a855f7",
    envKey: "SKYBOX_API_KEY",
    enabled: false,
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "Generate video and audio content.",
    category: "creative",
    icon: "🎬",
    color: "#ff6b6b",
    envKey: "MINIMAX_API_KEY",
    enabled: false,
  },
  {
    id: "together",
    name: "Together AI",
    description: "Run open-source LLMs at scale.",
    category: "developer",
    icon: "🔥",
    color: "#0ea5e9",
    envKey: "TOGETHER_API_KEY",
    enabled: false,
  },
  // Sales
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Unified API for many LLMs.",
    category: "sales",
    icon: "🔌",
    color: "#22c55e",
    enabled: false,
  },
];

export function getConnectorsByCategory(connectors: Connector[]): Record<ConnectorCategory, Connector[]> {
  return connectors.reduce((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {} as Record<ConnectorCategory, Connector[]>);
}
