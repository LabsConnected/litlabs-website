import { describe, it, expect } from "vitest";
import { auditClientEnv } from "../scripts/check-client-env-secrets.mjs";

/**
 * Guard for the client-app environment check.
 *
 * `@litt/companion` is an Expo app: no server side, so every variable in
 * its environment is one naming mistake from a published bundle. These
 * tests pin the two behaviours that matter — that real secrets are
 * caught even under a "public" name, and that genuinely public values
 * are not flagged (a guard that cries wolf gets disabled).
 */

const SERVICE_ROLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

const ANON_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiJ9.sig";

const names = (env: Record<string, string>) =>
  auditClientEnv(env).violations.map((v: { name: string }) => v.name).sort();

describe("auditClientEnv", () => {
  it("passes a minimal, correct companion environment", () => {
    expect(
      names({
        EXPO_PUBLIC_API_URL: "https://litlabslitt-shell-preview-studio-phase-2.up.railway.app",
        RAILWAY_SERVICE_NAME: "@litt/companion",
        RAILWAY_ENVIRONMENT_NAME: "preview-studio-phase-2",
        NODE_ENV: "production",
      }),
    ).toEqual([]);
  });

  it("rejects the credentials that were actually present on the service", () => {
    expect(
      names({
        STRIPE_SECRET_KEY: "rk_live_example",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
        CLERK_SECRET_KEY: "sk_live_example",
        OPENAI_API_KEY: "sk-proj-example",
        TERMINAL_INTERNAL_SERVICE_KEY: "a".repeat(96),
      }),
    ).toEqual([
      "CLERK_SECRET_KEY",
      "OPENAI_API_KEY",
      "STRIPE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TERMINAL_INTERNAL_SERVICE_KEY",
    ]);
  });

  it("catches a secret smuggled in under an EXPO_PUBLIC_ name", () => {
    // The whole point: the name is allowlisted, the value is not. A
    // name-only denylist ships this key inside the published bundle.
    const result = auditClientEnv({ EXPO_PUBLIC_STRIPE_SECRET_KEY: "sk_live_example" });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      name: "EXPO_PUBLIC_STRIPE_SECRET_KEY",
      kind: "value",
    });
  });

  it("does not flag a Supabase anon key, which is meant to be public", () => {
    expect(names({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT })).toEqual([]);
  });

  it("does not flag publishable keys or public URLs", () => {
    expect(
      names({
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAEHCVaLSs2VhvGYS",
        EXPO_PUBLIC_API_URL: "https://example.com",
      }),
    ).toEqual([]);
  });

  it("distinguishes a service_role JWT from any other JWT", () => {
    const flagged = auditClientEnv({ SOME_JWT: SERVICE_ROLE_JWT }).violations;
    expect(flagged[0].detail).toContain("service_role");
    expect(names({ SOME_JWT: ANON_JWT })).toEqual([]);
  });

  it("reports each offending variable exactly once", () => {
    // STRIPE_SECRET_KEY fails both the name and the value check.
    expect(auditClientEnv({ STRIPE_SECRET_KEY: "sk_live_example" }).violations).toHaveLength(1);
  });

  it("ignores empty values so unset variables are not false positives", () => {
    expect(names({ STRIPE_SECRET_KEY: "", OPENAI_API_KEY: "" })).toEqual([]);
  });
});
