#!/usr/bin/env node
/**
 * Client-app environment secret guard.
 *
 * Client apps (Expo/React Native, browser bundles) have no server side.
 * Every variable in their environment is one naming mistake away from
 * being inlined into a published artifact, where it is permanently
 * extractable. `@litt/companion` previously carried a live Stripe
 * restricted key, a production Supabase service_role JWT, a live Clerk
 * secret and nine model-provider keys — while reading exactly one
 * variable (EXPO_PUBLIC_API_URL).
 *
 * This guard fails the build when a privileged credential is present in
 * a client app's environment. It runs in CI and, more importantly, at
 * container start on Railway, where the variables actually get injected.
 *
 * Two independent checks, because either alone is bypassable:
 *
 *   1. NAME  — a denylist of known secret-class variable names plus
 *              structural patterns (*_SECRET, *_API_KEY, SERVICE_ROLE…).
 *   2. VALUE — credential-shaped values, applied to EVERY variable
 *              including EXPO_PUBLIC_* / NEXT_PUBLIC_* ones. This is the
 *              check that matters: `EXPO_PUBLIC_STRIPE_SECRET_KEY` has a
 *              perfectly allowlisted name and would ship a live key into
 *              the bundle.
 *
 * Usage:
 *   node scripts/check-client-env-secrets.mjs [--app <name>] [--json]
 *
 * Exit 0 when clean, 1 when a violation is found.
 */

import { pathToFileURL } from "node:url";

/** Variable names that must never appear in a client app environment. */
export const DENIED_NAMES = new Set([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLERK_SECRET_KEY",
  "TERMINAL_AUTH_SECRET",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "VOICE_AUTH_SECRET",
  "AUTH_SECRET",
  "ADMIN_PASSWORD_HASH",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MINIMAX_API_KEY",
  "HUGGING_FACE_API_KEY",
  "INWORLD_API_KEY",
  "VAPI_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "GITHUB_TOKEN",
  "RAILWAY_TOKEN",
  "RAILWAY_API_TOKEN",
]);

/**
 * Structural name patterns. Applied only to names that are not
 * explicitly public-prefixed — a public-prefixed name is still subject
 * to the value check below, which is the stronger of the two.
 */
export const DENIED_NAME_PATTERNS = [
  /_SECRET$/,
  /_SECRET_KEY$/,
  /_API_KEY$/,
  /_PRIVATE_KEY$/,
  /SERVICE_ROLE/,
  /PASSWORD/,
  /_ACCESS_TOKEN$/,
  /_REFRESH_TOKEN$/,
];

/**
 * Credential-shaped values. Checked against every variable regardless of
 * name, because the prefix convention is exactly what a mistake bypasses.
 */
export const DENIED_VALUE_PATTERNS = [
  { re: /^sk_live_/, label: "Stripe live secret key" },
  { re: /^rk_live_/, label: "Stripe live restricted key" },
  { re: /^sk_test_/, label: "Stripe test secret key" },
  { re: /^rk_test_/, label: "Stripe test restricted key" },
  { re: /^whsec_/, label: "Stripe webhook signing secret" },
  { re: /^sk-proj-/, label: "OpenAI project key" },
  { re: /^sk-or-v1-/, label: "OpenRouter key" },
  { re: /^gsk_/, label: "Groq key" },
  { re: /^hf_/, label: "HuggingFace token" },
  { re: /^ghp_|^gho_|^ghs_/, label: "GitHub token" },
  { re: /^xox[baprs]-/, label: "Slack token" },
  { re: /^-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "PEM private key" },
  {
    // Supabase service_role JWT: header.payload.signature where the
    // decoded payload carries "role":"service_role".
    re: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./,
    label: "JWT",
    inspect: (value) => {
      try {
        const payload = value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
        return decoded.role === "service_role"
          ? "Supabase service_role JWT (bypasses RLS)"
          : null;
      } catch {
        return null;
      }
    },
  },
];

/** Names that are legitimately present and carry no privilege. */
function isAllowedName(name) {
  if (name.startsWith("RAILWAY_")) return true;
  if (name.startsWith("EXPO_PUBLIC_")) return true;
  return [
    "NODE_ENV", "PORT", "PATH", "HOME", "CI", "TZ", "LANG", "PWD",
    "SHELL", "USER", "HOSTNAME", "TERM", "npm_lifecycle_event",
  ].includes(name) || name.startsWith("npm_") || name.startsWith("PNPM_");
}

/**
 * Evaluate an environment map for client-app safety.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {{violations: Array<{name: string, kind: "name"|"value", detail: string}>}}
 */
export function auditClientEnv(env) {
  const violations = [];

  for (const [name, rawValue] of Object.entries(env)) {
    const value = typeof rawValue === "string" ? rawValue : "";
    if (!value) continue;

    // VALUE check first — applies to every name, including public ones.
    for (const pattern of DENIED_VALUE_PATTERNS) {
      if (!pattern.re.test(value)) continue;
      const detail = pattern.inspect ? pattern.inspect(value) : pattern.label;
      if (detail) {
        violations.push({ name, kind: "value", detail });
        break;
      }
    }

    if (isAllowedName(name)) continue;

    // NAME check for everything not explicitly allowed.
    if (DENIED_NAMES.has(name)) {
      violations.push({ name, kind: "name", detail: "known secret-class variable" });
      continue;
    }
    const matched = DENIED_NAME_PATTERNS.find((re) => re.test(name));
    if (matched) {
      violations.push({ name, kind: "name", detail: `matches ${matched}` });
    }
  }

  // De-duplicate: a variable failing both checks is reported once, value first.
  const seen = new Set();
  return {
    violations: violations.filter((v) => {
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    }),
  };
}

function main() {
  const args = process.argv.slice(2);
  const appIndex = args.indexOf("--app");
  const app = appIndex !== -1 ? args[appIndex + 1] : "@litt/companion";
  const asJson = args.includes("--json");

  const { violations } = auditClientEnv(process.env);

  if (asJson) {
    console.log(JSON.stringify({ app, ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log(`✓ ${app}: no privileged credentials in client environment`);
  } else {
    console.error(`\n✗ ${app}: ${violations.length} privileged credential(s) in a CLIENT app environment\n`);
    for (const v of violations) {
      console.error(`  ${v.name}`);
      console.error(`      ${v.kind === "value" ? "value looks like" : "name"}: ${v.detail}`);
    }
    console.error(
      "\nClient apps have no server side. Anything here can reach a published\n" +
      "bundle. Move these to a server-side service and remove them from this\n" +
      "environment. Never prefix a secret with EXPO_PUBLIC_ / NEXT_PUBLIC_.\n",
    );
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

// Only run when invoked directly, so the module stays importable by tests.
// pathToFileURL handles Windows drive letters and separators correctly;
// naive string interpolation does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
