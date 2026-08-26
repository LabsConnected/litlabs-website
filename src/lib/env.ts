import "server-only";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Schema definitions                                                 */
/* ------------------------------------------------------------------ */

// Variables that must be present for the core app to function at all.
// Without these, the app should refuse to start (or degrade to a
// landing page with no backend).
const coreSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().optional().default("https://litlabs.net"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, "SUPABASE_SERVICE_ROLE_KEY is required"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(10, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required"),
  CLERK_SECRET_KEY: z.string().min(10, "CLERK_SECRET_KEY is required"),
});

// Variables required only in production deployments.
const productionSchema = z.object({
  CLERK_WEBHOOK_SECRET: z.string().min(1, "CLERK_WEBHOOK_SECRET is required in production"),
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required in production"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required in production"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required in production"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters in production"),
});

// Browser-exposed (NEXT_PUBLIC_) variables. These are safe to expose.
const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().optional().default("/sign-in"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().optional().default("/sign-up"),
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: z.string().optional().default("/dashboard"),
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: z.string().optional().default("/dashboard"),
  NEXT_PUBLIC_TERMINAL_WS_URL: z.string().optional(),
  NEXT_PUBLIC_TERMINAL_HTTP_URL: z.string().optional(),
  NEXT_PUBLIC_VOICE_WS_URL: z.string().optional(),
  NEXT_PUBLIC_API_BASE: z.string().optional(),
  NEXT_PUBLIC_MEDIA_BASE: z.string().optional(),
  NEXT_PUBLIC_MODEL_NAME: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_SPOTIFY_CLIENT_ID: z.string().optional(),
});

// Optional AI provider keys — at least one should be set for AI features.
const optionalAISchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional().default("gpt-4o"),
  TOGETHER_API_KEY: z.string().optional(),
  HUGGING_FACE_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  MINIMAX_API_KEY: z.string().optional(),
  RECRAFT_API_KEY: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_AI_API_TOKEN: z.string().optional(),
  CLOUDFLARE_IMAGE_MODEL: z.string().optional(),
  SUPERMEMORY_API_KEY: z.string().optional(),
  GEMINI_PRIMARY_MODEL: z.string().optional().default("gemini-2.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().optional().default("gemini-2.5-flash-lite"),
  OPENROUTER_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
});

// Optional integration keys.
const optionalIntegrationSchema = z.object({
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_INSTALL_STATE_SECRET: z.string().optional(),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_APP_MODE: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  ALIBABA_DASHSCOPE_API_KEY: z.string().optional(),
  ALIBABA_MODELSTUDIO_WORKSPACE_ID: z.string().optional(),
  ALIBABA_MODELSTUDIO_REGION: z.string().optional(),
  ALIBABA_VIDEO_MODEL: z.string().optional(),
  ALIBABA_IMAGE_MODEL: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  INWORLD_API_KEY: z.string().optional(),
  INWORLD_LITT_VOICE: z.string().optional(),
  INWORLD_SPARK_VOICE: z.string().optional(),
  VOICE_AUTH_SECRET: z.string().optional(),
  HA_API_URL: z.string().optional(),
  HA_WS_URL: z.string().optional(),
  HA_SUPERVISOR_TOKEN: z.string().optional(),
  SUPERVISOR_TOKEN: z.string().optional(),
  HA_ADDON_MODE: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
  DISCORD_ALERTS_WEBHOOK: z.string().optional(),
  DISCORD_SYSTEM_WEBHOOK: z.string().optional(),
  VOICE_MONKEY_TOKEN: z.string().optional(),
  VOICE_MONKEY_DEVICE: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_PROJECT_NAME: z.string().optional(),
  AGENT_API_KEY: z.string().optional(),
});

// Terminal server configuration.
const terminalSchema = z.object({
  TERMINAL_AUTH_SECRET: z.string().optional(),
  TERMINAL_ALLOWED_ORIGIN: z.string().optional(),
  TERMINAL_SERVER_PORT: z.string().optional(),
  TERMINAL_WORKSPACE_ROOT: z.string().optional(),
  TERMINAL_USE_DOCKER: z.string().optional(),
  TERMINAL_INTERNAL_SERVICE_KEY: z.string().optional(),
  TERMINAL_SERVER_INTERNAL_URL: z.string().optional(),
});

