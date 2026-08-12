/**
 * LiTT Personal Intelligence Connectors — Provider Registry
 *
 * Canonical provider definitions and capability IDs for all connector types.
 * Separates platform-owned integrations from user-authorized connections.
 */

// ── Platform providers (LiTTree-owned API keys) ────────────────────────

export type PlatformProvider =
  | "open_meteo"
  | "brave_search"
  | "firecrawl"
  | "nango"
  | "gemini"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "r2"
  | "stripe"
  | "vercel"
  | "supabase";

// ── User connection providers (per-user OAuth) ─────────────────────────

export type UserConnectionProvider =
  | "google"
  | "microsoft"
  | "github"
  | "meta"
  | "slack"
  | "notion"
  | "dropbox";

// ── Connection status ──────────────────────────────────────────────────

export type UserConnectionStatus =
  | "connected"
  | "degraded"
  | "expired"
  | "missing_permission"
  | "disconnected";

// ── Capability IDs ─────────────────────────────────────────────────────

export type CapabilityId =
  // Public-data tools
  | "weather.current"
  | "weather.hourly"
  | "weather.daily"
  | "weather.geocode"
  | "web.search"
  | "news.search"
  | "places.search"
  | "images.search"
  | "videos.search"
  | "web.fetch"
  | "web.extract"
  | "web.map_site"
  // Google Calendar
  | "google_calendar_read"
  | "google_calendar_write"
  // Gmail
  | "gmail_metadata"
  | "gmail_read"
  | "gmail_draft"
  | "gmail_send"
  // Microsoft Graph
  | "microsoft_calendar_read"
  | "microsoft_calendar_write"
  | "microsoft_mail_read"
  | "microsoft_mail_send"
  // Contacts
  | "contacts_read"
  // Internal
  | "reminders"
  | "profile.read"
  | "preferences.read"
  | "preferences.update"
  | "location.read"
  | "location.update"
  | "location.clear";

export type CapabilityStatus =
  | "ready"
  | "unavailable"
  | "unknown"
  | "needs_connection"
  | "needs_permission"
  | "disabled";

// ── Provider definitions ───────────────────────────────────────────────

export interface ProviderDefinition {
  id: string;
  label: string;
  category: "platform" | "user_connection";
  capabilities: CapabilityId[];
  envVars: string[];
  oauthScopes?: string[];
  description: string;
}

export const PLATFORM_PROVIDERS: Record<PlatformProvider, ProviderDefinition> = {
  open_meteo: {
    id: "open_meteo",
    label: "Open-Meteo",
    category: "platform",
    capabilities: ["weather.current", "weather.hourly", "weather.daily", "weather.geocode"],
    envVars: ["WEATHER_PROVIDER", "OPEN_METEO_BASE_URL", "OPEN_METEO_API_KEY", "OPEN_METEO_COMMERCIAL"],
    description: "Weather data provider with current conditions and forecasts",
  },
  brave_search: {
    id: "brave_search",
    label: "Brave Search",
    category: "platform",
    capabilities: ["web.search", "news.search", "places.search", "images.search", "videos.search"],
    envVars: ["SEARCH_PROVIDER", "BRAVE_SEARCH_API_KEY"],
    description: "Web, news, images, videos, and places search",
  },
  firecrawl: {
    id: "firecrawl",
    label: "Firecrawl",
    category: "platform",
    capabilities: ["web.fetch", "web.extract", "web.map_site"],
    envVars: ["WEB_FETCH_PROVIDER", "FIRECRAWL_API_KEY"],
    description: "Web content extraction and site mapping",
  },
  nango: {
    id: "nango",
    label: "Nango",
    category: "platform",
    capabilities: [],
    envVars: ["NANGO_SECRET_KEY", "NANGO_PUBLIC_KEY", "NANGO_WEBHOOK_SECRET", "NANGO_ENVIRONMENT"],
    description: "OAuth connection broker for external accounts",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    category: "platform",
    capabilities: [],
    envVars: ["GEMINI_API_KEY"],
    description: "AI provider — Google Gemini",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    category: "platform",
    capabilities: [],
    envVars: ["OPENAI_API_KEY"],
    description: "AI provider — OpenAI",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    category: "platform",
    capabilities: [],
    envVars: ["ANTHROPIC_API_KEY"],
    description: "AI provider — Anthropic Claude",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    category: "platform",
    capabilities: [],
    envVars: ["OPENROUTER_API_KEY"],
    description: "AI provider — OpenRouter",
  },
  groq: {
    id: "groq",
    label: "Groq",
    category: "platform",
    capabilities: [],
    envVars: ["GROQ_API_KEY"],
    description: "AI provider — Groq",
  },
  r2: {
    id: "r2",
    label: "Cloudflare R2",
    category: "platform",
    capabilities: [],
    envVars: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
    description: "Object storage — Cloudflare R2",
  },
  stripe: {
    id: "stripe",
    label: "Stripe",
    category: "platform",
    capabilities: [],
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    description: "Payment processing — Stripe",
  },
  vercel: {
    id: "vercel",
    label: "Vercel",
    category: "platform",
    capabilities: [],
    envVars: ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
    description: "Deployment platform — Vercel",
  },
  supabase: {
    id: "supabase",
    label: "Supabase",
    category: "platform",
    capabilities: [],
    envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    description: "Database and auth — Supabase",
  },
};

