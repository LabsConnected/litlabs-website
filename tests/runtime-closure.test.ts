/**
 * Runtime closure tests — verify the command registry, dispatch, doctor,
 * secret redaction, and process safety contracts.
 *
 * These tests exercise the ACTUAL registry, not a magic expected number.
 * The command count is whatever the registry actually contains.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  COMMAND_REGISTRY,
  resolveCommand,
  getCommandNames,
  getRegistry,
  validateRegistry,
  dispatchRegistry,
  redactSecrets,
  redactEnvValues,
  redactObject,
  type CommandContext,
} from "../terminal-server/command-registry.js";
import { DEEP_PROBES, FAST_PROBES } from "../terminal-server/doctor.js";

// ─── Test context ─────────────────────────────────────────────────

function makeCtx(): CommandContext {
  return {
    cwd: process.cwd(),
    userId: "test-user",
    rawInput: "",
  };
}

// ─── Registry integrity ───────────────────────────────────────────

describe("Command Registry Integrity", () => {
  it("has no duplicate commands or alias collisions", () => {
    const errors = validateRegistry();
    expect(errors).toEqual([]);
  });

  it("every spec has required fields", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(spec.command).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.category).toMatch(/^(project|brain|system|help)$/);
      expect(spec.mutability).toMatch(/^(read_only|workspace_edit|external_action)$/);
      expect(spec.responseKind).toBeTruthy();
      expect(typeof spec.handler).toBe("function");
      expect(Array.isArray(spec.aliases)).toBe(true);
      expect(typeof spec.acceptsArgs).toBe("boolean");
    }
  });

  it("command names are unique (no two specs with same command)", () => {
    const names = COMMAND_REGISTRY.map((s) => s.command);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it("aliases do not collide with command names", () => {
    const cmdNames = new Set(COMMAND_REGISTRY.map((s) => s.command));
    for (const spec of COMMAND_REGISTRY) {
      for (const alias of spec.aliases) {
        expect(cmdNames.has(alias)).toBe(false);
      }
    }
  });

  it("getCommandNames matches registry entries", () => {
    const names = getCommandNames();
    expect(names.length).toBe(COMMAND_REGISTRY.length);
    for (const spec of COMMAND_REGISTRY) {
      expect(names).toContain(spec.command);
    }
  });

  it("getRegistry returns the same array as COMMAND_REGISTRY", () => {
    expect(getRegistry()).toBe(COMMAND_REGISTRY);
  });
});

// ─── Command resolution ───────────────────────────────────────────

describe("Command Resolution", () => {
  it("resolves slash commands (e.g. /status)", () => {
    const resolved = resolveCommand("/status");
    expect(resolved).not.toBeNull();
    expect(resolved!.spec.command).toBe("status");
    expect(resolved!.args).toEqual([]);
  });

  it("resolves bare commands (e.g. status)", () => {
    const resolved = resolveCommand("status");
    expect(resolved).not.toBeNull();
    expect(resolved!.spec.command).toBe("status");
  });

  it("resolves commands with arguments (e.g. /doctor --deep)", () => {
    const resolved = resolveCommand("/doctor --deep");
    expect(resolved).not.toBeNull();
    expect(resolved!.spec.command).toBe("doctor");
    expect(resolved!.args).toEqual(["--deep"]);
  });

  it("resolves aliases (e.g. /s → status)", () => {
    const resolved = resolveCommand("/s");
    expect(resolved).not.toBeNull();
    expect(resolved!.spec.command).toBe("status");
  });

  it("returns null for unknown commands", () => {
    expect(resolveCommand("/not-real")).toBeNull();
    expect(resolveCommand("nonexistent")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveCommand("")).toBeNull();
    expect(resolveCommand("   ")).toBeNull();
  });

  it("is case-insensitive for command name", () => {
    const resolved = resolveCommand("/STATUS");
    expect(resolved).not.toBeNull();
    expect(resolved!.spec.command).toBe("status");
  });
});

// ─── Dispatch ─────────────────────────────────────────────────────

describe("Command Dispatch", () => {
  it("every registered command dispatches and returns its registered response kind", async () => {
    const ctx = makeCtx();
    // Skip commands that require external services (LLM calls) or run
    // heavy execution (check/build/test spawn real pnpm processes).
    // Those are verified by the PowerShell harness against a live server.
    const skipInTest = new Set(["ask", "web", "do", "check", "build", "test"]);
    for (const spec of COMMAND_REGISTRY) {
      if (skipInTest.has(spec.command)) continue;

      const slashCmd = `/${spec.command}`;
      const response = await dispatchRegistry(slashCmd, ctx);

      // Commands that require args may return error kind — that's OK
      if (response.kind === "error" && !response.ok) {
        // Verify it's a controlled error, not a crash
        expect(response.message).toBeTruthy();
        continue;
      }

      // Non-error responses must match the registered response kind
      expect(response.kind).toBe(spec.responseKind);
      expect(typeof response.ok).toBe("boolean");
      expect(typeof response.durationMs).toBe("number");
    }
  }, 15000);

  it("unknown command produces controlled error (never crash)", async () => {
    const ctx = makeCtx();
    const response = await dispatchRegistry("/not-real", ctx);

    expect(response.kind).toBe("error");
    expect(response.ok).toBe(false);
    expect(response.message).toContain("Unknown command");
    expect(response.message).toContain("/help");
  });

  it("/help returns help kind with command list matching registry", async () => {
    const ctx = makeCtx();
    const response = await dispatchRegistry("/help", ctx);

    expect(response.kind).toBe("help");
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty("text");
    expect(response.data).toHaveProperty("commands");

    const commands = (response.data as { commands: string[] }).commands;
    expect(commands.length).toBe(COMMAND_REGISTRY.length);
    for (const spec of COMMAND_REGISTRY) {
      expect(commands).toContain(spec.command);
    }
  });

  it("aliases resolve to the same command", async () => {
    const ctx = makeCtx();
    // /h is an alias for /help — both instant, no git/exec calls
    const aliasResponse = await dispatchRegistry("/h", ctx);
    const directResponse = await dispatchRegistry("/help", ctx);

    expect(aliasResponse.kind).toBe(directResponse.kind);
    expect(aliasResponse.kind).toBe("help");
  });
});

// ─── Doctor ───────────────────────────────────────────────────────

describe("Doctor", () => {
  beforeEach(() => {
    // Set required env vars so the environment probe passes
    process.env.TERMINAL_AUTH_SECRET = "test-auth-secret-32chars-min-length!!";
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-service-key-32chars-min-length!!";
  });

  afterEach(() => {
    delete process.env.TERMINAL_AUTH_SECRET;
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  });

  it("/doctor returns doctor kind with probes", async () => {
    const ctx = makeCtx();
    const response = await dispatchRegistry("/doctor", ctx);

    expect(response.kind).toBe("doctor");

    const data = response.data as any;
    expect(data.deep).toBe(false);
    expect(data.probes).toBeInstanceOf(Array);
    expect(data.probes.length).toBe(FAST_PROBES.length);
    expect(data.summary).toBeDefined();
    expect(data.summary.total).toBe(FAST_PROBES.length);
  });

  it("/doctor --deep returns doctor kind with deep=true and more probes", async () => {
    const ctx = makeCtx();
    const response = await dispatchRegistry("/doctor --deep", ctx);

    expect(response.kind).toBe("doctor");

    const data = response.data as any;
    expect(data.deep).toBe(true);
    expect(data.probes).toBeInstanceOf(Array);
    expect(data.probes.length).toBe(DEEP_PROBES.length);
    expect(data.probes.length).toBeGreaterThan(FAST_PROBES.length);
  });

  it("deep probes have individual timeouts defined", () => {
    for (const probe of DEEP_PROBES) {
      expect(probe.name).toBeTruthy();
      expect(probe.timeoutMs).toBeGreaterThan(0);
      expect(probe.timeoutMs).toBeLessThan(30000); // no probe should hang for 30s
      expect(probe.description).toBeTruthy();
    }
  });

  it("fast probes have individual timeouts defined", () => {
    for (const probe of FAST_PROBES) {
      expect(probe.name).toBeTruthy();
      expect(probe.timeoutMs).toBeGreaterThan(0);
      expect(probe.timeoutMs).toBeLessThan(30000);
    }
  });

  it("deep probe names are unique", () => {
    const names = DEEP_PROBES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every probe status is one of PASS/WARN/FAIL/TIMEOUT/SKIP", async () => {
    const ctx = makeCtx();
    const response = await dispatchRegistry("/doctor --deep", ctx);
    const data = response.data as any;

    const validStatuses = new Set(["PASS", "WARN", "FAIL", "TIMEOUT", "SKIP"]);
    for (const probe of data.probes) {
      expect(validStatuses.has(probe.status)).toBe(true);
      expect(typeof probe.durationMs).toBe("number");
      expect(typeof probe.reason).toBe("string");
    }
  });

  it("/doctor --deep completes even if a probe would hang", async () => {
    // This test verifies the timeout mechanism by checking that
    // /doctor --deep completes within a reasonable total time.
    // Each probe has its own timeout, so even a hanging probe
    // can't block the overall check.
    const ctx = makeCtx();
    const t0 = Date.now();
    const response = await dispatchRegistry("/doctor --deep", ctx);
    const elapsed = Date.now() - t0;

    expect(response.kind).toBe("doctor");
    // Total time should be bounded by the max individual probe timeout
    // (probes run in parallel, so total ≈ max timeout + overhead)
    const maxProbeTimeout = Math.max(...DEEP_PROBES.map((p) => p.timeoutMs));
    expect(elapsed).toBeLessThan(maxProbeTimeout + 5000); // 5s overhead
  });
});

// ─── Secret redaction ─────────────────────────────────────────────

describe("Secret Redaction", () => {
  it("redacts OpenAI-style API keys (sk-...)", () => {
    const input = "My key is sk-abc123def456ghi789jkl012mno345pqr678";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("sk-abc123def456ghi789jkl012mno345pqr678");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("Bearer abcdefghijklmnopqrstuvwxyz1234567890");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const redacted = redactSecrets(jwt);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts AWS access keys (AKIA...)", () => {
    // AKIA + exactly 16 uppercase alphanumeric chars
    const input = "AWS_KEY=AKIAIOSFODNN7EXAMPLE";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts GitHub tokens (ghp_...)", () => {
    const input = "token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz1234");
  });

  it("redacts key=value patterns for secret names", () => {
    const input = 'api_key="abcdefghijklmnop1234567890"';
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("abcdefghijklmnop1234567890");
  });

  it("redacts environment variable values with secret names", () => {
    const input = "OPENROUTER_API_KEY=sk-or-v1-abcdef1234567890abcdef1234567890";
    const redacted = redactEnvValues(input);
    expect(redacted).not.toContain("sk-or-v1-abcdef1234567890abcdef1234567890");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts secrets recursively in objects", () => {
    const obj = {
      message: "key=sk-test1234567890abcdef1234567890",
      nested: {
        token: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
        safe: "this is fine",
      },
      api_key: "secret_value_12345678",
    };
    const redacted = redactObject(obj);
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("sk-test1234567890abcdef1234567890");
    expect(json).not.toContain("Bearer abcdefghijklmnopqrstuvwxyz1234567890");
    expect(json).not.toContain("secret_value_12345678");
    expect(json).toContain("[REDACTED]");
    expect(json).toContain("this is fine");
  });

  it("does not redact non-secret strings", () => {
    const input = "This is a normal message with no secrets";
    expect(redactSecrets(input)).toBe(input);
  });

  it("synthetic secrets never appear in dispatch output", async () => {
    const ctx = makeCtx();
    const syntheticSecret = "sk-test1234567890abcdef1234567890";
    const response = await dispatchRegistry(`/ask test ${syntheticSecret}`, ctx);

    const json = JSON.stringify(response);
    expect(json).not.toContain(syntheticSecret);
  });

  it("synthetic secrets never appear in doctor output", async () => {
    // Set a synthetic env var that looks like a secret
    process.env.TEST_SECRET_KEY = "sk-test1234567890abcdef1234567890";
    try {
      const ctx = makeCtx();
      const response = await dispatchRegistry("/doctor --deep", ctx);
      const json = JSON.stringify(response);
      expect(json).not.toContain("sk-test1234567890abcdef1234567890");
    } finally {
      delete process.env.TEST_SECRET_KEY;
    }
  });
});

// ─── Process safety (static analysis) ─────────────────────────────

describe("Process Safety Contract", () => {
  it("test-runtime.ps1 does not use Stop-Process -Name node", () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, "..", "tools", "test-runtime.ps1"),
      "utf8",
    );
    expect(ps1).not.toMatch(/Stop-Process\s+-Name\s+node/i);
    expect(ps1).not.toMatch(/Stop-Process\s+-Name\s+pwsh/i);
  });

  it("test-runtime.ps1 does not use taskkill /IM", () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, "..", "tools", "test-runtime.ps1"),
      "utf8",
    );
    expect(ps1).not.toMatch(/taskkill\s+\/IM/i);
  });

  it("test-runtime.ps1 uses taskkill /PID (PID-specific)", () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, "..", "tools", "test-runtime.ps1"),
      "utf8",
    );
    expect(ps1).toMatch(/taskkill\s+\/T\s+\/F\s+\/PID/i);
  });

  it("test-runtime.ps1 has try/finally for cleanup", () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, "..", "tools", "test-runtime.ps1"),
      "utf8",
    );
    expect(ps1).toMatch(/try\s*\{/);
    expect(ps1).toMatch(/finally\s*\{/);
    expect(ps1).toMatch(/KillOnExit/i);
  });

  it("test-runtime.ps1 verifies PID ownership before killing", () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, "..", "tools", "test-runtime.ps1"),
      "utf8",
    );
    // Must check Get-Process -Id with the tracked PID
    expect(ps1).toMatch(/Get-Process\s+-Id\s+\$script:SpawnedPid/i);
  });

  it("shell.ts uses PID-specific taskkill (not /IM)", () => {
    const shell = fs.readFileSync(
      path.join(__dirname, "..", "packages", "litt-agent-core", "src", "shell.ts"),
      "utf8",
    );
    expect(shell).toMatch(/taskkill.*\/PID/i);
    expect(shell).not.toMatch(/taskkill.*\/IM/i);
  });

  it("execution.ts classifies taskkill as destructive", () => {
    const exec = fs.readFileSync(
      path.join(__dirname, "..", "packages", "litt-agent-core", "src", "execution.ts"),
      "utf8",
    );
    expect(exec).toMatch(/DESTRUCTIVE_COMMANDS/);
    expect(exec).toMatch(/taskkill/);
  });
});
