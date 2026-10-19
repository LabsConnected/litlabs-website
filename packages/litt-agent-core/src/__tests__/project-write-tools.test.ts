/**
 * project.write_file / project.edit_file — the agent's file mutation tools.
 *
 * Bug (2026-10-18, real cockpit run): the controller, planner and evidence
 * tracker all referenced project.write_file / project.edit_file, but neither
 * tool was registered. Asked to add a function and a test, a local model
 * could only smuggle edits through project.run shell one-liners
 * (`node -e "fs.writeFileSync(...)"`, `echo ... > file`) — brittle quoting,
 * spawn ENOENT, and an unbalanced brace that broke the suite.
 *
 * These tools are MUTATING: the ExecutionGateway's existing metadata policy
 * applies unchanged — PLAN denies, ACT requires human approval, headless
 * fails closed. Writes are confined to the project root.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolRegistry } from "../tools.js";
import { createShellExecutor } from "../shell.js";
import { ExecutionGateway, type ExecutionRequest } from "../execution-gateway.js";
import { CommandExecutor } from "../command-executor.js";
import { RuntimeStore } from "../state.js";
import type { ToolContext } from "../types.js";

let root: string;
let outside: string;
let ctx: ToolContext;
const tools = new ToolRegistry();

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "litt-write-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "litt-outside-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  ctx = { cwd: root, projectId: null, userId: null, shell: createShellExecutor(root) };
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("registry", () => {
  it("registers both tools as mutating, project-scoped, not read-only", () => {
    for (const id of ["project.write_file", "project.edit_file"]) {
      const entry = tools.get(id);
      assert.ok(entry, `${id} must be registered`);
      assert.equal(entry.metadata.mutating, true);
      assert.equal(entry.metadata.readOnly, false);
      assert.equal(entry.metadata.projectScoped, true);
      assert.equal(entry.definition.readOnly, false);
    }
  });
});

describe("project.write_file", () => {
  it("creates a file (and missing parent dirs) inside the project", async () => {
    const r = await tools.execute("project.write_file", ctx, { path: "test/math.test.js", content: "hello\n" });
    assert.equal(r.success, true, r.message);
    assert.equal(fs.readFileSync(path.join(root, "test", "math.test.js"), "utf8"), "hello\n");
  });

  it("overwrites an existing file", async () => {
    const r = await tools.execute("project.write_file", ctx, { path: "test/math.test.js", content: "v2\n" });
    assert.equal(r.success, true, r.message);
    assert.equal(fs.readFileSync(path.join(root, "test", "math.test.js"), "utf8"), "v2\n");
  });

  for (const bad of ["../escape.txt", "src/../../escape.txt", ".env", "config/.env.local", ".git/config", "node_modules/x.js"]) {
    it(`refuses unsafe path ${bad}`, async () => {
      const r = await tools.execute("project.write_file", ctx, { path: bad, content: "x" });
      assert.equal(r.success, false);
      assert.equal(fs.existsSync(path.join(outside, "escape.txt")), false);
    });
  }

  it("refuses an absolute path", async () => {
    const r = await tools.execute("project.write_file", ctx, { path: path.join(outside, "abs.txt"), content: "x" });
    assert.equal(r.success, false);
    assert.equal(fs.existsSync(path.join(outside, "abs.txt")), false);
  });

  it("refuses to write through a link that leaves the project", async () => {
    fs.symlinkSync(outside, path.join(root, "link-out"), "junction");
    const r = await tools.execute("project.write_file", ctx, { path: "link-out/pwned.txt", content: "x" });
    assert.equal(r.success, false, "write through an escaping link must fail");
    assert.equal(fs.existsSync(path.join(outside, "pwned.txt")), false);
  });

  // Independent review 2026-10-18: NTFS stream syntax wrote a real git hook
  // (.git::$INDEX_ALLOCATION/hooks/post-checkout) and overwrote .env
  // (.env::$DATA) past the separator-anchored sensitive-file patterns.
  for (const bad of [
    ".git::$INDEX_ALLOCATION/hooks/post-checkout",
    ".env::$DATA",
    "credentials.json::$DATA",
    "src/math.js:stream",
    "C:/Windows/evil.txt",
    "CON",
    "nul.txt",
    "src/COM1.js",
    "src/trailingdot.",
    "src/trailing space ",
    "src/bad|name.txt",
  ]) {
    it(`refuses Windows-unsafe path ${JSON.stringify(bad)}`, async () => {
      const r = await tools.execute("project.write_file", ctx, { path: bad, content: "x" });
      assert.equal(r.success, false, r.message);
      assert.equal(fs.existsSync(path.join(root, ".git")), false, "no .git may be created");
      assert.equal(fs.existsSync(path.join(root, ".env")), false, "no .env may be created");
    });
  }

  it("refuses to write through a DANGLING link that points outside", async () => {
    const dangling = path.join(outside, "evil-target.txt");
    try {
      fs.symlinkSync(dangling, path.join(root, "dangling.txt"), "file");
    } catch {
      return; // creating file symlinks needs Developer Mode on Windows; the junction test covers links
    }
    const r = await tools.execute("project.write_file", ctx, { path: "dangling.txt", content: "x" });
    assert.equal(r.success, false, "a dangling link must not be followed");
    assert.equal(fs.existsSync(dangling), false);
  });

  it("refuses to write through a link even when it points inside the project", async () => {
    fs.symlinkSync(path.join(root, "src"), path.join(root, "link-in"), "junction");
    const r = await tools.execute("project.write_file", ctx, { path: "link-in/x.js", content: "x" });
    assert.equal(r.success, false);
  });

  it("requires path and string content", async () => {
    assert.equal((await tools.execute("project.write_file", ctx, { content: "x" })).success, false);
    assert.equal((await tools.execute("project.write_file", ctx, { path: "a.txt" })).success, false);
  });
});

describe("project.edit_file", () => {
  it("replaces exactly one occurrence", async () => {
    const r = await tools.execute("project.edit_file", ctx, {
      path: "src/math.js",
      old_string: "  return a + b;\n}\n",
      new_string: "  return a + b;\n}\n\nexport function multiply(a, b) {\n  return a * b;\n}\n",
    });
    assert.equal(r.success, true, r.message);
    const text = fs.readFileSync(path.join(root, "src", "math.js"), "utf8");
    assert.match(text, /export function multiply\(a, b\) \{\n {2}return a \* b;\n\}\n$/);
  });

  it("fails without changing the file when old_string is absent", async () => {
    const before = fs.readFileSync(path.join(root, "src", "math.js"), "utf8");
    const r = await tools.execute("project.edit_file", ctx, { path: "src/math.js", old_string: "nope", new_string: "x" });
    assert.equal(r.success, false);
    assert.match(r.message, /not found/i);
    assert.equal(fs.readFileSync(path.join(root, "src", "math.js"), "utf8"), before);
  });

  it("fails when old_string is ambiguous", async () => {
    fs.writeFileSync(path.join(root, "dup.txt"), "a\na\n");
    const r = await tools.execute("project.edit_file", ctx, { path: "dup.txt", old_string: "a", new_string: "b" });
    assert.equal(r.success, false);
    assert.match(r.message, /2 times/);
  });

  it("rejects a no-op edit so it never counts as a change", async () => {
    const r = await tools.execute("project.edit_file", ctx, { path: "src/math.js", old_string: "return", new_string: "return" });
    assert.equal(r.success, false);
    assert.match(r.message, /identical/);
  });

  it("refuses to edit a binary file", async () => {
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
    const r = await tools.execute("project.edit_file", ctx, { path: "bin.dat", old_string: "a", new_string: "c" });
    assert.equal(r.success, false);
    assert.match(r.message, /binary/);
  });

  it("fails on a missing file and on unsafe paths", async () => {
    assert.equal((await tools.execute("project.edit_file", ctx, { path: "missing.js", old_string: "a", new_string: "b" })).success, false);
    assert.equal((await tools.execute("project.edit_file", ctx, { path: "../x", old_string: "a", new_string: "b" })).success, false);
  });
});

describe("gateway policy applies unchanged", () => {
  function gateway(): ExecutionGateway {
    const shell = createShellExecutor(root);
    const store = new RuntimeStore();
    return new ExecutionGateway({ tools: new ToolRegistry(), shell, executor: new CommandExecutor(shell, store), store, projectId: "p" });
  }
  function request(mode: ExecutionRequest["mode"], interaction: "interactive" | "headless"): ExecutionRequest {
    return {
      toolId: "project.write_file",
      inputs: { path: "gated.txt", content: "x" },
      cwd: root,
      mode,
      identity: { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction },
    };
  }

  it("PLAN mode denies the write and nothing is written", async () => {
    const r = await gateway().execute(request("plan", "interactive"));
    assert.equal(r.policyEffect, "deny");
    assert.equal(r.result.success, false);
    assert.equal(fs.existsSync(path.join(root, "gated.txt")), false);
  });

  it("ACT mode requires approval; headless (no human) fails closed", async () => {
    const r = await gateway().execute(request("act", "headless"));
    assert.equal(r.policyEffect, "require_approval");
    assert.equal(r.result.success, false);
    assert.equal(fs.existsSync(path.join(root, "gated.txt")), false);
  });
});

describe("project.read_file — NTFS stream syntax", () => {
  it("refuses .env::$DATA (reads the protected file on Windows otherwise)", async () => {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    try {
      const r = await tools.execute("project.read_file", ctx, { path: ".env::$DATA" });
      assert.equal(r.success, false);
      assert.doesNotMatch(JSON.stringify(r.data), /SECRET/);
    } finally {
      fs.rmSync(path.join(root, ".env"), { force: true });
    }
  });
});
