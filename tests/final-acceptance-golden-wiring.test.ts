import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { resolveAcceptanceUserId, LEGACY_QA_USER_ID } from "../scripts/final-acceptance/acceptance-user.mjs";

// Regression coverage for the CI/Clerk wiring bug where the "Run production
// golden acceptance" step only forwarded CLERK_SECRET_KEY and not
// LITT_ACCEPTANCE_USER_ID, causing the script to silently fall back to a
// stale hard-coded QA user id and fail Clerk's sign_in_tokens with a 404.

describe("final-acceptance-golden workflow secret wiring", () => {
  const workflowPath = path.resolve(
    __dirname,
    "../.github/workflows/final-acceptance-golden.yml",
  );
  const workflow = readFileSync(workflowPath, "utf-8");

  function stepBlock(stepName: string): string {
    const stepStart = workflow.indexOf(`name: ${stepName}`);
    expect(stepStart, `expected to find step "${stepName}" in ${workflowPath}`).toBeGreaterThan(-1);
    const nextStep = workflow.indexOf("\n      - name:", stepStart);
    return workflow.slice(stepStart, nextStep === -1 ? workflow.length : nextStep);
  }

  it("passes both CLERK_SECRET_KEY and LITT_ACCEPTANCE_USER_ID to the golden acceptance run", () => {
    const block = stepBlock("Run production golden acceptance");
    expect(block).toMatch(/CLERK_SECRET_KEY:\s*\$\{\{\s*secrets\.CLERK_SECRET_KEY\s*\}\}/);
    expect(block).toMatch(
      /LITT_ACCEPTANCE_USER_ID:\s*\$\{\{\s*secrets\.LITT_ACCEPTANCE_USER_ID\s*\}\}/,
    );
  });
});

describe("resolveAcceptanceUserId CI guard", () => {
  it("throws instead of silently falling back to the legacy QA user when running in CI without the secret", () => {
    expect(() => resolveAcceptanceUserId({ isCI: true, envUserId: undefined })).toThrow(
      /LITT_ACCEPTANCE_USER_ID is not set/,
    );
    expect(() => resolveAcceptanceUserId({ isCI: true, envUserId: "" })).toThrow(
      /LITT_ACCEPTANCE_USER_ID is not set/,
    );
  });

  it("uses the configured secret when present in CI", () => {
    expect(resolveAcceptanceUserId({ isCI: true, envUserId: "user_configured_qa" })).toBe(
      "user_configured_qa",
    );
  });

  it("still falls back to the legacy QA user for local/manual runs (isCI: false)", () => {
    expect(resolveAcceptanceUserId({ isCI: false, envUserId: undefined })).toBe(LEGACY_QA_USER_ID);
  });
});
