/**
 * Adversarial tests for Phase 3A — structured execution boundary.
 *
 * These tests verify that runCommand() (the secure structured executor)
 * rejects shell injection attempts, enforces mission modes, redacts secrets,
 * and that runShellCommand() is disabled by default.
 *
 * Attack vectors tested:
 *   - & whoami
 *   - && whoami
 *   - | whoami
 *   - ; whoami
 *   - $(...)
 *   - `...`
 *   - > file
 *   - < file
 *   - %ENV%
 *   - path traversal
 *   - quoted arguments
 *   - spaces in paths
 *   - Unicode paths
 *   - malicious package-script arguments
 *   - cancellation
 *   - timeout
 *   - huge stdout/stderr
 *   - secret redaction
 *   - PLAN mode rejection
 *   - dangerous command rejection
 *   - non-allowlisted command rejection
 *   - runShellCommand disabled
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  createShellExecutor,
  runCommandSecure,
  runShellCommand,
  assessRisk,
  detectShellInjection,
  redactSecrets,
  ExecutionError,
} from "../index.js";
import type { MissionMode } from "../index.js";

// ─── Helpers ───────────────────────────────────────────────────────

function makeTempDir(name: string): string {
  const tmp = path.join(os.tmpdir(), `litt-3a-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanup(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ }
}

// ─── Shell injection detection ─────────────────────────────────────

describe("Phase 3A — Shell injection detection", () => {
  it("rejects & whoami", () => {
    assert.ok(detectShellInjection("& whoami"));
  });

  it("rejects && whoami", () => {
    assert.ok(detectShellInjection("&& whoami"));
  });

  it("rejects | whoami", () => {
    assert.ok(detectShellInjection("| whoami"));
  });

  it("rejects ; whoami", () => {
    assert.ok(detectShellInjection("; whoami"));
  });

  it("rejects $(whoami)", () => {
    assert.ok(detectShellInjection("$(whoami)"));
  });

  it("rejects `whoami`", () => {
    assert.ok(detectShellInjection("`whoami`"));
  });

  it("rejects > file", () => {
    assert.ok(detectShellInjection("> /etc/passwd"));
  });

  it("rejects < file", () => {
    assert.ok(detectShellInjection("< /etc/passwd"));
  });

  it("rejects %ENV% (Windows env expansion)", () => {
    assert.ok(detectShellInjection("%PATH%"));
  });

  it("rejects $variable (PowerShell)", () => {
    assert.ok(detectShellInjection("$env:PATH"));
  });

  it("rejects ${...} (PowerShell variable expansion)", () => {
    assert.ok(detectShellInjection("${env:PATH}"));
  });

  it("accepts clean arguments", () => {
    assert.equal(detectShellInjection("hello world"), null);
    assert.equal(detectShellInjection("--flag"), null);
    assert.equal(detectShellInjection("file.ts"), null);
    assert.equal(detectShellInjection("src/lib/utils.ts"), null);
  });
});

// ─── runCommand rejects injection in args ──────────────────────────

describe("Phase 3A — runCommand rejects shell injection in args", () => {
  const injectionArgs = [
    "& whoami",
    "&& whoami",
    "| whoami",
    "; whoami",
    "$(whoami)",
    "`whoami`",
    "> /tmp/evil",
    "< /etc/passwd",
    "%PATH%",
    "$env:PATH",
  ];

  for (const evil of injectionArgs) {
    it(`rejects arg: "${evil}"`, async () => {
      const tmp = makeTempDir("injection");
      try {
        const shell = createShellExecutor(tmp);
        const result = await runCommandSecure(shell, "node", ["-e", evil], { cwd: tmp });
        assert.equal(result.success, false);
        assert.match(result.data.code as string, /ARG_INJECTION/);
      } finally { cleanup(tmp); }
    });
  }
});

// ─── Allowlist enforcement ─────────────────────────────────────────

describe("Phase 3A — Allowlist enforcement", () => {
  it("rejects non-allowlisted command", async () => {
    const tmp = makeTempDir("allowlist");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "curl", ["http://evil.com"], { cwd: tmp });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /COMMAND_NOT_ALLOWED/);
    } finally { cleanup(tmp); }
  });

  it("rejects wget", async () => {
    const tmp = makeTempDir("allowlist2");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "wget", ["http://evil.com"], { cwd: tmp });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /COMMAND_NOT_ALLOWED/);
    } finally { cleanup(tmp); }
  });

  it("allows node", async () => {
    const tmp = makeTempDir("allowlist3");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], { cwd: tmp });
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Dangerous commands ────────────────────────────────────────────

describe("Phase 3A — Dangerous command rejection", () => {
  it("rejects rm without approval provider", async () => {
    const tmp = makeTempDir("danger");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "rm", ["-rf", "/"], { cwd: tmp });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /APPROVAL_REQUIRED/);
    } finally { cleanup(tmp); }
  });

  it("rejects del without approval provider", async () => {
    const tmp = makeTempDir("danger2");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "del", ["*"], { cwd: tmp });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /APPROVAL_REQUIRED/);
    } finally { cleanup(tmp); }
  });
});

// ─── PLAN mode ─────────────────────────────────────────────────────

describe("Phase 3A — PLAN mode rejects mutations", () => {
  it("rejects git commit in PLAN mode", async () => {
    const tmp = makeTempDir("plan");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "git", ["commit", "-m", "test"], {
        cwd: tmp,
        mode: "plan" as MissionMode,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PLAN_MODE_REJECTED/);
    } finally { cleanup(tmp); }
  });

  it("rejects npm install in PLAN mode", async () => {
    const tmp = makeTempDir("plan2");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "npm", ["install"], {
        cwd: tmp,
        mode: "plan" as MissionMode,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PLAN_MODE_REJECTED/);
    } finally { cleanup(tmp); }
  });

  it("allows node -e in PLAN mode (read-only)", async () => {
    const tmp = makeTempDir("plan3");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], {
        cwd: tmp,
        mode: "plan" as MissionMode,
      });
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Path escape protection ────────────────────────────────────────

describe("Phase 3A — Path escape protection", () => {
  it("rejects cwd outside workspace root", async () => {
    const tmp = makeTempDir("escape");
    const outside = makeTempDir("outside");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], {
        cwd: outside,
        workspaceRoot: tmp,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PATH_ESCAPE/);
    } finally { cleanup(tmp); cleanup(outside); }
  });

  it("allows cwd within workspace root", async () => {
    const tmp = makeTempDir("escape-ok");
    const sub = path.join(tmp, "subdir");
    fs.mkdirSync(sub, { recursive: true });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], {
        cwd: sub,
        workspaceRoot: tmp,
      });
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Spaces in paths ───────────────────────────────────────────────

describe("Phase 3A — Spaces in paths", () => {
  it("works with spaces in cwd", async () => {
    const tmp = path.join(os.tmpdir(), `litt 3a spaces ${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], { cwd: tmp });
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Unicode paths ─────────────────────────────────────────────────

describe("Phase 3A — Unicode paths", () => {
  it("works with unicode in cwd", async () => {
    const tmp = path.join(os.tmpdir(), `litt-3a-unicode-测试-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('ok')"], { cwd: tmp });
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Secret redaction ──────────────────────────────────────────────

describe("Phase 3A — Secret redaction", () => {
  it("redacts sk- API keys", () => {
    const input = "Using key sk-abcdefghijklmnopqrstuvwxyz123456 for API";
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes("sk-abcdefghijklmnopqrstuvwxyz123456"));
    assert.ok(redacted.includes("[REDACTED]"));
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890";
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes("Bearer abcdefghijklmnopqrstuvwxyz"));
  });

  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const redacted = redactSecrets(jwt);
    assert.ok(!redacted.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  });

  it("redacts AWS access keys", () => {
    const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  it("redacts GitHub tokens", () => {
    const input = "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890";
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes("ghp_"));
  });

  it("redacts password= assignments", () => {
    const input = 'password="supersecretvalue12345678"';
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes("supersecretvalue12345678"));
  });

  it("does not redact normal text", () => {
    const input = "The build succeeded in 1234ms";
    assert.equal(redactSecrets(input), input);
  });

  it("redacts secrets in command output", async () => {
    const tmp = makeTempDir("redact");
    try {
      const shell = createShellExecutor(tmp);
      // Simulate output containing a secret
      const result = await runCommandSecure(
        shell,
        "node",
        ["-e", "console.log('key=sk-testabcdefghijklmnopqrstuvwxyz1234567890')"],
        { cwd: tmp },
      );
      const stdout = result.data.stdout as string;
      assert.ok(!stdout.includes("sk-testabcdefghijklmnopqrstuvwxyz"), `stdout should be redacted: ${stdout}`);
    } finally { cleanup(tmp); }
  });
});

// ─── runShellCommand is disabled ───────────────────────────────────

describe("Phase 3A — runShellCommand is disabled", () => {
  it("returns failure with SHELL_EXECUTION_DISABLED", async () => {
    const tmp = makeTempDir("shell-disabled");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runShellCommand(shell, "echo hello", { cwd: tmp });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /SHELL_EXECUTION_DISABLED/);
    } finally { cleanup(tmp); }
  });

  it("returns failure even with a benign command", async () => {
    const tmp = makeTempDir("shell-disabled2");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runShellCommand(shell, "node -e console.log('ok')", { cwd: tmp });
      assert.equal(result.success, false);
    } finally { cleanup(tmp); }
  });
});

// ─── Risk assessment ───────────────────────────────────────────────

describe("Phase 3A — Risk assessment", () => {
  it("classifies node as safe", () => {
    const risk = assessRisk("node", ["-e", "console.log('ok')"]);
    assert.equal(risk.level, "safe");
    assert.equal(risk.mutating, false);
  });

  it("classifies git push as elevated", () => {
    const risk = assessRisk("git", ["push"]);
    assert.equal(risk.level, "elevated");
    assert.equal(risk.mutating, true);
  });

  it("classifies git commit as elevated", () => {
    const risk = assessRisk("git", ["commit", "-m", "test"]);
    assert.equal(risk.level, "elevated");
    assert.equal(risk.mutating, true);
  });

  it("classifies npm install as elevated", () => {
    const risk = assessRisk("npm", ["install"]);
    assert.equal(risk.level, "elevated");
    assert.equal(risk.mutating, true);
  });

  it("classifies rm as dangerous", () => {
    const risk = assessRisk("rm", ["-rf", "/"]);
    assert.equal(risk.level, "dangerous");
    assert.equal(risk.mutating, true);
  });

  it("classifies curl as elevated (not allowlisted)", () => {
    const risk = assessRisk("curl", ["http://example.com"]);
    assert.equal(risk.level, "elevated");
  });
});

// ─── Approval provider ─────────────────────────────────────────────

describe("Phase 3A — Approval provider", () => {
  it("calls approval provider for elevated command in ACT mode", async () => {
    const tmp = makeTempDir("approval");
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    try {
      const shell = createShellExecutor(tmp);
      let approvalCalled = false;
      // npm install is classified as elevated (modifies dependencies)
      const result = await runCommandSecure(shell, "npm", ["install", "--dry-run"], {
        cwd: tmp,
        mode: "act" as MissionMode,
        approvalProvider: async () => { approvalCalled = true; return true; },
      });
      assert.ok(approvalCalled, "approval provider should be called for elevated command");
    } finally { cleanup(tmp); }
  });

  it("rejects when approval provider returns false", async () => {
    const tmp = makeTempDir("approval-deny");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "git", ["commit", "-m", "test"], {
        cwd: tmp,
        mode: "act" as MissionMode,
        approvalProvider: async () => false,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /APPROVAL_REQUIRED/);
    } finally { cleanup(tmp); }
  });
});

// ─── Timeout ───────────────────────────────────────────────────────

describe("Phase 3A — Timeout", () => {
  it("times out a long-running command", async () => {
    const tmp = makeTempDir("timeout");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "setTimeout(()=>{},10000)"], {
        cwd: tmp,
        timeoutMs: 500,
      });
      // Timeout should cause failure
      assert.equal(result.success, false);
    } finally { cleanup(tmp); }
  });
});

// ─── Huge output ───────────────────────────────────────────────────

describe("Phase 3A — Huge output", () => {
  it("handles large stdout without crashing", async () => {
    const tmp = makeTempDir("huge");
    try {
      const shell = createShellExecutor(tmp);
      // Generate ~100KB of output
      const result = await runCommandSecure(
        shell,
        "node",
        ["-e", "process.stdout.write('x'.repeat(100000))"],
        { cwd: tmp, maxOutputBytes: 200_000 },
      );
      assert.equal(result.success, true);
      const stdout = result.data.stdout as string;
      assert.ok(stdout.length > 0);
    } finally { cleanup(tmp); }
  });

  it("truncates output exceeding maxOutputBytes", async () => {
    const tmp = makeTempDir("truncate");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(
        shell,
        "node",
        ["-e", "process.stdout.write('x'.repeat(100000))"],
        { cwd: tmp, maxOutputBytes: 10_000 },
      );
      assert.equal(result.data.truncated, true);
    } finally { cleanup(tmp); }
  });
});

// ─── Malicious package-script arguments ────────────────────────────

describe("Phase 3A — Malicious package-script arguments", () => {
  it("rejects script name with shell injection", async () => {
    const tmp = makeTempDir("malicious-script");
    try {
      const shell = createShellExecutor(tmp);
      // The script name itself contains injection
      const result = await runCommandSecure(shell, "npm", ["run", "build; whoami"], {
        cwd: tmp,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /ARG_INJECTION/);
    } finally { cleanup(tmp); }
  });
});

// ─── Quoted arguments ──────────────────────────────────────────────

describe("Phase 3A — Quoted arguments", () => {
  it("handles arguments with spaces (no injection)", async () => {
    const tmp = makeTempDir("quoted");
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommandSecure(shell, "node", ["-e", "console.log('hello world')"], {
        cwd: tmp,
      });
      assert.equal(result.success, true);
      assert.match(result.data.stdout as string, /hello world/);
    } finally { cleanup(tmp); }
  });
});

// ─── No hardcoded paths ────────────────────────────────────────────

describe("Phase 3A — No hardcoded paths in execution.ts", () => {
  it("execution.ts has no hardcoded C:\\Users\\litbi", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "execution.ts"), "utf8");
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const line of codeLines) {
      assert.ok(!line.includes("C:\\Users\\litbi"),
        `execution.ts must not contain hardcoded C:\\Users\\litbi: ${line.trim()}`);
    }
  });
});
