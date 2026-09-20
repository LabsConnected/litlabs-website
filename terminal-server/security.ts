const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\w)/,
  /mkfs\b/,
  /:\(\)\s*\{\s*:\|\:\&\s*\}\s*;\s*:/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /dd\s+if=\/dev\/zero/,
  /chmod\s+-R\s+777\s+\//,
  /chown\s+-R\s+0:0\s+\//,
  />\s*\/dev\/sda\b/,
  /curl\b.*\|\s*(bash|sh)\b/,
  /wget\b.*\|\s*(bash|sh)\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /\bssh\b.*-R\b/,
  /\bbase64\b.*\|\s*(bash|sh)\b/,
  /\$\([^)]*\)/,
  /`[^`]*`/,
  /\bkill\s+-9\s+1\b/,
  /\bkillall\b/,
  /\bpkill\b.*-1\b/,
];

export function isBlockedCommand(input: string): boolean {
  const normalized = input.toLowerCase();
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface AuditEntry {
  timestamp: string;
  userId: string;
  sessionId: string;
  command: string;
  blocked: boolean;
  workspaceId?: string;
}

// In-memory ring buffer — used for low-latency local lookups and as a fallback
// when the Supabase write fails. Survives only for the lifetime of the process.
const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 1_000; // smaller now; durable storage is Supabase

// ── Supabase persistence ──────────────────────────────────────────────────────
// Lazy-loaded so the terminal-server doesn't pay the import cost unless the
// Supabase URL and service-role key are actually configured.
let _supabase: import("@supabase/supabase-js").SupabaseClient | null | undefined;

async function getSupabase(): Promise<import("@supabase/supabase-js").SupabaseClient | null> {
  if (_supabase !== undefined) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) {
    _supabase = null;
    return null;
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    _supabase = createClient(url, key, { auth: { persistSession: false } });
    return _supabase;
  } catch {
    _supabase = null;
    return null;
  }
}

export function auditCommand(
  userId: string,
  sessionId: string,
  command: string,
  blocked: boolean,
  workspaceId?: string,
): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    userId,
    sessionId,
    command: command.slice(0, 500),
    blocked,
    workspaceId,
  };

  // In-memory ring buffer (local fallback / fast reads)
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }

  if (blocked) {
    console.warn(`[Audit] Blocked command by ${userId} in ${sessionId}: ${entry.command}`);
  }

  // Fire-and-forget Supabase persist — never awaited so a DB hiccup cannot
  // block or delay command execution in the calling path.
  getSupabase().then((sb) => {
    if (!sb) return;
    sb.from("terminal_audit_log")
      .insert({
        user_id: userId,
        session_id: sessionId,
        command: entry.command,
        blocked,
        workspace_id: workspaceId ?? null,
      })
      .then(({ error }) => {
        if (error) {
          console.error("[Audit] Supabase insert failed:", error.message);
        }
      });
  }).catch(() => {});
}

export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit);
}

export function sanitizeEnv(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-\.:\/=@\s]/g, "");
}

export function redactSecrets(output: string): string {
  const patterns = [
    // Generic secret-key prefixes (OpenAI, Anthropic, etc.)
    /(sk-[a-zA-Z0-9]{20,})/g,
    // Supabase JWTs (start with eyJ)
    /(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/g,
    // Named env-var assignments (key=value — redact the value portion)
    /(OPENROUTER_API_KEY=)[^\s&"]*/g,
    /(CLERK_SECRET_KEY=)[^\s&"]*/g,
    /(AUTH_SECRET=)[^\s&"]*/g,
    /(SUPERMEMORY_API_KEY=)[^\s&"]*/g,
    /(DATABASE_URL=)[^\s&"]*/g,
    /(TERMINAL_AUTH_SECRET=)[^\s&"]*/g,
    /(TERMINAL_INTERNAL_SERVICE_KEY=)[^\s&"]*/g,
    /(STRIPE_SECRET_KEY=)[^\s&"]*/g,
    /(STRIPE_WEBHOOK_SECRET=)[^\s&"]*/g,
    /(SUPABASE_SERVICE_ROLE_KEY=)[^\s&"]*/g,
    /(SUPABASE_SECRET_KEY=)[^\s&"]*/g,
    /(NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=)[^\s&"]*/g,
    /(GROQ_API_KEY=)[^\s&"]*/g,
    /(GEMINI_API_KEY=)[^\s&"]*/g,
    /(GOOGLE_API_KEY=)[^\s&"]*/g,
    /(OPENAI_API_KEY=)[^\s&"]*/g,
    /(MISTRAL_API_KEY=)[^\s&"]*/g,
    /(FAL_KEY=)[^\s&"]*/g,
    /(LIVEKIT_API_SECRET=)[^\s&"]*/g,
    /(VOICE_AUTH_SECRET=)[^\s&"]*/g,
    /(RESEND_API_KEY=)[^\s&"]*/g,
    /(INWORLD_API_KEY=)[^\s&"]*/g,
    /(RAILWAY_API_TOKEN=)[^\s&"]*/g,
    /(INTERNAL_API_KEY=)[^\s&"]*/g,
    /(AGENT_API_KEY=)[^\s&"]*/g,
    /(CLERK_WEBHOOK_SECRET=)[^\s&"]*/g,
    /(GITHUB_PRIVATE_KEY=)[^\s&"]*/g,
    /(GITHUB_WEBHOOK_SECRET=)[^\s&"]*/g,
    /(META_APP_SECRET=)[^\s&"]*/g,
    /(R2_SECRET_ACCESS_KEY=)[^\s&"]*/g,
    /(AWS_SECRET_ACCESS_KEY=)[^\s&"]*/g,
    /(VAPID_PRIVATE_KEY=)[^\s&"]*/g,
  ];

  let result = output;
  for (const pattern of patterns) {
    result = result.replace(pattern, "$1***REDACTED***");
  }
  return result;
}