export const USER_CONNECTION_PROVIDERS: Record<UserConnectionProvider, ProviderDefinition> = {
  google: {
    id: "google",
    label: "Google",
    category: "user_connection",
    capabilities: [
      "google_calendar_read",
      "google_calendar_write",
      "gmail_metadata",
      "gmail_read",
      "gmail_draft",
      "gmail_send",
      "contacts_read",
    ],
    envVars: [],
    // Base scopes for identity only — incremental scopes are requested
    // on-demand when the user grants specific capabilities.
    // See INCREMENTAL_SCOPES below for the per-capability scope mapping.
    oauthScopes: [
      "openid",
      "email",
      "profile",
    ],
    description: "Google Calendar, Gmail, and Contacts — incremental permissions",
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    category: "user_connection",
    capabilities: [
      "microsoft_calendar_read",
      "microsoft_calendar_write",
      "microsoft_mail_read",
      "microsoft_mail_send",
      "contacts_read",
    ],
    envVars: [],
    oauthScopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "Calendars.ReadBasic",
      "Mail.ReadBasic",
    ],
    description: "Microsoft Outlook Calendar, Mail, and Contacts",
  },
  github: {
    id: "github",
    label: "GitHub",
    category: "user_connection",
    capabilities: [],
    envVars: ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY"],
    description: "GitHub repositories and project integration",
  },
  meta: {
    id: "meta",
    label: "Meta",
    category: "user_connection",
    capabilities: [],
    envVars: [],
    description: "Facebook Pages and Instagram",
  },
  slack: {
    id: "slack",
    label: "Slack",
    category: "user_connection",
    capabilities: [],
    envVars: [],
    oauthScopes: [],
    description: "Slack workspace integration",
  },
  notion: {
    id: "notion",
    label: "Notion",
    category: "user_connection",
    capabilities: [],
    envVars: [],
    oauthScopes: [],
    description: "Notion workspace integration",
  },
  dropbox: {
    id: "dropbox",
    label: "Dropbox",
    category: "user_connection",
    capabilities: [],
    envVars: [],
    oauthScopes: [],
    description: "Dropbox file storage integration",
  },
};

// ── All providers combined ─────────────────────────────────────────────

export const ALL_PROVIDERS: Record<string, ProviderDefinition> = {
  ...PLATFORM_PROVIDERS,
  ...USER_CONNECTION_PROVIDERS,
};

// ── Capability metadata ────────────────────────────────────────────────

export interface CapabilityDefinition {
  id: CapabilityId;
  label: string;
  description: string;
  permission: "none" | "connection_consent" | "explicit_approval" | "sensitive_access";
  provider: PlatformProvider | UserConnectionProvider;
  mutation: boolean;
}

