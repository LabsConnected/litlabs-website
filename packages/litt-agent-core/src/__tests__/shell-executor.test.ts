/**
 * Regression tests for the executor hang found in mission dogfood:
 * a mission sat in "verifying" 16+ minutes with no live child process.
 *
 * Root causes fixed in NodeShellExecutor:
 *  1. execute() resolved only on child "close" — which never fires when
 *     an orphaned grandchild inherited the stdio pipes after the process
 *     tree died. Now resolves on "exit" + stdio grace + hard fallback.
 *  2. A single `_child` slot + shared `_cancelled` flag meant parallel
 *     tool dispatch left earlier children untracked — cancel() killed
 *     only the last spawn and the rest became orphans.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { NodeShellExecutor } from "../shell.js";

const NODE = process.execPath;

test("execute resolves when a grandchild holds stdio pipes open", async () => {
  // Parent exits 0 immediately; a detached grandchild inherits the
  // stdout/stderr pipes and sleeps 15s. "close" cannot fire until the
  // pipes close (~15s) — pre-fix this hung the full 15s; post-fix the
  // executor resolves in ~3s via the stdio grace + fallback path.
  const orphanScript = [
    'const{spawn}=require("child_process");',
    'const g=spawn(process.execPath,["-e","setTimeout(()=>process.exit(0),15000)"],{stdio:"inherit"});',
    'g.unref();',
    'process.exit(0);',
  ].join("");
  const sh = new NodeShellExecutor();
  const t0 = Date.now();
  const r = await sh.execute({
    command: NODE,
    args: ["-e", orphanScript],
    timeoutMs: 60_000,
  });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, "success");
  assert.equal(r.exitCode, 0);
  assert.ok(elapsed < 10_000, `expected <10s, took ${elapsed}ms — close-event hang regressed`);
});

test("cancel() kills ALL parallel in-flight commands, not just the last", async () => {
  const sh = new NodeShellExecutor();
  const sleep = ["-e", "setTimeout(()=>process.exit(0),60000)"];
  const t0 = Date.now();
  const p1 = sh.execute({ command: NODE, args: sleep, timeoutMs: 90_000 });
  const p2 = sh.execute({ command: NODE, args: sleep, timeoutMs: 90_000 });
  // Let both children spawn before cancelling.
  await new Promise((r) => setTimeout(r, 400));
  const killed = await sh.cancel();
  const [r1, r2] = await Promise.all([p1, p2]);
  const elapsed = Date.now() - t0;
  assert.equal(r1.status, "cancelled");
  assert.equal(r2.status, "cancelled");
  assert.ok(killed.length >= 2, `expected >=2 killed pids, got ${killed.length}`);
  assert.ok(elapsed < 20_000, `cancel took ${elapsed}ms — orphaned child survived`);
});

test("a later execute() does not clear an in-flight cancel", async () => {
  const sh = new NodeShellExecutor();
  const sleep = ["-e", "setTimeout(()=>process.exit(0),60000)"];
  const p1 = sh.execute({ command: NODE, args: sleep, timeoutMs: 90_000 });
  await new Promise((r) => setTimeout(r, 300));
  const cancelPromise = sh.cancel();
  // A second execute starting mid-cancel must not resurrect p1's flag.
  const p2 = sh.execute({ command: NODE, args: ["-e", "process.exit(0)"], timeoutMs: 10_000 });
  await cancelPromise;
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.status, "cancelled");
  assert.equal(r2.status, "success");
});

test("timeout still produces status timeout", async () => {
  const sh = new NodeShellExecutor();
  const r = await sh.execute({
    command: NODE,
    args: ["-e", "setTimeout(()=>process.exit(0),60000)"] ,
    timeoutMs: 500,
  });
  assert.equal(r.status, "timeout");
  assert.match(r.error ?? "", /Timeout after 500ms/);
});

test("basic success and failure statuses unchanged", async () => {
  const sh = new NodeShellExecutor();
  const ok = await sh.execute({ command: NODE, args: ["-e", "console.log('hi')"], timeoutMs: 10_000 });
  assert.equal(ok.status, "success");
  assert.match(ok.stdout, /hi/);
  const bad = await sh.execute({ command: NODE, args: ["-e", "process.exit(3)"], timeoutMs: 10_000 });
  assert.equal(bad.status, "failed");
  assert.equal(bad.exitCode, 3);
});
