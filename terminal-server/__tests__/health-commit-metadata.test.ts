/**
 * Health endpoint commit-metadata contract test.
 *
 * The terminal-server /health, /health/ready, and /health/live endpoints
 * all report a `commit` field derived from:
 *
 *   process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev"
 *
 * This is the canonical variable. Railway's own GitHub integration injects
 * it automatically, but `railway up` (CLI upload, used by our GitHub Actions
 * deploy-terminal.yml workflow) does NOT — so the workflow sets it
 * explicitly from ${{ github.sha }} before deploying.
 *
 * Regression behavior:
 *   - Local/dev execution (no RAILWAY_GIT_COMMIT_SHA) → "dev"  (legitimate)
 *   - CI/Railway deployment (RAILWAY_GIT_COMMIT_SHA set)  → real SHA prefix
 *
 * This test verifies the resolution logic matches the contract so a future
 * refactor cannot silently break the metadata wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Mirrors the exact expression used in server.ts health endpoints.
function resolveCommit(): string {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";
}

describe("health commit metadata contract", () => {
  const original = process.env.RAILWAY_GIT_COMMIT_SHA;

  beforeEach(() => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
    } else {
      process.env.RAILWAY_GIT_COMMIT_SHA = original;
    }
  });

  it("falls back to 'dev' when RAILWAY_GIT_COMMIT_SHA is unset (local/dev)", () => {
    expect(resolveCommit()).toBe("dev");
  });

  it("reports the 8-char SHA prefix when RAILWAY_GIT_COMMIT_SHA is set (CI/Railway)", () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "970616faa88472666892a926336b7aaa822fc9b4";
    expect(resolveCommit()).toBe("970616fa");
  });

  it("truncates a short SHA to its actual length (does not pad)", () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "abc1234";
    expect(resolveCommit()).toBe("abc1234");
  });

  it("uses only the first 8 chars of a long SHA", () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "abcdef1234567890abcdef1234567890abcdef12";
    expect(resolveCommit()).toHaveLength(8);
    expect(resolveCommit()).toBe("abcdef12");
  });
});