export const CAPABILITY_DEFINITIONS: Record<CapabilityId, CapabilityDefinition> = {
  "weather.current": {
    id: "weather.current",
    label: "Current Weather",
    description: "Get current weather conditions for a location",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "weather.hourly": {
    id: "weather.hourly",
    label: "Hourly Forecast",
    description: "Get hourly weather forecast for a location",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "weather.daily": {
    id: "weather.daily",
    label: "Daily Forecast",
    description: "Get daily weather forecast for a location",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "weather.geocode": {
    id: "weather.geocode",
    label: "Geocode Location",
    description: "Convert a city name to coordinates",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "web.search": {
    id: "web.search",
    label: "Web Search",
    description: "Search the public web",
    permission: "none",
    provider: "brave_search",
    mutation: false,
  },
  "news.search": {
    id: "news.search",
    label: "News Search",
    description: "Search recent news articles",
    permission: "none",
    provider: "brave_search",
    mutation: false,
  },
  "places.search": {
    id: "places.search",
    label: "Places Search",
    description: "Search for nearby businesses and places",
    permission: "none",
    provider: "brave_search",
    mutation: false,
  },
  "images.search": {
    id: "images.search",
    label: "Image Search",
    description: "Search for images on the web",
    permission: "none",
    provider: "brave_search",
    mutation: false,
  },
  "videos.search": {
    id: "videos.search",
    label: "Video Search",
    description: "Search for videos on the web",
    permission: "none",
    provider: "brave_search",
    mutation: false,
  },
  "web.fetch": {
    id: "web.fetch",
    label: "Fetch Page",
    description: "Fetch and extract content from a web page",
    permission: "none",
    provider: "firecrawl",
    mutation: false,
  },
  "web.extract": {
    id: "web.extract",
    label: "Extract Content",
    description: "Extract structured data from a web page",
    permission: "none",
    provider: "firecrawl",
    mutation: false,
  },
  "web.map_site": {
    id: "web.map_site",
    label: "Map Site",
    description: "Map all URLs on a website",
    permission: "none",
    provider: "firecrawl",
    mutation: false,
  },
  "google_calendar_read": {
    id: "google_calendar_read",
    label: "Read Google Calendar",
    description: "List and read calendar events",
    permission: "connection_consent",
    provider: "google",
    mutation: false,
  },
  "google_calendar_write": {
    id: "google_calendar_write",
    label: "Manage Google Calendar",
    description: "Create, update, or delete calendar events",
    permission: "explicit_approval",
    provider: "google",
    mutation: true,
  },
  "gmail_metadata": {
    id: "gmail_metadata",
    label: "Gmail Metadata",
    description: "Search email metadata (headers, labels)",
    permission: "connection_consent",
    provider: "google",
    mutation: false,
  },
  "gmail_read": {
    id: "gmail_read",
    label: "Read Gmail",
    description: "Read email message bodies",
    permission: "sensitive_access",
    provider: "google",
    mutation: false,
  },
  "gmail_draft": {
    id: "gmail_draft",
    label: "Draft Email",
    description: "Create an email draft",
    permission: "connection_consent",
    provider: "google",
    mutation: true,
  },
  "gmail_send": {
    id: "gmail_send",
    label: "Send Email",
    description: "Send an email on behalf of the user",
    permission: "explicit_approval",
    provider: "google",
    mutation: true,
  },
  "microsoft_calendar_read": {
    id: "microsoft_calendar_read",
    label: "Read Outlook Calendar",
    description: "List and read Outlook calendar events",
    permission: "connection_consent",
    provider: "microsoft",
    mutation: false,
  },
  "microsoft_calendar_write": {
    id: "microsoft_calendar_write",
    label: "Manage Outlook Calendar",
    description: "Create, update, or delete Outlook calendar events",
    permission: "explicit_approval",
    provider: "microsoft",
    mutation: true,
  },
  "microsoft_mail_read": {
    id: "microsoft_mail_read",
    label: "Read Outlook Mail",
    description: "Read Outlook email messages",
    permission: "sensitive_access",
    provider: "microsoft",
    mutation: false,
  },
  "microsoft_mail_send": {
    id: "microsoft_mail_send",
    label: "Send Outlook Mail",
    description: "Send an email via Outlook",
    permission: "explicit_approval",
    provider: "microsoft",
    mutation: true,
  },
  "contacts_read": {
    id: "contacts_read",
    label: "Read Contacts",
    description: "Search and read contacts",
    permission: "connection_consent",
    provider: "google",
    mutation: false,
  },
  "reminders": {
    id: "reminders",
    label: "Reminders",
    description: "Create and manage internal reminders",
    permission: "none",
    provider: "open_meteo",
    mutation: true,
  },
  "profile.read": {
    id: "profile.read",
    label: "Read Profile",
    description: "Read user profile information",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "preferences.read": {
    id: "preferences.read",
    label: "Read Preferences",
    description: "Read user preferences",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "preferences.update": {
    id: "preferences.update",
    label: "Update Preferences",
    description: "Update user preferences",
    permission: "none",
    provider: "open_meteo",
    mutation: true,
  },
  "location.read": {
    id: "location.read",
    label: "Read Location",
    description: "Read user's saved location",
    permission: "none",
    provider: "open_meteo",
    mutation: false,
  },
  "location.update": {
    id: "location.update",
    label: "Update Location",
    description: "Update user's saved location",
    permission: "none",
    provider: "open_meteo",
    mutation: true,
  },
  "location.clear": {
    id: "location.clear",
    label: "Clear Location",
    description: "Delete user's saved location",
    permission: "none",
    provider: "open_meteo",
    mutation: true,
  },
};

// ── Feature flags ──────────────────────────────────────────────────────

export type ConnectorFeatureFlag =
  | "weather"
  | "web_search"
  | "google_calendar"
  | "gmail"
  | "microsoft_graph"
  | "daily_briefing";

export const CONNECTOR_FEATURE_FLAGS: Record<ConnectorFeatureFlag, { publicVar: string; serverVar: string }> = {
  weather: {
    publicVar: "NEXT_PUBLIC_WEATHER_ENABLED",
    serverVar: "WEATHER_ENABLED",
  },
  web_search: {
    publicVar: "NEXT_PUBLIC_WEB_SEARCH_ENABLED",
    serverVar: "WEB_SEARCH_ENABLED",
  },
  google_calendar: {
    publicVar: "NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED",
    serverVar: "GOOGLE_CALENDAR_ENABLED",
  },
  gmail: {
    publicVar: "NEXT_PUBLIC_GMAIL_ENABLED",
    serverVar: "GMAIL_ENABLED",
  },
  microsoft_graph: {
    publicVar: "NEXT_PUBLIC_MICROSOFT_GRAPH_ENABLED",
    serverVar: "MICROSOFT_GRAPH_ENABLED",
  },
  daily_briefing: {
    publicVar: "NEXT_PUBLIC_DAILY_BRIEFING_ENABLED",
    serverVar: "DAILY_BRIEFING_ENABLED",
  },
};

export function isConnectorEnabled(flag: ConnectorFeatureFlag): boolean {
  const { publicVar, serverVar } = CONNECTOR_FEATURE_FLAGS[flag];
  const pub = process.env[publicVar];
  if (pub === "true") return true;
  if (pub === "false") return false;
  const srv = process.env[serverVar];
  if (srv === "true") return true;
  if (srv === "false") return false;
  return false;
}

// ── Incremental OAuth Scopes ───────────────────────────────────────────
//
// Maps each capability to the OAuth scopes required to perform it.
// This enables incremental consent: LiTT only requests the scopes needed
// for the current task, not every possible scope upfront.
//
// Users grant capabilities one at a time. Each capability maps to specific
// provider scopes. When a user grants a new capability, the OAuth flow
// requests only that scope (plus already-granted scopes for re-auth).
//

export const INCREMENTAL_SCOPES: Partial<Record<CapabilityId, string[]>> = {
  // Google Calendar
  google_calendar_read: [
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  google_calendar_write: [
    "https://www.googleapis.com/auth/calendar",
  ],
  // Gmail — progressively more sensitive
  gmail_metadata: [
    "https://www.googleapis.com/auth/gmail.metadata",
  ],
  gmail_read: [
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  gmail_draft: [
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  gmail_send: [
    "https://www.googleapis.com/auth/gmail.send",
  ],
  // Google Contacts
  contacts_read: [
    "https://www.googleapis.com/auth/contacts.readonly",
  ],
  // Microsoft Graph
  microsoft_calendar_read: [
    "Calendars.Read",
  ],
  microsoft_calendar_write: [
    "Calendars.ReadWrite",
  ],
  microsoft_mail_read: [
    "Mail.Read",
  ],
  microsoft_mail_send: [
    "Mail.Send",
  ],
};

/**
 * Get the OAuth scopes required for a set of capabilities.
 * Used when initiating an incremental OAuth flow — only request
 * the scopes needed for the capabilities being granted.
 */
export function getScopesForCapabilities(caps: CapabilityId[]): string[] {
  const scopes = new Set<string>();
  for (const cap of caps) {
    const capScopes = INCREMENTAL_SCOPES[cap];
    if (capScopes) {
      for (const s of capScopes) scopes.add(s);
    }
  }
  return Array.from(scopes);
}

/**
 * Get the capabilities that a set of OAuth scopes unlocks.
 * Used after OAuth callback to determine which capabilities
 * the user has now granted.
 */
export function getCapabilitiesForScopes(scopes: string[]): CapabilityId[] {
  const scopeSet = new Set(scopes);
  const granted: CapabilityId[] = [];
  for (const [cap, capScopes] of Object.entries(INCREMENTAL_SCOPES)) {
    if (capScopes && capScopes.every((s) => scopeSet.has(s))) {
      granted.push(cap as CapabilityId);
    }
  }
  return granted;
}
