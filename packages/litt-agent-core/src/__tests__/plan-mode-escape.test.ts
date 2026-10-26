/**
 * PLAN-mode escape regressions — capability classification must reflect
 * what a command can DO, not just the executable's name.
 *
 * Vectors fixed here (verified to bypass PLAN before the fix):
 *   - flag/value pairs shifting the git subcommand out of argv[0]
 *     (`git -C . commit`, `git -c k=v commit`, `git --git-dir=x commit`)
 *   - `env` as a command wrapper (`env rm`, `env F=1 node -e`, `env -S`)
 *   - read-only-registered commands with mutating flag forms
 *     (`find -exec`/`-delete`, `sort -o`, `date -s`, `eslint --fix`,
 *     `prettier --write`, bare `tsc`, `rg --pre`, `hostname <name>`)
 *   - git subcommands whose operands mutate (`git branch foo`,
 *     `git tag v1`, `git remote add`, `git config k v`,
 *     `git reflog expire`, `git worktree add`, `git submodule foreach`)
 *   - unknown `git` operands resolve external `git-*` binaries (arbitrary)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync } from "child_process";
import {
  classifyCommand,
  runCommandSecure,
  createShellExecutor,
} from "../index.js";

function makeTempDir(name: string): string {
  const tmp = path.join(
    os.tmpdir(),
    `litt-plan-escape-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function assertMutating(command: string, args: string[]): void {
  const risk = classifyCommand(command, args);
  assert.equal(
    risk.mutating,
    true,
    `expected mutating: ${command} ${args.join(" ")} (got ${risk.capability})`,
  );
}

function assertReadOnly(command: string, args: string[]): void {
  const risk = classifyCommand(command, args);
  assert.equal(
    risk.mutating,
    false,
    `expected read-only: ${command} ${args.join(" ")} (got ${risk.capability})`,
  );
}

// ─── Flag/value-shifted subcommands ────────────────────────────────

describe("PLAN escape — flag/value-shifted subcommands", () => {
  it("git -C <dir> commit is mutating", () => {
    assertMutating("git", ["-C", ".", "commit", "-m", "x"]);
  });

  it("git -c k=v commit is mutating", () => {
    assertMutating("git", ["-c", "user.email=x@y.z", "commit", "-m", "x"]);
  });

  it("git --git-dir=<d> commit is mutating", () => {
    assertMutating("git", ["--git-dir=.git", "commit", "-m", "x"]);
  });

  it("git --work-tree <d> reset is mutating", () => {
    assertMutating("git", ["--work-tree", ".", "reset", "--hard"]);
  });

  it("git --literal-pathspecs status stays read-only", () => {
    assertReadOnly("git", ["--literal-pathspecs", "status"]);
  });

  it("git -C <dir> status stays read-only", () => {
    assertReadOnly("git", ["-C", ".", "status"]);
  });

  it("git -C <dir> -c k=v diff stays read-only", () => {
    assertReadOnly("git", ["-C", ".", "-c", "a=b", "diff"]);
  });

  it("pnpm -C <dir> run build is arbitrary_code", () => {
    const risk = classifyCommand("pnpm", ["-C", ".", "run", "build"]);
    assert.equal(risk.capability, "arbitrary_code");
  });

  it("npm --prefix <dir> audit stays read-only", () => {
    assertReadOnly("npm", ["--prefix", ".", "audit"]);
  });
});

// ─── Command wrappers ──────────────────────────────────────────────

describe("PLAN escape — env command wrapper", () => {
  it("env rm -rf is destructive", () => {
    assert.equal(classifyCommand("env", ["rm", "-rf", "x"]).capability, "destructive");
  });

  it("env F=1 rm is destructive", () => {
    assert.equal(classifyCommand("env", ["FOO=1", "rm", "x"]).capability, "destructive");
  });

  it("env F=1 node -e is arbitrary_code", () => {
    assertMutating("env", ["FOO=1", "node", "-e", "x"]);
  });

  it("env -i rm is destructive", () => {
    assertMutating("env", ["-i", "rm", "x"]);
  });

  it("env -u FOO rm is destructive", () => {
    assertMutating("env", ["-u", "FOO", "rm", "x"]);
  });

  it("env -- rm is destructive", () => {
    assertMutating("env", ["--", "rm", "x"]);
  });

  it("env -S 'rm -rf x' is destructive", () => {
    assert.equal(classifyCommand("env", ["-S", "rm -rf x"]).capability, "destructive");
  });

  it("env --split-string='rm x' is destructive", () => {
    assert.equal(classifyCommand("env", ["--split-string=rm x"]).capability, "destructive");
  });

  it("env env rm is still destructive", () => {
    assertMutating("env", ["env", "rm", "x"]);
  });

  it("bare env stays read-only", () => {
    assertReadOnly("env", []);
    assertReadOnly("env", ["-0"]);
    assertReadOnly("env", ["FOO=1"]);
  });

  it("env wrapping a read-only command stays read-only", () => {
    assertReadOnly("env", ["FOO=1", "git", "status"]);
    assertReadOnly("env", ["cat", "package.json"]);
  });
});

describe("PLAN escape — other wrappers stay denied", () => {
  it("nice/nohup/xargs/timeout/watch/sh/bash/sudo are arbitrary_code", () => {
    for (const w of ["nice", "nohup", "xargs", "timeout", "watch", "sh", "bash", "sudo"]) {
      assertMutating(w, ["rm", "x"]);
    }
  });
});

// ─── Arg-sensitive read-only commands ──────────────────────────────

describe("PLAN escape — mutating flag forms of read-only commands", () => {
  it("find -exec/-ok is arbitrary_code", () => {
    assertMutating("find", [".", "-name", "*.ts", "-exec", "rm", "{}", ";"]);
    assertMutating("find", [".", "-ok", "rm", "{}", ";"]);
  });

  it("find -delete is destructive", () => {
    assert.equal(classifyCommand("find", [".", "-delete"]).capability, "destructive");
  });

  it("find -fprintf writes a file", () => {
    assertMutating("find", [".", "-fprintf", "out.txt", "%p"]);
  });

  it("plain find stays read-only", () => {
    assertReadOnly("find", [".", "-name", "*.ts"]);
  });

  it("sort -o writes a file", () => {
    assertMutating("sort", ["-o", "out.txt", "in.txt"]);
    assertMutating("sort", ["--output=out.txt", "in.txt"]);
    assertMutating("sort", ["-oout.txt", "in.txt"]);
  });

  it("plain sort stays read-only", () => {
    assertReadOnly("sort", ["in.txt"]);
  });

  it("date -s/--set is mutating", () => {
    assertMutating("date", ["-s", "2026-01-01"]);
    assertMutating("date", ["--set=2026-01-01"]);
  });

  it("date <operand> sets the clock", () => {
    assertMutating("date", ["10241230"]);
  });

  it("date reads stay read-only", () => {
    assertReadOnly("date", []);
    assertReadOnly("date", ["+%Y-%m-%d"]);
    assertReadOnly("date", ["-d", "tomorrow"]);
    assertReadOnly("date", ["-u", "-I"]);
  });

  it("hostname <name> is mutating", () => {
    assertMutating("hostname", ["newhost"]);
  });

  it("bare hostname stays read-only", () => {
    assertReadOnly("hostname", []);
    assertReadOnly("hostname", ["-s"]);
  });

  it("rg --pre is arbitrary_code", () => {
    assertMutating("rg", ["--pre", "cat", "pattern"]);
    assertMutating("rg", ["--pre=cat", "pattern"]);
  });

  it("plain rg stays read-only", () => {
    assertReadOnly("rg", ["pattern", "src/"]);
  });

  it("eslint --fix is mutating", () => {
    assertMutating("eslint", ["--fix", "src/"]);
    assertMutating("eslint", ["--cache", "src/"]);
  });

  it("plain eslint stays read-only", () => {
    assertReadOnly("eslint", ["src/"]);
  });

  it("prettier --write is mutating", () => {
    assertMutating("prettier", ["--write", "src/"]);
  });

  it("prettier --check stays read-only", () => {
    assertReadOnly("prettier", ["--check", "src/"]);
  });

  it("bare tsc emits (mutating); --noEmit stays read-only", () => {
    assertMutating("tsc", []);
    assertMutating("tsc", ["-p", "tsconfig.json"]);
    assertReadOnly("tsc", ["--noEmit"]);
    assertReadOnly("tsc", ["--noEmit", "-p", "tsconfig.json"]);
  });
});

// ─── Git operand-sensitive subcommands ─────────────────────────────

describe("PLAN escape — git operand mutations", () => {
  it("git branch <name> creates a ref", () => {
    assertMutating("git", ["branch", "new-branch"]);
    assertMutating("git", ["branch", "-m", "old", "new"]);
  });

  it("git branch -d/-D is destructive", () => {
    assert.equal(classifyCommand("git", ["branch", "-d", "x"]).capability, "destructive");
    assert.equal(classifyCommand("git", ["branch", "-D", "x"]).capability, "destructive");
  });

  it("git branch listing stays read-only", () => {
    assertReadOnly("git", ["branch"]);
    assertReadOnly("git", ["branch", "-a"]);
    assertReadOnly("git", ["branch", "--show-current"]);
    assertReadOnly("git", ["branch", "--list", "feat-*"]);
  });

  it("git tag <name> creates a ref", () => {
    assertMutating("git", ["tag", "v1.0.0"]);
    assertMutating("git", ["tag", "-a", "v1", "-m", "release"]);
  });

  it("git tag -d is destructive", () => {
    assert.equal(classifyCommand("git", ["tag", "-d", "v1"]).capability, "destructive");
  });

  it("git tag listing stays read-only", () => {
    assertReadOnly("git", ["tag"]);
    assertReadOnly("git", ["tag", "-l", "v*"]);
  });

  it("git remote add/set-url/remove mutate config", () => {
    assertMutating("git", ["remote", "add", "origin", "url"]);
    assertMutating("git", ["remote", "set-url", "origin", "url"]);
    assertMutating("git", ["remote", "remove", "origin"]);
    assertMutating("git", ["remote", "update"]);
  });

  it("git remote -v/show stay read-only", () => {
    assertReadOnly("git", ["remote"]);
    assertReadOnly("git", ["remote", "-v"]);
    assertReadOnly("git", ["remote", "show", "origin"]);
  });

  it("git config <key> reads; config <key> <value> writes", () => {
    assertReadOnly("git", ["config", "user.email"]);
    assertReadOnly("git", ["config", "--list"]);
    assertReadOnly("git", ["config", "--get", "user.email"]);
    assertReadOnly("git", ["config", "--global", "user.email"]);
    assertMutating("git", ["config", "user.email", "x@y.z"]);
    assertMutating("git", ["config", "--global", "user.email", "x@y.z"]);
    assertMutating("git", ["config", "--unset", "user.email"]);
    assertMutating("git", ["config", "--add", "x.y", "z"]);
  });

  it("git reflog expire/delete are destructive", () => {
    assert.equal(classifyCommand("git", ["reflog", "expire", "--expire=now", "--all"]).capability, "destructive");
    assertReadOnly("git", ["reflog"]);
    assertReadOnly("git", ["reflog", "show"]);
  });

  it("git worktree add/remove mutate; list stays read-only", () => {
    assertMutating("git", ["worktree", "add", "../wt"]);
    assertMutating("git", ["worktree", "remove", "wt"]);
    assertReadOnly("git", ["worktree", "list"]);
  });

  it("git submodule update mutates; foreach is arbitrary", () => {
    assertMutating("git", ["submodule", "update", "--init"]);
    assert.equal(
      classifyCommand("git", ["submodule", "foreach", "rm", "-rf", "."]).capability,
      "arbitrary_code",
    );
    assertReadOnly("git", ["submodule", "status"]);
  });

  it("unknown git operand resolves an external git-* binary", () => {
    const risk = classifyCommand("git", ["annex", "drop"]);
    assert.equal(risk.mutating, true);
    assert.equal(risk.capability, "arbitrary_code");
  });

  it("common read-only git verbs stay read-only", () => {
    for (const sub of ["for-each-ref", "ls-remote", "ls-tree", "rev-list", "cat-file", "grep", "fsck"]) {
      assertReadOnly("git", [sub]);
    }
  });
});

// ─── End-to-end: runCommand actually enforces PLAN ────────────────

describe("PLAN escape — runCommand enforces end to end", () => {
  it("env-wrapped writes do not execute under plan", async () => {
    const ws = makeTempDir("env");
    const shell = createShellExecutor(ws);
    const res = await runCommandSecure(shell, "env", ["touch", "PWNED"], {
      mode: "plan",
      cwd: ws,
      workspaceRoot: ws,
    });
    assert.equal(res.status, "failed");
    assert.match(res.message, /PLAN mode rejects/);
    assert.equal(fs.existsSync(path.join(ws, "PWNED")), false);
  });

  it("flag-shifted git commit does not execute under plan", async () => {
    const ws = makeTempDir("git");
    execFileSync("git", ["init", "-q"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: ws });
    const shell = createShellExecutor(ws);
    const res = await runCommandSecure(shell, "git", ["-c", "user.email=t@t", "commit", "--allow-empty", "-m", "BYPASS"], {
      mode: "plan",
      cwd: ws,
      workspaceRoot: ws,
    });
    assert.equal(res.status, "failed");
    const log = execFileSync("git", ["log", "--oneline"], { cwd: ws, encoding: "utf8" });
    assert.equal(log.includes("BYPASS"), false);
  });

  it("find -delete does not execute under plan", async () => {
    const ws = makeTempDir("find");
    fs.writeFileSync(path.join(ws, "victim.txt"), "x");
    const shell = createShellExecutor(ws);
    const res = await runCommandSecure(shell, "find", [".", "-name", "victim.txt", "-delete"], {
      mode: "plan",
      cwd: ws,
      workspaceRoot: ws,
    });
    assert.equal(res.status, "failed");
    assert.equal(fs.existsSync(path.join(ws, "victim.txt")), true);
  });

  it("read-only commands still run under plan", async () => {
    const ws = makeTempDir("ro");
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "in.txt"), "b\na\n");
    const shell = createShellExecutor(ws);
    for (const [cmd, args] of [
      ["git", ["status"]],
      ["git", ["-C", ws, "status"]],
      ["env", ["FOO=1"]],
      ["env", ["FOO=1", "git", "status"]],
      ["find", [".", "-name", "*.ts"]],
      ["sort", ["in.txt"]],
      ["date", ["+%Y"]],
    ] as Array<[string, string[]]>) {
      const res = await runCommandSecure(shell, cmd, args, {
        mode: "plan",
        cwd: ws,
        workspaceRoot: ws,
      });
      assert.equal(res.status, "success", `${cmd} ${args.join(" ")}: ${res.message}`);
    }
  });
});
