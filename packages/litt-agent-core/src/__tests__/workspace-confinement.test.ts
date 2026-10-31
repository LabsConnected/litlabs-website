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
import { buildChildEnv } from "../child-env.js";

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
    const input = [
      "TURKEY=bird NODE_ENV=production public_path=/srv/x",
      "keyword=example",
      "tokenizer=standard",
      "MONKEY=banana",
      "KEYWORDS=abcdef",
      "keyboard=qwerty",
    ].join(" ");
    const out = redactSecrets(input);
    assert.match(out, /TURKEY=bird/);
    assert.match(out, /NODE_ENV=production/);
    assert.match(out, /keyword=example/);
    assert.match(out, /tokenizer=standard/);
    assert.match(out, /MONKEY=banana/);
    assert.match(out, /KEYWORDS=abcdef/);
    assert.match(out, /keyboard=qwerty/);
    assert.doesNotMatch(out, /\[REDACTED\]/);
  });

  it("still redacts underscore-delimited secret names", () => {
    const out = redactSecrets("API_KEY=abcd MY_SECRET=hunter2 TOKEN_VALUE=xyz KEY_NAME=abcdef");
    assert.doesNotMatch(out, /abcd/);
    assert.doesNotMatch(out, /hunter2/);
    assert.doesNotMatch(out, /TOKEN_VALUE=xyz/);
    assert.doesNotMatch(out, /KEY_NAME=abcdef/);
  });
});

// ─── Windows executable suffix must not skip path checks ─────────

