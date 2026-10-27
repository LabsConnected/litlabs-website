#!/usr/bin/env node
/**
 * Validates .env.local SHAPE only — names, formats, environment identity.
 * NEVER prints a value. Run: node scripts/validate-env-shape.mjs
 */
import { readFileSync } from "fs";

const env = {};
for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

const checks = [];
const add = (name, ok, hint) => checks.push({ name, ok, hint });
const v = (k) => env[k] ?? "";
const isPlaceholder = (k) => v(k).includes("__PASTE_") || v(k) === "";

// ── Identity: this must be the STAGING project, never production ──
add(
  "Supabase URL is staging project txsalzljvglbrnldikco",
  v("NEXT_PUBLIC_SUPABASE_URL") === "https://txsalzljvglbrnldikco.supabase.co",
  "must equal the staging project URL exactly",
);
add(
  "Production Supabase project absent",
  !v("NEXT_PUBLIC_SUPABASE_URL").includes("rokbfvuoqildggnhappy"),
  "production project must never appear",
);

// ── Clerk: development instance only ──
add(
  "Clerk publishable key is a dev key (pk_test_)",
  v("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY").startsWith("pk_test_"),
  isPlaceholder("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") ? "PASTE from Clerk dev instance" : "expected pk_test_…",
);
add(
  "Clerk secret key is a dev key (sk_test_)",
  v("CLERK_SECRET_KEY").startsWith("sk_test_"),
  isPlaceholder("CLERK_SECRET_KEY") ? "PASTE from Clerk dev instance" : "expected sk_test_…",
);
add(
  "Clerk proxy URL empty (dev instance needs none)",
  v("NEXT_PUBLIC_CLERK_PROXY_URL") === "",
  "a proxy URL points Clerk at production — must be empty for dev",
);

// ── Supabase keys: JWT-shaped ──
for (const k of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  add(
    `${k} is JWT-shaped`,
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v(k)),
    isPlaceholder(k) ? "PASTE from Supabase dashboard → API" : "expected a JWT",
  );
}

// ── Local secrets: present, long enough, distinct ──
for (const k of ["TERMINAL_AUTH_SECRET", "TERMINAL_INTERNAL_SERVICE_KEY", "AUTH_SECRET", "INTERNAL_API_KEY"]) {
  add(`${k} >= 32 chars`, v(k).length >= 32, "generate: openssl rand -hex 32");
}
add(
  "Local secrets are distinct",
  new Set(["TERMINAL_AUTH_SECRET", "TERMINAL_INTERNAL_SERVICE_KEY", "AUTH_SECRET", "INTERNAL_API_KEY"].map(v)).size === 4,
  "each local secret must be independently generated",
);

// ── Locality / safety switches ──
add("TERMINAL_USE_DOCKER=false", v("TERMINAL_USE_DOCKER") === "false", "Docker not used");
add("ALLOW_ANONYMOUS_DEV=false", v("ALLOW_ANONYMOUS_DEV") === "false", "real sign-in E2E requires this off");
add("App URL is localhost", /^http:\/\/localhost:\d+$/.test(v("NEXT_PUBLIC_APP_URL")), "local run");
add("Terminal URLs are localhost", v("NEXT_PUBLIC_TERMINAL_HTTP_URL").startsWith("http://localhost"), "local terminal");

// ── Paid hosting must NOT be configured ──
add(
  "Railway hosting unconfigured (publish stays local-equivalence)",
  !v("RAILWAY_API_TOKEN"),
  "do not set Railway credentials — real deploys are out of scope",
);

let failed = 0;
for (const c of checks) {
  const pending = c.ok === false && c.hint?.startsWith("PASTE");
  const tag = c.ok ? "PASS" : pending ? "PENDING-USER" : "FAIL";
  if (!c.ok) failed++;
  console.log(`${tag.padEnd(12)} ${c.name}${c.ok ? "" : ` — ${c.hint}`}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks pass; ${failed} pending/failed`);
process.exit(failed > 0 ? 1 : 0);