// Admin / internal.
const adminSchema = z.object({
  ADMIN_CLERK_ID: z.string().optional(),
  ADMIN_CLERK_IDS: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_NAME: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_USER_ID: z.string().optional(),
  ADMIN_USER_IDS: z.string().optional(),
  INTERNAL_API_KEY: z.string().optional(),
  ENABLE_AGENT_COMMANDS: z.string().optional(),
  ENABLE_LOCAL_BUILD_API: z.string().optional(),
  TARGET_AGENT_SLUG: z.string().optional(),
  MAX_CONCURRENCY: z.string().optional(),
  POLL_INTERVAL_MS: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/*  Validation logic                                                   */
/* ------------------------------------------------------------------ */

export type EnvCategory = "core" | "production" | "public" | "ai" | "integration" | "terminal" | "admin";

export interface EnvValidationResult {
  valid: boolean;
  category: EnvCategory;
  errors: string[];
  warnings: string[];
}

/**
 * Detect whether the app is running in a deployed (non-local) environment.
 *
 * Checks for platform-specific env vars that hosting providers inject:
 *   - Railway: RAILWAY_ENVIRONMENT, RAILWAY_PROJECT_ID
 *   - Vercel:  VERCEL (kept for backward compat during transition)
 *
 * This replaces the old `process.env.VERCEL` checks scattered across the
 * codebase, which would incorrectly return false on Railway and allow
 * test-auth bypass / anonymous mode in production.
 */
export function isDeployed(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.VERCEL,
  );
}

function validateCategory(
  category: EnvCategory,
  schema: z.ZodTypeAny,
  prefix: string,
): EnvValidationResult {
  const result = schema.safeParse(process.env);
  if (result.success) {
    return { valid: true, category, errors: [], warnings: [] };
  }
  const errors = result.error.issues.map(
    (issue) => `${prefix}: ${issue.path.join(".")} — ${issue.message}`,
  );
  return { valid: false, category, errors, warnings: [] };
}

/**
 * Validate all environment variables.
 * In production, both core AND production schemas must pass.
 * In development, only core is required; production vars produce warnings.
 */
export function validateEnv(): EnvValidationResult[] {
  const isProduction = process.env.NODE_ENV === "production";
  const results: EnvValidationResult[] = [];

  // Core — always required
  results.push(validateCategory("core", coreSchema, "[core]"));

  // Production-only
  if (isProduction) {
    results.push(validateCategory("production", productionSchema, "[production]"));
  } else {
    const prodResult = validateCategory("production", productionSchema, "[production]");
    if (!prodResult.valid) {
      results.push({
        valid: true,
        category: "production",
        errors: [],
        warnings: prodResult.errors.map((e) => e + " (not required in dev)"),
      });
    }
  }

  // Public — always validated but warnings only
  const publicResult = validateCategory("public", publicSchema, "[public]");
  results.push({
    valid: true,
    category: "public",
    errors: [],
    warnings: publicResult.errors,
  });

  // AI — at least one provider key should be set
  const _aiResult = validateCategory("ai", optionalAISchema, "[ai]");
  const hasAIKey = !!(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY
  );
  results.push({
    valid: true,
    category: "ai",
    errors: [],
    warnings: hasAIKey
      ? []
      : ["[ai] No AI provider key set — AI features will be unavailable. Set at least one of: GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY"],
  });

  // Integration — optional, warnings only
  results.push(validateCategory("integration", optionalIntegrationSchema, "[integration]"));
  results.push(validateCategory("terminal", terminalSchema, "[terminal]"));
  results.push(validateCategory("admin", adminSchema, "[admin]"));

  return results;
}

/**
 * Check if ALLOW_ANONYMOUS_DEV is enabled.
 * This must NEVER be true in production.
 */
export function isAnonymousDevAllowed(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.ALLOW_ANONYMOUS_DEV === "true";
}

/**
 * Get a summary of missing required variables.
 * Never prints secret values.
 */
export function getMissingRequiredVars(): string[] {
  const missing: string[] = [];
  const coreResult = coreSchema.safeParse(process.env);
  if (!coreResult.success) {
    for (const issue of coreResult.error.issues) {
      missing.push(String(issue.path.join(".")));
    }
  }
  if (process.env.NODE_ENV === "production") {
    const prodResult = productionSchema.safeParse(process.env);
    if (!prodResult.success) {
      for (const issue of prodResult.error.issues) {
        missing.push(String(issue.path.join(".")));
      }
    }
  }
  return missing;
}

/**
 * Check if Clerk authentication is properly configured.
 * Both publishable key and secret key must be present and non-trivial.
 */
export function isClerkConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secret = process.env.CLERK_SECRET_KEY;
  return !!(key && key.length > 10 && secret && secret.length > 10);
}

/**
 * Throw if required environment variables are missing.
 * Call this at startup in server-only contexts.
 * In production, also asserts production-only variables.
 */
export function assertRequiredEnv(): void {
  const missing = getMissingRequiredVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Check .env.local or your deployment environment configuration.`,
    );
  }
}
