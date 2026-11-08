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
});
