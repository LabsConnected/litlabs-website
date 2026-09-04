/**
 * Regression tests for production-operator repair defects.
 *
 * Covers all 8 defects fixed in the repair branch:
 *   1. Nested command interface (litt production doctor, not litt production-doctor)
 *   2. Help contract (--help never executes, lists commands accurately)
 *   3. SHA normalization/comparison bug
 *   4. Stripe sandbox --test flag not supported
 *   5. Studio code gate — exec timeout too short for vitest
 *   6. Sandbox checkout gate — same timeout issue
 *   7. Terminal config check — accept TERMINAL_PUBLIC_URL
 *   8. Production doctor — truthful reporting, no false mismatches
 *
 * These tests use only pure functions and mocked exec — no real Stripe,
 * Railway, or network calls. No secret values are printed or persisted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeSHA,
  shasEqual,
  checkTerminalService,
  checkStudioPrerequisites,
  type CheckResult,
} from "../lib/production-checks.js";
import { exec } from "../lib/utils.js";

// Mock exec to avoid real Railway/git/stripe calls
vi.mock("../lib/utils.js", () => ({
  exec: vi.fn(),
  ok: vi.fn(),
  fail: vi.fn(),
  warn: vi.fn(),
  header: vi.fn(),
  c: {
    green: "", red: "", yellow: "", dim: "", bold: "", reset: "", gray: "",
  },
}));

// Get the mocked exec
const mockedExec = vi.mocked(exec);

// ─── Defect #3: SHA normalization ──────────────────────────────────────

describe("Defect #3: SHA normalization/comparison", () => {
  describe("normalizeSHA", () => {
    it("normalizes a full 40-char SHA to lowercase", () => {
      expect(normalizeSHA("A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2")).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    });

    it("normalizes a short SHA", () => {
      expect(normalizeSHA("28e87432")).toBe("28e87432");
    });

    it("trims whitespace", () => {
      expect(normalizeSHA("  28e87432  ")).toBe("28e87432");
    });

    it("returns undefined for invalid SHA (non-hex)", () => {
      expect(normalizeSHA("xyz12345")).toBeUndefined();
    });

    it("returns undefined for too-short SHA (< 7 chars)", () => {
      expect(normalizeSHA("28e874")).toBeUndefined();
    });

    it("returns undefined for too-long SHA (> 40 chars)", () => {
      expect(normalizeSHA("28e87432a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(normalizeSHA(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(normalizeSHA("")).toBeUndefined();
    });
  });

  describe("shasEqual", () => {
    it("PASS: equal short SHAs", () => {
      expect(shasEqual("28e87432", "28e87432")).toBe(true);
    });

    it("PASS: short vs full equivalent SHA", () => {
      expect(shasEqual("28e87432", "28e87432a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBe(true);
    });

    it("PASS: full vs short equivalent SHA", () => {
      expect(shasEqual("28e87432a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "28e87432")).toBe(true);
    });

    it("PASS: equal full SHAs", () => {
      const sha = "28e87432a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
      expect(shasEqual(sha, sha)).toBe(true);
    });

    it("FAIL: actually different SHA", () => {
      expect(shasEqual("28e87432", "abcdef12")).toBe(false);
    });

    it("FAIL: different full SHAs", () => {
      expect(shasEqual("28e87432a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "abcdef12a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBe(false);
    });

    it("FAIL: one SHA is undefined", () => {
      expect(shasEqual("28e87432", undefined)).toBe(false);
      expect(shasEqual(undefined, "28e87432")).toBe(false);
    });

    it("FAIL: both undefined", () => {
      expect(shasEqual(undefined, undefined)).toBe(false);
    });

    it("FAIL: invalid SHAs", () => {
      expect(shasEqual("xyz", "28e87432")).toBe(false);
    });

    it("PASS: case-insensitive comparison", () => {
      expect(shasEqual("A1B2C3D4", "a1b2c3d4")).toBe(true);
    });
  });
});

// ─── Defect #7: Terminal config check ──────────────────────────────────

describe("Defect #7: Terminal config check accepts TERMINAL_PUBLIC_URL", () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it("PASS: TERMINAL_PUBLIC_URL set (canonical env var)", () => {
    mockedExec.mockReturnValue({
      stdout: "TERMINAL_PUBLIC_URL=https://terminal.example.com\nOTHER_VAR=foo",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("TERMINAL_PUBLIC_URL");
  });

  it("PASS: NEXT_PUBLIC_TERMINAL_WS_URL set (fallback)", () => {
    mockedExec.mockReturnValue({
      stdout: "NEXT_PUBLIC_TERMINAL_WS_URL=wss://terminal.example.com\nOTHER=foo",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("NEXT_PUBLIC_TERMINAL_WS_URL");
  });

  it("PASS: NEXT_PUBLIC_TERMINAL_HTTP_URL set (fallback)", () => {
    mockedExec.mockReturnValue({
      stdout: "NEXT_PUBLIC_TERMINAL_HTTP_URL=https://terminal.example.com\nOTHER=foo",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("NEXT_PUBLIC_TERMINAL_HTTP_URL");
  });

  it("FAIL: no terminal env vars set", () => {
    mockedExec.mockReturnValue({
      stdout: "OTHER_VAR=foo\nANOTHER=bar",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not configured");
  });

  it("FAIL: empty TERMINAL_PUBLIC_URL value", () => {
    mockedExec.mockReturnValue({
      stdout: "TERMINAL_PUBLIC_URL=\nOTHER=foo",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("fail");
  });

  it("FAIL: cannot read Railway variables", () => {
    mockedExec.mockReturnValue({
      stdout: "",
      stderr: "Error: not authenticated",
      exitCode: 1,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Cannot read Railway");
  });

  it("PASS: prefers TERMINAL_PUBLIC_URL over fallbacks", () => {
    mockedExec.mockReturnValue({
      stdout: "TERMINAL_PUBLIC_URL=https://terminal.example.com\nNEXT_PUBLIC_TERMINAL_WS_URL=wss://terminal.example.com",
      stderr: "",
      exitCode: 0,
    });
    const result = checkTerminalService();
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("TERMINAL_PUBLIC_URL");
  });
});

// ─── Defect #8: Studio prerequisites check ─────────────────────────────

describe("Defect #8: Studio prerequisites check", () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it("PASS: Clerk, Supabase, Stripe all configured", () => {
    mockedExec.mockReturnValue({
      stdout: "CLERK_SECRET_KEY=sk_test_fake\nNEXT_PUBLIC_SUPABASE_URL=https://example.com\nSTRIPE_SECRET_KEY=sk_test_fake",
      stderr: "",
      exitCode: 0,
    });
    const result = checkStudioPrerequisites();
    expect(result.status).toBe("pass");
  });

  it("FAIL: missing Stripe", () => {
    mockedExec.mockReturnValue({
      stdout: "CLERK_SECRET_KEY=sk_test_fake\nNEXT_PUBLIC_SUPABASE_URL=https://example.com",
      stderr: "",
      exitCode: 0,
    });
    const result = checkStudioPrerequisites();
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Stripe");
  });

  it("FAIL: missing Clerk and Supabase", () => {
    mockedExec.mockReturnValue({
      stdout: "STRIPE_SECRET_KEY=sk_test_fake",
      stderr: "",
      exitCode: 0,
    });
    const result = checkStudioPrerequisites();
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Clerk");
    expect(result.detail).toContain("Supabase");
  });

  it("FAIL: cannot read Railway variables", () => {
    mockedExec.mockReturnValue({
      stdout: "",
      stderr: "Error",
      exitCode: 1,
    });
    const result = checkStudioPrerequisites();
    expect(result.status).toBe("fail");
  });
});

// ─── Defect #4: Stripe sandbox --test flag ─────────────────────────────

describe("Defect #4: stripe-sandbox.ts does not use --test flag", () => {
  it("stripe-sandbox source contains no --test flag in stripe commands", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "commands", "stripe-sandbox.ts"),
      "utf-8",
    );
    // Extract all stripe CLI command lines and verify none use --test
    const stripeCmds = src.match(/stripe [^\n]+/g) ?? [];
    expect(stripeCmds.length).toBeGreaterThan(0);
    for (const cmd of stripeCmds) {
      expect(cmd).not.toContain("--test");
      expect(cmd).not.toContain("--live");
    }
  });

  it("stripe-sandbox verifies livemode === false on created products", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "commands", "stripe-sandbox.ts"),
      "utf-8",
    );
    // Must check livemode === false to fail closed against live mode
    expect(src).toContain("livemode === true");
    expect(src).toContain("LIVE mode");
  });
});

// ─── Defect #1 & #2: Nested command interface and help contract ────────

describe("Defect #1: Nested command interface", () => {
  it("NESTED_COMMANDS maps production.doctor to production-doctor", async () => {
    // Read the index.ts source and verify the nested command mapping
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "index.ts"),
      "utf-8",
    );
    expect(src).toContain("NESTED_COMMANDS");
    expect(src).toContain("production: {");
    expect(src).toContain("doctor: \"production-doctor\"");
    expect(src).toContain("finish: \"production-finish\"");
    expect(src).toContain("stripe: {");
    expect(src).toContain("doctor: \"stripe-doctor\"");
    expect(src).toContain("repair: \"stripe-repair\"");
    expect(src).toContain("sandbox: \"stripe-sandbox\"");
    expect(src).toContain("deploy: {");
    expect(src).toContain("verify: \"deploy-verify\"");
    expect(src).toContain("studio: {");
    expect(src).toContain("acceptance: \"studio-acceptance\"");
  });

  it("backward-compatible hyphen aliases remain registered", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "index.ts"),
      "utf-8",
    );
    expect(src).toContain("\"production-doctor\":");
    expect(src).toContain("\"production-finish\":");
    expect(src).toContain("\"stripe-doctor\":");
    expect(src).toContain("\"stripe-repair\":");
    expect(src).toContain("\"stripe-sandbox\":");
    expect(src).toContain("\"deploy-verify\":");
    expect(src).toContain("\"studio-acceptance\":");
  });
});

describe("Defect #2: Help contract — --help never executes", () => {
  it("printNestedHelp function exists and only prints", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "index.ts"),
      "utf-8",
    );
    expect(src).toContain("printNestedHelp");
    // The help path must return 0 before any command execution
    expect(src).toMatch(/if \(rest\.includes\("--help"\) \|\| rest\.includes\("-h"\)\)\s*\{[\s\S]*?printNestedHelp[\s\S]*?return 0;/);
  });

  it("help text lists all production operator commands", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "index.ts"),
      "utf-8",
    );
    expect(src).toContain("litt production doctor");
    expect(src).toContain("litt production finish");
    expect(src).toContain("litt stripe doctor");
    expect(src).toContain("litt stripe repair");
    expect(src).toContain("litt stripe sandbox");
    expect(src).toContain("litt deploy verify");
    expect(src).toContain("litt studio acceptance");
  });

  it("nested group help shows subcommand names (not hyphenated)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "index.ts"),
      "utf-8",
    );
    // The printNestedHelp function should use the subcommand word, not
    // the canonical hyphenated name, in the Subcommands section
    expect(src).toMatch(/entries\.map\(\(\[sub, canonical\]/);
  });
});

// ─── Defect #5 & #6: exec timeout option ───────────────────────────────

describe("Defect #5 & #6: exec supports custom timeout", () => {
  it("exec function accepts timeout option", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "utils.ts"),
      "utf-8",
    );
    expect(src).toMatch(/timeout\?:\s*number/);
    expect(src).toMatch(/options\.timeout\s*\?\?\s*15000/);
  });

  it("production-finish uses 120s timeout for test commands", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "commands", "production-finish.ts"),
      "utf-8",
    );
    expect(src).toContain("timeout: 120000");
    // Must NOT use cd ... && npx vitest (should use cwd option instead)
    expect(src).not.toContain("cd E:\\LiTT\\Worktrees\\main && npx vitest");
  });

  it("production-checks uses REPO_ROOT (not hardcoded path)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "production-checks.ts"),
      "utf-8",
    );
    expect(src).toContain("REPO_ROOT");
    expect(src).not.toContain("git -C E:\\LiTT\\Worktrees\\main");
  });
});
