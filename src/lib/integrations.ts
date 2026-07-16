/**
 * integrations.ts
 *
 * The full registry of every third-party integration the litlabs.net
 * project uses, with live status detection. The "Show me around" /
 * "What's connected?" experience is built on top of this.
 *
 * LiTT injects a summary of the current integration state into every
 * think-route response so the model can answer questions like:
 *   - "Is GitHub connected?"
 *   - "What integrations are we using?"
 *   - "Set up Stripe for me"
 *   - "Show me around"
 * without the user having to tell it what tools exist.
 */

export type IntegrationStatus = "connected" | "missing" | "error" | "unknown";

export type IntegrationCategory =
  | "ai"
  | "auth"
  | "data"
  | "billing"
  | "media"
  | "notifications"
  | "ops"
  | "smart-home"
  | "dev"
  | "other";

export interface Integration {
  /** Stable id, e.g. "github", "supabase", "stripe" */
  id: string;
  /** Display name */
  name: string;
  /** Short tagline, one line */
  tagline: string;
  /** What it's used for in the project */
  purpose: string;
  /** Grouping */
  category: IntegrationCategory;
  /** Env vars that must be present for this to be considered configured */
  envKeys: string[];
  /** True if the project depends on it being live */
  required: boolean;
  /** Direct link to the integration's settings page (or docs) */
  docsUrl?: string;
  /** Detected live status (filled by `detectIntegrations()`) */
  status: IntegrationStatus;
  /** Optional extra detail, e.g. "ok", "no key", "no installation" */
  detail?: string;
}

