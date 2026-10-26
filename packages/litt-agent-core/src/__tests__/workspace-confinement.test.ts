/**
 * Adversarial tests — workspace confinement of read commands, git output
 * flags, env filtering, and widened secret redaction.
 *
 * Covers the residual surface found in the PR #736 security review:
 *   - cat/grep/find/ls with absolute or ../ operands escaping the workspace
 *     (operands are paths for file-readers — flag-level pathArgs never saw them)
 *   - git diff/log/show --output writing files outside the workspace
 *   - infra-level secrets (service-role keys, deploy tokens) leaking into
 *     child process environments
 *   - named-secret stdout redaction (*_KEY=, *_SECRET=, DATABASE_URL=, PEM)
 *
 * Every denied case also asserts the escape did NOT happen — no file
 * contents read, no file written.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  createShellExecutor,
  runCommandSecure,
  classifyCommand,
  redactSecrets,
} from "../index.js";

function makeTempDir(name: string): string {
  const tmp = path.join(
    os.tmpdir(),
    `litt-confine-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanup(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

// ─── R1: read-operand workspace confinement ───────────────────────

describe("Read-operand workspace confinement", () => {
  it("rejects `cat ../outside.secret` without reading it", async () => {
    const ws = makeTempDir("ws");
    const parent = path.dirname(ws);
    const secret = path.join(parent, "outside.secret");
    fs.writeFileSync(secret, "MARKER-SECRET-CONTENT");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "cat", ["../outside.secret"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PATH_ARG_ESCAPE/);
      assert.doesNotMatch(String(result.data.stdout ?? ""), /MARKER-SECRET-CONTENT/);
    } finally {
      fs.rmSync(secret, { force: true });
      cleanup(ws);
    }
  });

  it("rejects `cat` on an absolute path outside the workspace", async () => {
    const ws = makeTempDir("ws-abs");
    const outside = makeTempDir("outside-abs");
    const secretFile = path.join(outside, "secret.txt");
    fs.writeFileSync(secretFile, "ABS-MARKER");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "cat", [secretFile], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PATH_ARG_ESCAPE/);
      assert.doesNotMatch(String(result.data.stdout ?? ""), /ABS-MARKER/);
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });

  it("rejects `grep -r pattern /` (root-wide search)", async () => {
    const ws = makeTempDir("ws-grep");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "grep", ["-r", "x", "/"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(result.success, false);
      assert.match(result.data.code as string, /PATH_ARG_ESCAPE/);
    } finally {
      cleanup(ws);
    }
  });

  it("rejects `find /` but passes `find .` through the gate", async () => {
    const ws = makeTempDir("ws-find");
    fs.writeFileSync(path.join(ws, "present.txt"), "hi");
    try {
      const shell = createShellExecutor(ws);
      const denied = await runCommandSecure(shell, "find", ["/"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(denied.success, false);
      assert.match(denied.data.code as string, /PATH_ARG_ESCAPE/);

      // Gate-level assertion: operands inside the workspace are not
      // rejected. (Exec success itself depends on platform binaries.)
      const allowed = await runCommandSecure(shell, "find", ["."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(allowed.data.code as string, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("passes `cat` on a file inside the workspace through the gate", async () => {
    const ws = makeTempDir("ws-cat-ok");
    fs.writeFileSync(path.join(ws, "readme.txt"), "INSIDE-OK");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "cat", ["readme.txt"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(result.data.code as string, "PATH_ARG_ESCAPE");
      if (result.success) {
        assert.match(result.data.stdout as string, /INSIDE-OK/);
      }
    } finally {
      cleanup(ws);
    }
  });

  it("passes `rg` on an in-workspace path with a pattern operand through the gate", async () => {
    const ws = makeTempDir("ws-rg-ok");
    fs.writeFileSync(path.join(ws, "code.ts"), "const needle = 1;");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "rg", ["needle", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(result.data.code as string, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });
});

// ─── R2: git --output file-write escape ───────────────────────────

describe("git output-flag classification", () => {
  it("classifies `git diff --output=x` as workspace_edit (not read_only)", () => {
    const risk = classifyCommand("git", ["diff", "--output", "/tmp/out.patch"]);
    assert.equal(risk.capability, "workspace_edit");
    assert.equal(risk.mutating, true);
  });

  it("classifies `git log --output=x` as workspace_edit", () => {
    const risk = classifyCommand("git", ["log", "--output=../out.log"]);
    assert.equal(risk.capability, "workspace_edit");
  });

  it("classifies `git show --output=x` as workspace_edit", () => {
    const risk = classifyCommand("git", ["show", "--output", "x"]);
    assert.equal(risk.capability, "workspace_edit");
  });

  it("keeps plain `git diff`/`git log` read_only", () => {
    assert.equal(classifyCommand("git", ["diff"]).capability, "read_only");
    assert.equal(classifyCommand("git", ["log", "--oneline"]).capability, "read_only");
  });
});

// ─── R3: environment filtering ────────────────────────────────────

describe("Child-process environment filtering", () => {
  it("strips infra secrets but keeps provider keys", async () => {
    const ws = makeTempDir("ws-env");
    try {
      const shell = createShellExecutor(ws);
      // node -e prints the child env — node is arbitrary_code, so approve
      // it explicitly; the child still only sees the filtered environment.
      const result = await runCommandSecure(
        shell,
        "node",
        ["-e", "process.stdout.write(Object.keys(process.env).sort().join('\\n') + '\\n' + JSON.stringify({a:process.env.OPENAI_API_KEY,b:process.env.TERMINAL_INTERNAL_SERVICE_KEY,c:process.env.SUPABASE_SERVICE_ROLE_KEY,d:process.env.RAILWAY_API_TOKEN,e:process.env.STRIPE_SECRET_KEY,f:process.env.NODE_OPTIONS}))"],
        {
          cwd: ws,
          workspaceRoot: ws,
          approvalProvider: async () => true,
          env: {
          TERMINAL_INTERNAL_SERVICE_KEY: "ts-secret",
          SUPABASE_SERVICE_ROLE_KEY: "sr-secret",
          RAILWAY_API_TOKEN: "rw-secret",
          STRIPE_SECRET_KEY: "sk_secret",
          OPENAI_API_KEY: "provider-key-stays",
          NODE_OPTIONS: "--require /tmp/evil",
        },
        },
      );
      assert.equal(result.success, true);
      const out = result.data.stdout as string;
      assert.doesNotMatch(out, /ts-secret/);
      assert.doesNotMatch(out, /sr-secret/);
      assert.doesNotMatch(out, /rw-secret/);
      assert.doesNotMatch(out, /sk_secret/);
      assert.doesNotMatch(out, /--require \/tmp\/evil/);
      assert.doesNotMatch(out, /TERMINAL_INTERNAL_SERVICE_KEY=|SUPABASE_SERVICE_ROLE_KEY=|RAILWAY_API_TOKEN=/);
      assert.match(out, /provider-key-stays/);
    } finally {
      cleanup(ws);
    }
  });
});

// ─── R3: widened secret redaction ─────────────────────────────────

describe("Widened secret redaction", () => {
  it("redacts named secret assignments the shape patterns missed", () => {
    const input = [
      "SUPABASE_SERVICE_ROLE_KEY=sr-live-key-12345",
      "DATABASE_URL=postgres://u:pw@db.internal/prod",
      "RAILWAY_API_TOKEN=rail-tok-999",
      "CLERK_SECRET_KEY=clerk-sec",
      "aws_secret_access_key=lower-case-also",
    ].join("\n");
    const out = redactSecrets(input);
    assert.doesNotMatch(out, /sr-live-key-12345/);
    assert.doesNotMatch(out, /postgres:\/\/u:pw@db\.internal/);
    assert.doesNotMatch(out, /rail-tok-999/);
    assert.doesNotMatch(out, /clerk-sec/);
    assert.doesNotMatch(out, /lower-case-also/);
  });

  it("redacts PEM private key blocks", () => {
    const input =
      "before\n-----BEGIN PRIVATE KEY-----\nMIIabc123\n-----END PRIVATE KEY-----\nafter";
    const out = redactSecrets(input);
    assert.doesNotMatch(out, /MIIabc123/);
    assert.match(out, /before/);
    assert.match(out, /after/);
  });

  it("does not over-redact ordinary words or non-secret assignments", () => {
    const input = "TURKEY=bird NODE_ENV=production public_path=/srv/x";
    const out = redactSecrets(input);
    assert.match(out, /TURKEY=bird/);
    assert.match(out, /NODE_ENV=production/);
  });
});
