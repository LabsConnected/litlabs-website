import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (
    !supabaseUrl ||
    !supabaseKey ||
    supabaseKey.includes("your-anon") ||
    supabaseKey.length < 10
  ) {
    // Return null instead of crashing during static prerendering
    return null;
  }
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// 🔱 Build-Safe Proxy Engine
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    if (!client) {
      // During static prerendering (no env keys), return safe stubs instead of crashing
      return typeof prop === "string" &&
        ["from", "auth", "channel"].includes(prop)
        ? () => ({ select: () => ({}), insert: () => ({}) })
        : undefined;
    }
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Server-only admin client using service role key (bypasses RLS - server routes only)
let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey || serviceKey.length < 10) {
    return null;
  }
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    if (!client) {
      return typeof prop === "string" && ["from"].includes(prop)
        ? () => ({ select: () => ({}), insert: () => ({}), update: () => ({}) })
        : undefined;
    }
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Types for database tables
export type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  avatar_url: string;
  system_prompt: string;
  personality: string;
  price_cents: number;
  is_public: boolean;
  features: string[];
  created_at: string;
};

export type UserAgent = {
  id: string;
  user_id: string;
  agent_id: string;
  installed_at: string;
  agent?: Agent;
};

export type Conversation = {
  id: string;
  user_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  agent?: Agent;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type RunStatus =
  | "pending"
  | "needs_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type RunSource = "chat" | "terminal" | "api" | "workflow" | "agent";
export type RunRiskLevel = "low" | "medium" | "high" | "critical";
export type RunStepType =
  | "step"
  | "terminal_output"
  | "diff"
  | "review"
  | "error"
  | "approval"
  | "artifact"
  | "tool"
  | "system";
export type RunStepStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "skipped"
  | "awaiting_approval";
export type RunArtifactKind =
  | "diff"
  | "screenshot"
  | "log"
  | "file"
  | "preview"
  | "error"
  | "report";

export type Run = {
  id: string;
  project_id?: string | null;
  owner_id: string;
  status: RunStatus;
  source: RunSource;
  intent: string;
  plan?: Record<string, unknown> | null;
  risk_level: RunRiskLevel;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type RunStep = {
  id: string;
  run_id: string;
  type: RunStepType;
  title: string;
  status: RunStepStatus;
  command?: string | null;
  risk_level?: RunRiskLevel | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  exit_code?: number | null;
  started_at: string;
  finished_at?: string | null;
};

export type RunArtifact = {
  id: string;
  run_id: string;
  step_id?: string | null;
  kind: RunArtifactKind;
  path: string;
  mime?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type DirectorPlan = {
  goal: string;
  steps: Array<{
    id: string;
    title: string;
    type: "tool" | "terminal" | "diff" | "review" | "finish";
    command?: string;
    expected_files?: string[];
    tool?: string;
    args?: Record<string, unknown>;
    needs_approval?: boolean;
    risk_level?: RunRiskLevel;
  }>;
};
