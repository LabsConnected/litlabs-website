import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const browserVariables = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_PROXY_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  "NEXT_PUBLIC_VOICE_WS_URL",
  "NEXT_PUBLIC_MODEL_NAME",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
] as const;

describe("production Docker browser configuration", () => {
  const dockerfile = fs.readFileSync(path.resolve("Dockerfile"), "utf8");

  it.each(browserVariables)("forwards %s into the Next.js build", (name) => {
    expect(dockerfile).toContain(`ARG ${name}`);
    expect(dockerfile).toContain(`ENV ${name}=$${name}`);
  });
});
