import { describe, it, expect } from "vitest";
import { redactSecrets } from "../ink/activity-redact.js";

describe("redactSecrets — activity feed credential scrubbing", () => {
  it("redacts sk- style keys", () => {
    expect(redactSecrets("key sk-abc123def456ghi in log")).toContain("sk-•••");
    expect(redactSecrets("key sk-abc123def456ghi in log")).not.toContain("abc123def456ghi");
  });
  it("redacts Bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")).toContain("Bearer •••");
  });
  it("redacts KEY=value forms", () => {
    expect(redactSecrets("OPENROUTER_API_KEY=xyz789secret")).toBe("OPENROUTER_API_KEY=•••");
    expect(redactSecrets("API_TOKEN=tok123")).toBe("API_TOKEN=•••");
    expect(redactSecrets("DB_PASSWORD=hunter2")).toBe("DB_PASSWORD=•••");
  });
  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("read src/app.tsx 42 lines")).toBe("read src/app.tsx 42 lines");
    expect(redactSecrets("exit code 0")).toBe("exit code 0");
  });
  it("redacts git host tokens", () => {
    const out = redactSecrets("clone https://x-access-token:ghp_abcdefghijklmnop@github.com/o/r");
    expect(out).not.toContain("ghp_abcdefghijklmnop");
    expect(out).not.toContain("abcdefghijklmnop");
  });
  it("redacts JWTs", () => {
    // Built at runtime so no contiguous JWT literal exists in the file —
    // gitleaks' jwt rule flags even well-known example tokens.
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
    ].join(".");
    expect(redactSecrets(`token ${jwt} end`)).not.toContain(jwt);
    expect(redactSecrets(`token ${jwt} end`)).toContain("eyJ•••");
  });
  it("redacts Authorization headers and lowercase env assignments", () => {
    expect(redactSecrets("Authorization: Bearer abcdef123456")).toContain("Bearer •••");
    expect(redactSecrets("Authorization=abcdef123456")).toContain("Authorization=•••");
    expect(redactSecrets("api_key=lowercase_secret_123")).toBe("api_key=•••");
    expect(redactSecrets("my_token: tok_live_abc")).toBe("my_token=•••");
  });
  it("redacts CLI flag secrets", () => {
    expect(redactSecrets("curl --api-key=SEKRET123 https://x")).toBe("curl --api-key=••• https://x");
    expect(redactSecrets("tool --token abcdef123456 run")).toBe("tool --token ••• run");
  });
  it("does not redact unrelated flag-like text", () => {
    expect(redactSecrets("git --version")).toBe("git --version");
    expect(redactSecrets("npm run build -- --mode production")).toBe("npm run build -- --mode production");
  });
});
