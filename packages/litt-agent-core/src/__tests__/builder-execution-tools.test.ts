/**
 * Regression coverage for the PR #690 CLI builder fixes, at the
 * execution.ts / project.ts level (see agent-loop-ollama-dispatch.test.ts
 * section R for the end-to-end agent-loop coverage):
 *
 *   1. detectUnsupportedShellSyntax() — the shape-based detector that
 *      replaces a confusing raw ENOENT with an actionable rejection,
 *      without adding shell:true anywhere (see execution.ts).
 *   2. runCommand() wires that detector in, on a REAL NodeShellExecutor,
 *      on both POSIX and Windows (the detection itself is pure string
 *      logic and platform-independent, but these prove the real
 *      execution path never reaches spawn() for a rejected command, and
 *      that an ordinary single-token command is completely unaffected
 *      on both platforms).
 *   3. writeFile() — the structured, sandboxed file-creation tool.
 *   4. listFiles() — empty path resolves to the project root instead of
 *      being rejected or escaping to the OS root; ".." and absolute
 *      paths are rejected instead of escaping the sandbox.
 *   5. resolveSandboxedPath() — a lexically-safe path (no ".." or
 *      leading "/") that passes THROUGH an existing symlink pointing
 *      outside the project root is still rejected, because the check
 *      resolves the REAL (symlink-followed) location, not just the
 *      literal string. This is what writeFile/listFiles/readFile all
 *      use instead of the lexical-only isSafePath() they used before.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectUnsupportedShellSyntax } from "../execution.js";
import { runCommand, writeFile, listFiles, readFile, resolveSandboxedPath } from "../project.js";
import { NodeShellExecutor } from "../shell.js";

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-builder-tools-test-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true }, null, 2),
  );
  return dir;
}

// ─── detectUnsupportedShellSyntax ───────────────────────────────────

describe("detectUnsupportedShellSyntax", () => {
  it("rejects a whole shell line crammed into the command field", () => {
    const msg = detectUnsupportedShellSyntax("echo 'hi' > index.html", []);
    assert.ok(msg, "must reject");
    assert.match(msg!, /single executable/i);
  });

  it("rejects a standalone redirect token in args", () => {
    assert.ok(detectUnsupportedShellSyntax("echo", ["hi", ">", "index.html"]));
    assert.ok(detectUnsupportedShellSyntax("echo", ["hi", ">>", "index.html"]));
  });

  it("rejects pipe/chain/background tokens in args", () => {
    assert.ok(detectUnsupportedShellSyntax("cmd1", ["|", "cmd2"]));
    assert.ok(detectUnsupportedShellSyntax("cmd1", ["&&", "cmd2"]));
    assert.ok(detectUnsupportedShellSyntax("cmd1", [";", "cmd2"]));
    assert.ok(detectUnsupportedShellSyntax("cmd1", ["&"]));
  });

  it("does NOT reject a single bare executable with no args", () => {
    assert.equal(detectUnsupportedShellSyntax("pnpm", []), null);
    assert.equal(detectUnsupportedShellSyntax("git", ["status"]), null);
  });

  it("does NOT flag a metacharacter that is DATA inside one argv token (no false positives)", () => {
    // These are exactly the cases execution.ts's own docstring warns
    // against false-positiving on: a grep pattern, a commit message,
    // a URL with query params — each is ONE array element, not shell
    // syntax, so it must pass through untouched.
    assert.equal(detectUnsupportedShellSyntax("grep", ["-n", "foo|bar", "file.ts"]), null);
    assert.equal(detectUnsupportedShellSyntax("git", ["commit", "-m", "fix auth & billing"]), null);
    assert.equal(detectUnsupportedShellSyntax("curl", ["https://example.com?a=1&b=2"]), null);
  });
});

// ─── runCommand() — real ShellExecutor, both platforms ─────────────

describe("runCommand — shell-syntax rejection on a real ShellExecutor", () => {
  it("rejects a jammed-together shell command before spawning anything (no ENOENT, no file)", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await runCommand(shell, "echo '<h1>hi</h1>' > index.html", []);
      assert.equal(result.success, false);
      assert.equal((result.data as { code?: string }).code, "UNSUPPORTED_SHELL_SYNTAX");
      assert.equal(fs.existsSync(path.join(dir, "index.html")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a standalone '>' argv token before spawning anything", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await runCommand(shell, "echo", ["hi", ">", "index.html"]);
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(path.join(dir, "index.html")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an ordinary single-token command still runs normally (POSIX)", async function (this: unknown) {
    if (process.platform === "win32") return; // see Windows variant below
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await runCommand(shell, "node", ["--version"]);
      assert.equal(result.success, true);
      assert.match(((result.data as { stdout?: string }).stdout ?? ""), /^v?\d+\./);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an ordinary single-token command still runs normally (Windows)", async function (this: unknown) {
    if (process.platform !== "win32") return; // see POSIX variant above
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      // "dir" is a Windows shell builtin (see shell.ts WINDOWS_BUILTINS) —
      // it has no .exe, so the executor must still run it (via its
      // existing, unmodified shell:true resolution for builtins) rather
      // than our new rejection ever applying to it. A bare "dir" with no
      // args/metacharacters has nothing for the new check to flag.
      const result = await runCommand(shell, "dir", []);
      assert.equal(result.success, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── writeFile() ─────────────────────────────────────────────────────

describe("writeFile — structured, sandboxed file creation", () => {
  it("creates a new file with exact content", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "index.html", "<html><body>Hello</body></html>");
      assert.equal(result.success, true);
      const written = fs.readFileSync(path.join(dir, "index.html"), "utf8");
      assert.equal(written, "<html><body>Hello</body></html>");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites an existing file", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      fs.writeFileSync(path.join(dir, "index.html"), "old");
      const result = await writeFile(shell, "index.html", "new");
      assert.equal(result.success, true);
      assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), "new");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates parent directories as needed", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "src/app/index.html", "<html></html>");
      assert.equal(result.success, true);
      assert.equal(fs.existsSync(path.join(dir, "src", "app", "index.html")), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an absolute path", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const target = path.join(os.tmpdir(), "litt-write-file-escape-test.html");
      const result = await writeFile(shell, target, "<html></html>");
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(target), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal escaping the project root", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "../escape.html", "<html></html>");
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(path.join(path.dirname(dir), "escape.html")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects writing to a sensitive filename pattern (e.g. .env)", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, ".env", "SECRET=1");
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(path.join(dir, ".env")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── listFiles() ──────────────────────────────────────────────────────

describe("listFiles — empty path resolves to project root, sandbox enforced", () => {
  it("empty string lists the project root (not rejected, not the OS root)", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await listFiles(shell, "");
      assert.equal(result.success, true);
      const names = (result.data as { files: { name: string }[] }).files.map((f) => f.name);
      assert.ok(names.includes("package.json"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('"." lists the project root the same way', async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await listFiles(shell, ".");
      assert.equal(result.success, true);
      const names = (result.data as { files: { name: string }[] }).files.map((f) => f.name);
      assert.ok(names.includes("package.json"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('absolute "/" is rejected, never scans the real OS root', async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await listFiles(shell, "/");
      assert.equal(result.success, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("\"..\" traversal is rejected", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await listFiles(shell, "..");
      assert.equal(result.success, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── resolveSandboxedPath() / symlink-escape regression ─────────────
//
// isSafePath() is purely lexical: a relative path with no ".." and no
// leading "/" still passes it even when an existing symlink makes the
// REAL location land outside the project root. These tests create a
// symlink inside the project pointing at a directory/file OUTSIDE it,
// then prove writeFile/listFiles/readFile all refuse to follow it —
// and that an ordinary nested path with no symlinks involved is
// completely unaffected.
//
// Skips gracefully if this platform can't create symlinks (e.g.
// Windows without Developer Mode / admin, where symlinkSync throws
// EPERM) rather than failing the suite for an unrelated platform limit.
function canMakeSymlinks(): boolean {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "litt-symlink-probe-"));
  try {
    fs.symlinkSync(base, path.join(base, "self"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const SYMLINKS_SUPPORTED = canMakeSymlinks();

describe("symlink escape — writeFile/listFiles/readFile reject it, resolveSandboxedPath() directly", { skip: !SYMLINKS_SUPPORTED }, () => {
  it("writeFile refuses to write through a symlink pointing outside the project", async () => {
    const dir = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-symlink-outside-"));
    try {
      fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "escape/pwned.html", "<html>pwned</html>");
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(path.join(outside, "pwned.html")), false,
        "must not have written outside the project root via the symlink");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("listFiles refuses to list a symlinked directory pointing outside the project", async () => {
    const dir = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-symlink-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "outside-only");
      fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
      const shell = new NodeShellExecutor(dir);
      const result = await listFiles(shell, "escape");
      assert.equal(result.success, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("readFile refuses to read a file reached through a symlink pointing outside the project", async () => {
    const dir = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-symlink-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "outside-only-content");
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "escape.txt"), "file");
      const shell = new NodeShellExecutor(dir);
      const result = await readFile(shell, "escape.txt");
      assert.equal(result.success, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("resolveSandboxedPath rejects a not-yet-existing file reached through an outside-pointing symlink", () => {
    const dir = makeTempProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-symlink-outside-"));
    try {
      fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
      // The leaf file doesn't exist yet — this is the "about to create
      // it" case writeFile hits, which is why the walk-up-to-existing-
      // ancestor logic exists at all (realpathSync alone would ENOENT).
      const result = resolveSandboxedPath(dir, "escape/not-created-yet.html");
      assert.equal(result.ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("a symlink that points back INSIDE the project is allowed (not an over-broad rejection)", async () => {
    const dir = makeTempProject();
    try {
      fs.mkdirSync(path.join(dir, "real-target"));
      fs.symlinkSync(path.join(dir, "real-target"), path.join(dir, "alias"), "dir");
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "alias/ok.html", "<html>fine</html>");
      assert.equal(result.success, true);
      assert.equal(fs.existsSync(path.join(dir, "real-target", "ok.html")), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an ordinary nested path with no symlinks is unaffected", async () => {
    const dir = makeTempProject();
    try {
      const shell = new NodeShellExecutor(dir);
      const result = await writeFile(shell, "a/b/c/index.html", "<html></html>");
      assert.equal(result.success, true);
      assert.equal(fs.existsSync(path.join(dir, "a", "b", "c", "index.html")), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