/* ------------------------------------------------------------------ */
/*  Registry — every integration the project actually uses             */
/* ------------------------------------------------------------------ */
export const INTEGRATION_REGISTRY: Omit<Integration, "status" | "detail">[] = [
  /* ── AI / LLM ──────────────────────────────────────────────────── */
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Primary LLM provider (gemini-2.5-flash).",
    purpose:
      "Powers every LLM call in the project. Set GEMINI_API_KEY (or GOOGLE_API_KEY) to enable.",
    category: "ai",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    required: true,
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Free-tier LLM fallback (Qwen, DeepSeek, Llama, Mistral).",
    purpose:
      "Used as failover when Gemini is rate-limited or down. Set OPENROUTER_API_KEY.",
    category: "ai",
    envKeys: ["OPENROUTER_API_KEY"],
    required: false,
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    tagline: "Voice / speech synthesis for LiTT-Code voice mode.",
    purpose: "Used by the voice panel and speech tools. Optional.",
    category: "ai",
    envKeys: ["ELEVENLABS_API_KEY"],
    required: false,
  },
  {
    id: "replicate",
    name: "Replicate",
    tagline: "Image / video generation fallback.",
    purpose: "Used as a fallback for image generation when Gemini is unavailable.",
    category: "ai",
    envKeys: ["REPLICATE_API_TOKEN"],
    required: false,
  },

  /* ── Auth ─────────────────────────────────────────────────────── */
  {
    id: "clerk",
    name: "Clerk",
    tagline: "Frontend auth (sign-in, sign-up, sessions).",
    purpose:
      "Used by all authenticated routes and the user-agents system. Required.",
    category: "auth",
    envKeys: ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
    required: true,
    docsUrl: "https://dashboard.clerk.com",
  },

  /* ── Data ─────────────────────────────────────────────────────── */
  {
    id: "supabase",
    name: "Supabase",
    tagline: "Database, auth, storage, edge functions.",
    purpose:
      "Source of truth for the entire app — users, agents, posts, projects, notifications, etc. Required.",
    category: "data",
    envKeys: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    required: true,
    docsUrl: "https://supabase.com/dashboard",
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    tagline: "Media storage (audio, generated images, large files).",
    purpose:
      "Offloads large binary files from Supabase. Optional but recommended.",
    category: "data",
    envKeys: [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ],
    required: false,
  },

  /* ── Billing ──────────────────────────────────────────────────── */
  {
    id: "stripe",
    name: "Stripe",
    tagline: "Billing & subscriptions.",
    purpose:
      "Drives the marketplace / agent purchases. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
    category: "billing",
    envKeys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    required: true,
    docsUrl: "https://dashboard.stripe.com/apikeys",
  },

  /* ── Media ────────────────────────────────────────────────────── */
  {
    id: "spotify",
    name: "Spotify",
    tagline: "Music playback + library integration.",
    purpose: "Optional — used for the music station / playlists.",
    category: "media",
    envKeys: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
    required: false,
  },

  /* ── Notifications ────────────────────────────────────────────── */
  {
    id: "resend",
    name: "Resend",
    tagline: "Transactional email (alerts, system mail).",
    purpose: "Optional — set RESEND_API_KEY + ADMIN_EMAIL.",
    category: "notifications",
    envKeys: ["RESEND_API_KEY", "ADMIN_EMAIL"],
    required: false,
  },
  {
    id: "webpush",
    name: "Web Push (VAPID)",
    tagline: "Browser push notifications.",
    purpose: "Optional — set VAPID keys (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).",
    category: "notifications",
    envKeys: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    required: false,
  },

  /* ── Ops / Dev ────────────────────────────────────────────────── */
  {
    id: "github",
    name: "GitHub App",
    tagline: "Repo-level installs, PRs, webhooks.",
    purpose:
      "Drives the GitHub integration in the dashboard. Needs GitHub App credentials + installation.",
    category: "dev",
    envKeys: [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_WEBHOOK_SECRET",
    ],
    required: false,
    docsUrl: "https://github.com/settings/apps",
  },
  {
    id: "gitlab",
    name: "GitLab",
    tagline: "Self-hosted GitLab webhooks (deployment triggers).",
    purpose: "Optional. Set GITLAB_WEBHOOK_SECRET.",
    category: "dev",
    envKeys: ["GITLAB_WEBHOOK_SECRET"],
    required: false,
  },
  {
    id: "aws",
    name: "AWS (Bedrock)",
    tagline: "Bedrock LLM provider — used in llm-completion.ts.",
    purpose: "Optional. Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.",
    category: "dev",
    envKeys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    required: false,
  },
  {
    id: "voicemonkey",
    name: "Voice Monkey",
    tagline: "Smart-home voice triggers via Alexa / Google Home.",
    purpose: "Optional.",
    category: "smart-home",
    envKeys: ["VOICE_MONKEY_TOKEN", "VOICE_MONKEY_DEVICE"],
    required: false,
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    tagline: "Smart-home control surface.",
    purpose: "Optional. Set HA_URL + HA_TOKEN.",
    category: "smart-home",
    envKeys: ["HA_URL", "HA_TOKEN"],
    required: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Live detection                                                    */
/* ------------------------------------------------------------------ */

function envValue(key: string): string {
  // Server-side read of process.env. Caller must be on the server.
  try {
    const v = process.env[key];
    return typeof v === "string" && v.length > 0 ? v : "";
  } catch {
    return "";
  }
}

/**
 * Returns the live status of every integration the project knows about.
 * Reads process.env (server-only) for the configured keys.
 */
export function detectIntegrations(): Integration[] {
  return INTEGRATION_REGISTRY.map((entry) => {
    const present = entry.envKeys.map(envValue).filter(Boolean);
    let status: IntegrationStatus = "missing";
    let detail: string | undefined;

    if (present.length === 0) {
      status = "missing";
      detail = `missing: ${entry.envKeys.join(", ")}`;
    } else if (present.length < entry.envKeys.length) {
      status = "missing";
      const missing = entry.envKeys.filter((k) => !envValue(k));
      detail = `partial — missing: ${missing.join(", ")}`;
    } else {
      status = "connected";
      detail = `ok (${present.length} env vars set)`;
    }

    return { ...entry, status, detail };
  });
}

/* ------------------------------------------------------------------ */
/*  Formatters (used by the brain)                                     */
/* ------------------------------------------------------------------ */

export function integrationsByStatus(status: IntegrationStatus): Integration[] {
  return detectIntegrations().filter((i) => i.status === status);
}

/**
 * Returns a compact, one-line-per-integration summary suitable for
 * injecting into a system prompt. The model uses this to know exactly
 * which integrations are wired up vs. which need to be set up.
 */
export function integrationStatusBlock(): string {
  const items = detectIntegrations();
  const lines: string[] = [];
  const counts: Record<IntegrationStatus, number> = {
    connected: 0,
    missing: 0,
    error: 0,
    unknown: 0,
  };
  for (const i of items) {
    counts[i.status]++;
    const tag = i.status === "connected" ? "✅" : i.status === "missing" ? "⚠️ " : "❓";
    const req = i.required ? " [REQUIRED]" : "";
    lines.push(`  ${tag} ${i.name} (${i.id})${req}: ${i.detail ?? i.status}`);
  }
  const head =
    `REGISTERED INTEGRATIONS (live status — ${counts.connected} connected, ${counts.missing} need setup, ${items.length} total):\n` +
    lines.join("\n");
  return head;
}

/**
 * Shorter version for tight contexts.
 */
export function integrationStatusSnippet(): string {
  const items = detectIntegrations();
  const connected = items.filter((i) => i.status === "connected").map((i) => i.id);
  const missing = items.filter((i) => i.status === "missing").map((i) => i.id);
  return `Integrations — connected: [${connected.join(", ") || "none"}], missing: [${missing.join(", ") || "none"}] (of ${items.length} registered).`;
}

/* ------------------------------------------------------------------ */
/*  Goals (the "be able to make a list or goal" requirement)           */
/* ------------------------------------------------------------------ */

export type GoalPriority = "low" | "medium" | "high";
export type GoalStatus = "open" | "in_progress" | "done" | "dropped";

export interface Goal {
  id: string;
  title: string;
  notes?: string;
  priority: GoalPriority;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Goal storage. Lives in localStorage on the client, and in Supabase
 * (table: `litt_goals`) on the server. Both layers are mirrored so
 * LiTT-Code can read goals from any code path.
 */
const GOALS_KEY = "litlabs-goals";

export function loadGoals(): Goal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is Goal =>
        g &&
        typeof g.id === "string" &&
        typeof g.title === "string" &&
        typeof g.priority === "string" &&
        typeof g.status === "string",
    );
  } catch {
    return [];
  }
}

