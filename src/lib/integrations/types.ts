export type IntegrationState =
  | "checking"
  | "platform_missing"
  | "platform_configured"
  | "user_not_connected"
  | "user_connected"
  | "needs_setup"
  | "ready"
  | "error";

export type IntegrationActionType =
  | "connect"
  | "disconnect"
  | "configure"
  | "repair"
  | "test"
  | "select_repository"
  | "open_settings"
  | "set_default"
  | "add_key"
  | "remove_key"
  | "run_diagnostics";

export interface IntegrationAction {
  id: string;
  label: string;
  type: IntegrationActionType;
}

export interface IntegrationStatus {
  id: string;
  platformConfigured: boolean;
  userConnected: boolean;
  workspaceReady: boolean;
  state: IntegrationState;
  displayName: string;
  category: "required" | "code" | "ai" | "optional" | "runtime" | "personal" | "information";
  details?: string;
  lastVerifiedAt?: string;
  errorCode?: string;
  actions: IntegrationAction[];
}

export interface IntegrationStatusResponse {
  integrations: IntegrationStatus[];
  summary: {
    platformReady: number;
    platformNeedsConfig: number;
    optional: number;
    userConnected: number;
    userNotConnected: number;
    workspaceReady: number;
  };
}

export const INTEGRATION_ENV_REQUIREMENTS: Record<string, string[]> = {
  clerk: [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
  ],
  supabase: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ],
  github: [
    "GITHUB_APP_ID",
    "GITHUB_PRIVATE_KEY",
  ],
  vercel: [
    "VERCEL_TOKEN",
    "VERCEL_PROJECT_ID",
  ],
  r2: [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ],
  stripe: [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ],
  gemini: [
    "GEMINI_API_KEY",
  ],
  openrouter: [
    "OPENROUTER_API_KEY",
  ],
  groq: [
    "GROQ_API_KEY",
  ],
  openai: [
    "OPENAI_API_KEY",
  ],
  anthropic: [
    "ANTHROPIC_API_KEY",
  ],
  open_meteo: [
    "WEATHER_PROVIDER",
    "OPEN_METEO_BASE_URL",
  ],
  brave_search: [
    "SEARCH_PROVIDER",
    "BRAVE_SEARCH_API_KEY",
  ],
  firecrawl: [
    "WEB_FETCH_PROVIDER",
    "FIRECRAWL_API_KEY",
  ],
  nango: [
    "NANGO_SECRET_KEY",
    "NANGO_PUBLIC_KEY",
  ],
};

export function checkEnvVars(keys: string[]): { allPresent: boolean; missing: string[] } {
  const missing = keys.filter((k) => {
    const v = process.env[k];
    return !v || v.length < 5 || v.includes("your-") || v.includes("placeholder");
  });
  return { allPresent: missing.length === 0, missing };
}

export function maskKey(key: string | undefined): string | null {
  if (!key || key.length < 8) return null;
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