describe("Windows command-name normalization before path checks", () => {
  it("rejects `cat.exe ../outside.secret` the same way as `cat`", async () => {
    const ws = makeTempDir("ws-exe");
    const secret = path.join(path.dirname(ws), "outside.secret");
    fs.writeFileSync(secret, "EXE-MARKER-SECRET");
    try {
      const shell = createShellExecutor(ws);
      for (const command of ["cat.exe", "CAT.EXE", "cat.cmd", "cat.bat"]) {
        const result = await runCommandSecure(shell, command, ["../outside.secret"], {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.equal(result.success, false, command);
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", command);
        assert.doesNotMatch(String(result.data.stdout ?? ""), /EXE-MARKER-SECRET/);
      }
    } finally {
      fs.rmSync(secret, { force: true });
      cleanup(ws);
    }
  });

  it("rejects `git.exe -C <outside>`", async () => {
    const ws = makeTempDir("ws-git-exe");
    const outside = makeTempDir("outside-git-exe");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "git.EXE", ["-C", outside, "status"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(result.success, false);
      assert.equal(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });
});

// ─── grep/rg patterns are not paths ───────────────────────────────

describe("Search patterns are not path operands", () => {
  it("allows `rg /api/ .` and `grep ../ <file>` inside the workspace", async () => {
    const ws = makeTempDir("ws-search-ok");
    fs.mkdirSync(path.join(ws, "src"));
    fs.writeFileSync(path.join(ws, "src", "file.ts"), "route /api/ health\n");
    try {
      const shell = createShellExecutor(ws);
      const rg = await runCommandSecure(shell, "rg", ["/api/", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(rg.data.code, "PATH_ARG_ESCAPE");

      const rgExe = await runCommandSecure(shell, "Rg.EXE", ["/api/", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(rgExe.data.code, "PATH_ARG_ESCAPE");

      const grep = await runCommandSecure(shell, "grep", ["../", "src/file.ts"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(grep.data.code, "PATH_ARG_ESCAPE");

      const withFlag = await runCommandSecure(shell, "rg", ["-e", "/api/", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(withFlag.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("still rejects search paths and pattern-files outside the workspace", async () => {
    const ws = makeTempDir("ws-search-bad");
    try {
      const shell = createShellExecutor(ws);
      const rooted = await runCommandSecure(shell, "rg", ["secret", "/"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(rooted.data.code, "PATH_ARG_ESCAPE");

      const grepEscape = await runCommandSecure(shell, "grep", ["../", "../outside.secret"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(grepEscape.data.code, "PATH_ARG_ESCAPE");

      const patternFile = await runCommandSecure(shell, "rg", ["-f", "/etc/passwd", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(patternFile.data.code, "PATH_ARG_ESCAPE");

      const flaggedPath = await runCommandSecure(shell, "grep", ["-e", "../", "/etc/passwd"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(flaggedPath.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });
});

// ─── git --output / -o cannot write outside the workspace ─────────

describe("git output flags are path-confined", () => {
  it("blocks `git diff --output` outside the workspace before spawn", async () => {
    const ws = makeTempDir("ws-git-out");
    const outside = path.join(os.tmpdir(), `litt-pwned-${process.pid}.patch`);
    fs.rmSync(outside, { force: true });
    try {
      const shell = createShellExecutor(ws);
      const cases = [
        ["diff", `--output=${outside}`],
        ["diff", "--output", outside],
        ["log", "-o", outside],
        ["show", "--output", outside],
        ["blame", `--output=${outside}`],
        ["diff", "-o" + outside],
        ["git.exe", "diff", `--output=${outside}`],
      ];
      for (const args of cases) {
        const command = args[0] === "git.exe" ? "git.exe" : "git";
        const argv = args[0] === "git.exe" ? args.slice(1) : args;
        const result = await runCommandSecure(shell, command, argv, {
          cwd: ws,
          workspaceRoot: ws,
          mode: "auto",
        });
        assert.equal(result.success, false, argv.join(" "));
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", argv.join(" "));
        assert.equal(fs.existsSync(outside), false, argv.join(" "));
      }
    } finally {
      fs.rmSync(outside, { force: true });
      cleanup(ws);
    }
  });

  it("allows `git diff --output` when the file stays inside the workspace", async () => {
    const ws = makeTempDir("ws-git-out-ok");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "git", ["diff", "--output=inside.patch"], {
        cwd: ws,
        workspaceRoot: ws,
        mode: "auto",
      });
      assert.notEqual(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("blocks sort -o and find -fprint outside the workspace", async () => {
    const ws = makeTempDir("ws-write-flags");
    const outside = path.join(os.tmpdir(), `litt-sort-${process.pid}.txt`);
    fs.rmSync(outside, { force: true });
    try {
      const shell = createShellExecutor(ws);
      const sort = await runCommandSecure(shell, "sort", [`-o${outside}`, "readme.txt"], {
        cwd: ws,
        workspaceRoot: ws,
        mode: "auto",
      });
      assert.equal(sort.data.code, "PATH_ARG_ESCAPE");
      assert.equal(fs.existsSync(outside), false);

      const find = await runCommandSecure(shell, "find", [".", "-fprint", outside], {
        cwd: ws,
        workspaceRoot: ws,
        mode: "auto",
      });
      assert.equal(find.data.code, "PATH_ARG_ESCAPE");
      assert.equal(fs.existsSync(outside), false);
    } finally {
      fs.rmSync(outside, { force: true });
      cleanup(ws);
    }
  });
});

// ─── Host env is allowlisted before spawn ─────────────────────────

describe("Child env does not inherit host secrets", () => {
  it("hides host secrets from printenv while keeping PATH and explicit non-secrets", async () => {
    const ws = makeTempDir("ws-host-env");
    const hostSecret = ["host", "only", "marker"].join("-");
    const unlisted = ["unlisted", "host", "marker"].join("-");
    const explicit = ["explicit", "provider", "marker"].join("-");
    const prevService = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    const prevUnlisted = process.env.UNLISTED_HOST_SECRET;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = hostSecret;
    process.env.UNLISTED_HOST_SECRET = unlisted;
    process.env.OPENAI_API_KEY = ["host", "provider", "should", "not", "leak"].join("-");
    try {
      const shell = createShellExecutor(ws);
      // printenv doesn't exist on Windows. `node -e` prints the same
      // KEY=value format; it classifies arbitrary_code, so the test
      // supplies an approvalProvider — the allowlist is unchanged.
      const isWin = process.platform === "win32";
      const result = await runCommandSecure(
        shell,
        isWin ? "node" : "printenv",
        isWin
          ? ["-e", 'for (const [k, v] of Object.entries(process.env)) console.log(k + "=" + v)']
          : [],
        {
          cwd: ws,
          workspaceRoot: ws,
          env: {
            LIT_TEST_MARKER: explicit,
            OPENAI_API_KEY: explicit,
            TERMINAL_INTERNAL_SERVICE_KEY: "explicit-blocked",
          },
          approvalProvider: async () => true,
        },
      );
      const out = String(result.data.stdout ?? "");
      assert.equal(result.success, true);
      assert.doesNotMatch(out, new RegExp(hostSecret));
      assert.doesNotMatch(out, /TERMINAL_INTERNAL_SERVICE_KEY/);
      assert.doesNotMatch(out, new RegExp(unlisted));
      assert.doesNotMatch(out, /UNLISTED_HOST_SECRET/);
      assert.doesNotMatch(out, /host-provider-should-not-leak/);
      // Explicit non-secret keys reach the child. A provider key passed
      // explicitly is in the child env too, then redacted on the way out,
      // so the raw value must not be visible.
      assert.match(out, new RegExp(`LIT_TEST_MARKER=${explicit}`));
      assert.doesNotMatch(out, new RegExp(`OPENAI_API_KEY=${explicit}`));
      assert.match(out, /\[REDACTED\]/);
      // Windows exposes the var as `Path`, POSIX as `PATH`.
      assert.match(out, /^PATH=/im);
    } finally {
      if (prevService === undefined) delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
      else process.env.TERMINAL_INTERNAL_SERVICE_KEY = prevService;
      if (prevUnlisted === undefined) delete process.env.UNLISTED_HOST_SECRET;
      else process.env.UNLISTED_HOST_SECRET = prevUnlisted;
      if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAi;
      cleanup(ws);
    }
  });
});

// ─── Grouped short options cannot hide path operands ─────────────
//
// PR #736 review: `grep -neMARKER /outside.secret` supplied the pattern
// through a grouped `-e`, but the parser only inspected the group's first
// option and then dropped the real operand as the presumed pattern.

describe("Grouped short options (grep/rg)", () => {
  it("rejects `grep -neMARKER /outside` — grouped -e supplies the pattern", async () => {
    const ws = makeTempDir("ws-grep-grp");
    const secret = path.join(path.dirname(ws), "grp-outside.secret");
    fs.writeFileSync(secret, "GROUPED-SECRET-MARKER");
    try {
      const shell = createShellExecutor(ws);
      // -e attached to a group tail, -e consuming the next token, and
      // -f (a path-valued flag) attached to a group tail.
      for (const argv of [
        ["-neGROUPED-SECRET-MARKER", secret],
        ["-ne", "GROUPED-SECRET-MARKER", secret],
        ["-nf", secret],
      ]) {
        const result = await runCommandSecure(shell, "grep", argv, {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.equal(result.success, false, argv.join(" "));
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", argv.join(" "));
        assert.doesNotMatch(String(result.data.stdout ?? ""), /GROUPED-SECRET-MARKER/);
      }
    } finally {
      fs.rmSync(secret, { force: true });
      cleanup(ws);
    }
  });

  it("rejects `rg -nePATTERN /outside` the same way", async () => {
    const ws = makeTempDir("ws-rg-grp");
    const outside = makeTempDir("outside-rg-grp");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "rg", ["-nepat", outside], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });

  it("keeps grouped boolean options working (`grep -in pat file`)", async () => {
    const ws = makeTempDir("ws-grep-grp-ok");
    fs.writeFileSync(path.join(ws, "file.txt"), "needle here\n");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(shell, "grep", ["-in", "needle", "file.txt"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });
});

// ─── Option values are not path operands ─────────────────────────
//
// PR #736 review: `cut -d / -f 1 x` checked the delimiter "/" as a path
// and failed PATH_ARG_ESCAPE even though only "x" names a file.

describe("Option values are not path operands", () => {
  it("allows `cut -d / -f 1 <file>` — the delimiter is not a path", async () => {
    const ws = makeTempDir("ws-cut-delim");
    fs.writeFileSync(path.join(ws, "paths.txt"), "a/b/c\n");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(
        shell,
        "cut",
        ["-d", "/", "-f", "1", "paths.txt"],
        { cwd: ws, workspaceRoot: ws },
      );
      assert.notEqual(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("still confines the real file operand after option values", async () => {
    const ws = makeTempDir("ws-cut-escape");
    const outside = makeTempDir("outside-cut");
    const target = path.join(outside, "data.txt");
    fs.writeFileSync(target, "a,b,c\n");
    try {
      const shell = createShellExecutor(ws);
      for (const argv of [
        ["-d", ",", "-f", "1", target],
        ["-d", ",", "-f1", target],
        ["--delimiter=/", "-f1", target],
      ]) {
        const result = await runCommandSecure(shell, "cut", argv, {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", argv.join(" "));
      }
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });

  it("keeps `find . -name`/`find . -printf` working inside the workspace", async () => {
    const ws = makeTempDir("ws-find-pred");
    fs.writeFileSync(path.join(ws, "x.txt"), "hi");
    try {
      const shell = createShellExecutor(ws);
      for (const argv of [
        [".", "-name", "*.txt"],
        [".", "-printf", "/%p\\n"],
        [".", "-type", "f", "-name", "x*"],
        [".", "-maxdepth", "1"],
      ]) {
        const result = await runCommandSecure(shell, "find", argv, {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.notEqual(result.data.code, "PATH_ARG_ESCAPE", argv.join(" "));
      }
    } finally {
      cleanup(ws);
    }
  });

  it("checks find's path-valued predicates (`-newer`, `-samefile`)", async () => {
    const ws = makeTempDir("ws-find-ref");
    const outside = makeTempDir("outside-ref");
    const ref = path.join(outside, "ref.txt");
    fs.writeFileSync(ref, "x");
    try {
      const shell = createShellExecutor(ws);
      for (const argv of [
        [".", "-newer", ref],
        [".", "-samefile", ref],
      ]) {
        const result = await runCommandSecure(shell, "find", argv, {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", argv.join(" "));
      }
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });

  it("does not confine `find -exec` argv — it belongs to the embedded command", async () => {
    const ws = makeTempDir("ws-find-exec");
    try {
      const shell = createShellExecutor(ws);
      // -exec is classified arbitrary_code, so approval is supplied;
      // an absolute path inside the embedded command is not a find operand.
      const result = await runCommandSecure(
        shell,
        "find",
        [".", "-exec", "echo", "/tmp/x", "+"],
        { cwd: ws, workspaceRoot: ws, approvalProvider: async () => true },
      );
      assert.notEqual(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("checks the path operand before `-exec`, not the command after it", async () => {
    const ws = makeTempDir("ws-find-exec-path");
    try {
      const shell = createShellExecutor(ws);
      const result = await runCommandSecure(
        shell,
        "find",
        ["/", "-exec", "echo", "{}", ";"],
        { cwd: ws, workspaceRoot: ws, approvalProvider: async () => true },
      );
      assert.equal(result.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
    }
  });

  it("treats `head -c`/`tail -n`/`sort -t` values as option values", async () => {
    const ws = makeTempDir("ws-num-vals");
    fs.writeFileSync(path.join(ws, "f.txt"), "a\nb\n");
    try {
      const shell = createShellExecutor(ws);
      for (const [cmd, argv] of [
        ["sort", ["-t", "/", "-k", "1", "f.txt"]],
        ["head", ["-n", "2", "f.txt"]],
        ["tail", ["-n", "1", "f.txt"]],
        ["uniq", ["-f", "1", "f.txt"]],
        ["diff", ["-L", "a", "-L", "b", "f.txt", "f.txt"]],
        ["stat", ["-c", "%s", "f.txt"]],
      ] as const) {
        const result = await runCommandSecure(shell, cmd, [...argv], {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.notEqual(result.data.code, "PATH_ARG_ESCAPE", `${cmd} ${argv.join(" ")}`);
      }
    } finally {
      cleanup(ws);
    }
  });

  it("checks getopt path-valued flags (`du -X`, `diff --from-file`, `sort -T`)", async () => {
    const ws = makeTempDir("ws-path-flags");
    const outside = makeTempDir("outside-pflag");
    const ref = path.join(outside, "ref.txt");
    fs.writeFileSync(ref, "x");
    try {
      const shell = createShellExecutor(ws);
      for (const [cmd, argv] of [
        ["du", ["-X", ref, "."]],
        ["diff", ["--from-file", ref, "x"]],
        ["sort", ["-T", outside, "x.txt"]],
        ["wc", ["--files0-from", ref]],
      ] as const) {
        const result = await runCommandSecure(shell, cmd, [...argv], {
          cwd: ws,
          workspaceRoot: ws,
        });
        assert.equal(result.data.code, "PATH_ARG_ESCAPE", `${cmd} ${argv.join(" ")}`);
      }
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });

  it("treats findstr/dir/more `/` tokens as options, not root paths", async () => {
    const ws = makeTempDir("ws-dos-flags");
    fs.writeFileSync(path.join(ws, "file.txt"), "needle\n");
    const outside = makeTempDir("outside-dos");
    const listFile = path.join(outside, "list.txt");
    fs.writeFileSync(listFile, "needle\n");
    try {
      const shell = createShellExecutor(ws);
      // Options starting with "/" are flags, not path operands.
      const ok = await runCommandSecure(shell, "findstr", ["/I", "/N", "needle", "file.txt"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(ok.data.code, "PATH_ARG_ESCAPE");
      // /G:<file> reads a pattern file — confined like any operand.
      const gFlag = await runCommandSecure(shell, "findstr", [`/G:${listFile}`, "file.txt"], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(gFlag.data.code, "PATH_ARG_ESCAPE");
      // A second file operand is still confined.
      const fileOperand = await runCommandSecure(shell, "findstr", ["needle", listFile], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(fileOperand.data.code, "PATH_ARG_ESCAPE");
      // dir /B stays inside when the operand does.
      const dirOk = await runCommandSecure(shell, "dir", ["/B", "."], {
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.notEqual(dirOk.data.code, "PATH_ARG_ESCAPE");
    } finally {
      cleanup(ws);
      cleanup(outside);
    }
  });
});

// ─── tree/less/sort write- and exec-flag classification ──────────

describe("Pager/tree write flags and sort compress-program are not read-only", () => {
  it("classifies `tree -o`/`less -o` as workspace_edit", () => {
    for (const [cmd, argv] of [
      ["tree", ["-o", "out.txt"]],
      ["tree", ["--output=out.txt"]],
      ["less", ["-o", "log.txt", "f.txt"]],
      ["less", ["--log-file", "log.txt", "f.txt"]],
    ] as const) {
      assert.equal(
        classifyCommand(cmd, [...argv]).capability,
        "workspace_edit",
        `${cmd} ${argv.join(" ")}`,
      );
    }
  });

  it("classifies `sort --compress-program` as arbitrary_code", () => {
    assert.equal(
      classifyCommand("sort", ["--compress-program=gzip", "f.txt"]).capability,
      "arbitrary_code",
    );
    assert.equal(
      classifyCommand("sort", ["--compress-program", "gzip", "f.txt"]).capability,
      "arbitrary_code",
    );
  });

  it("keeps plain `tree`/`less`/`sort` read_only", () => {
    assert.equal(classifyCommand("tree", ["."], undefined).capability, "read_only");
    assert.equal(classifyCommand("less", ["f.txt"], undefined).capability, "read_only");
    assert.equal(classifyCommand("sort", ["f.txt"], undefined).capability, "read_only");
  });
});

// ─── Operational env vars survive child-env filtering ────────────
//
// PR #736 review: buildChildEnv dropped SSH_AUTH_SOCK/JAVA_HOME along
// with secrets, breaking approved `git push` and toolchain commands.

describe("Child env preserves operational settings", () => {
  it("forwards ssh-agent and toolchain vars while still dropping host secrets", () => {
    const env = buildChildEnv(
      {
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        SSH_AGENT_PID: "4242",
        GPG_TTY: "/dev/tty1",
        JAVA_HOME: "/opt/jdk",
        GOROOT: "/usr/local/go",
        EDITOR: "vim",
        GIT_SSH_COMMAND: "ssh -i key",
        TERMINAL_INTERNAL_SERVICE_KEY: "service-secret",
        NPM_TOKEN: "npm-secret",
        UNLISTED_HOST_VALUE: "unlisted-secret",
      },
      [],
    );
    assert.equal(env.SSH_AUTH_SOCK, "/tmp/ssh-agent.sock");
    assert.equal(env.SSH_AGENT_PID, "4242");
    assert.equal(env.GPG_TTY, "/dev/tty1");
    assert.equal(env.JAVA_HOME, "/opt/jdk");
    assert.equal(env.GOROOT, "/usr/local/go");
    assert.equal(env.EDITOR, "vim");
    assert.equal(env.GIT_SSH_COMMAND, "ssh -i key");
    assert.equal(env.TERMINAL_INTERNAL_SERVICE_KEY, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.UNLISTED_HOST_VALUE, undefined);
  });

  it("does not let new allowlist entries shadow injection vectors", () => {
    const env = buildChildEnv(
      {
        PATH: "/usr/bin",
        JAVA_TOOL_OPTIONS: "-javaagent:/tmp/evil.jar",
        MAVEN_OPTS: "-Xmx1g -javaagent:/tmp/evil.jar",
        PYTHONHOME: "/tmp/fake-python",
        LD_PRELOAD: "/tmp/evil.so",
      },
      [],
    );
    assert.equal(env.JAVA_TOOL_OPTIONS, undefined);
    assert.equal(env.MAVEN_OPTS, undefined);
    assert.equal(env.PYTHONHOME, undefined);
    assert.equal(env.LD_PRELOAD, undefined);
  });
});