export function saveGoals(goals: Goal[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  } catch {}
}

export function addGoal(input: { title: string; notes?: string; priority?: GoalPriority }): Goal {
  const goal: Goal = {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim(),
    notes: input.notes?.trim() || undefined,
    priority: input.priority ?? "medium",
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const goals = loadGoals();
  goals.unshift(goal);
  saveGoals(goals);
  return goal;
}

export function updateGoal(id: string, patch: Partial<Goal>): Goal | null {
  const goals = loadGoals();
  const idx = goals.findIndex((g) => g.id === id);
  if (idx < 0) return null;
  const updated: Goal = {
    ...goals[idx],
    ...patch,
    id: goals[idx].id,
    updatedAt: new Date().toISOString(),
  };
  goals[idx] = updated;
  saveGoals(goals);
  return updated;
}

export function removeGoal(id: string): boolean {
  const goals = loadGoals();
  const next = goals.filter((g) => g.id !== id);
  if (next.length === goals.length) return false;
  saveGoals(next);
  return true;
}

export function clearDoneGoals(): number {
  const goals = loadGoals();
  const before = goals.length;
  const next = goals.filter((g) => g.status !== "done");
  saveGoals(next);
  return before - next.length;
}

/**
 * Compact one-liner the brain can inject to be aware of the user's
 * current open goals. LiTT-Code uses this to be a step ahead.
 */
export function goalsSnippet(limit = 8): string {
  const goals = loadGoals().filter((g) => g.status !== "done" && g.status !== "dropped");
  if (goals.length === 0) return "User has no open goals right now.";
  const top = goals
    .sort((a, b) => {
      const order: Record<GoalPriority, number> = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    })
    .slice(0, limit)
    .map((g, i) => `  ${i + 1}. [${g.priority.toUpperCase()}] ${g.title}${g.notes ? ` — ${g.notes.slice(0, 60)}` : ""}`)
    .join("\n");
  return `USER OPEN GOALS (${goals.length} total — top ${Math.min(limit, goals.length)}):\n${top}`;
}

/* ------------------------------------------------------------------ */
/*  Health summary — the "Show me around" payload                      */
/* ------------------------------------------------------------------ */

export interface ProjectHealth {
  integrations: Integration[];
  goals: Goal[];
  /** Local time of day bucket — used to tailor the response */
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  /** Total counts */
  connected: number;
  missing: number;
  total: number;
  requiredMissing: string[];
}

export function getProjectHealth(): ProjectHealth {
  const integrations = detectIntegrations();
  const connected = integrations.filter((i) => i.status === "connected");
  const missing = integrations.filter((i) => i.status === "missing");
  const requiredMissing = missing.filter((i) => i.required).map((i) => i.id);
  const goals = typeof window === "undefined" ? [] : loadGoals();
  const hour = new Date().getHours();
  const timeOfDay: ProjectHealth["timeOfDay"] =
    hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
  return {
    integrations,
    goals,
    timeOfDay,
    connected: connected.length,
    missing: missing.length,
    total: integrations.length,
    requiredMissing,
  };
}
