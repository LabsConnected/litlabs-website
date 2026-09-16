/**
 * Durability and idempotency of managed workspace provisioning.
 *
 * The defect: workspace roots were minted as
 *   <root>/<userId>/ws-<projectId8>-<random uuid8>
 * on EVERY prepare. Re-provisioning a project — which happens whenever
 * terminal-server restarts and loses its in-memory registry, because the
 * API then resets workspace_status to not_prepared — created a brand-new
 * EMPTY directory and silently orphaned the user's files. The project
 * came back looking blank.
 *
 * These tests exercise the real filesystem and real git.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Each prepare runs real `git init` + commit, which takes ~2s on Windows.
const GIT_TIMEOUT_MS = 30_000;
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { simpleGit } from "simple-git";
import {
  prepareManagedWorkspace,
  managedWorkspaceRoot,
  managedWorkspaceId,
  getWorkspaceRoot,
} from "../workspace/WorkspaceManager";

let ROOT: string;
const USER = "user_durability";

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "litt-ws-"));
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // Windows can hold a git handle briefly; the temp dir is disposable.
  }
});

describe("durable managed source", { timeout: GIT_TIMEOUT_MS }, () => {
  it("provisions Git-backed source with a main branch and no GitHub", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-a", workspaceRoot: ROOT, templateId: "blank-static",
    });

    expect(ws.ready).toBe(true);
    expect(ws.branch).toBe("main");
    expect(ws.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(existsSync(join(ws.root, "index.html"))).toBe(true);
    expect(existsSync(join(ws.root, ".git"))).toBe(true);

    // Real git history exists — checkpoints and diffs have something to work on.
    const log = await simpleGit(ws.root).log();
    expect(log.total).toBeGreaterThanOrEqual(1);

    // And no remote is configured: Git without GitHub.
    const remotes = await simpleGit(ws.root).getRemotes();
    expect(remotes).toHaveLength(0);
  });

  it("supports an explicit zero-file managed workspace", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-empty", workspaceRoot: ROOT, templateId: "empty-static",
    });

    const userFiles = readdirSync(ws.root).filter((entry) => entry !== ".git");
    expect(userFiles).toEqual([]);
    expect(existsSync(join(ws.root, ".git"))).toBe(true);
    expect(ws.branch).toBe("main");
    expect((await simpleGit(ws.root).log()).total).toBeGreaterThanOrEqual(1);
  });

  it("derives the root from the project, not from a random id", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-b", workspaceRoot: ROOT, templateId: "blank-static",
    });
    expect(ws.root).toBe(managedWorkspaceRoot(ROOT, USER, "proj-b"));
    expect(ws.workspaceId).toBe(managedWorkspaceId("proj-b"));
  });

  it("is idempotent — re-preparing preserves files and identity", async () => {
    const first = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-c", workspaceRoot: ROOT, templateId: "blank-static",
    });

    // The user edits their project.
    writeFileSync(join(first.root, "index.html"), "<h1>Ember Roast</h1>", "utf-8");
    writeFileSync(join(first.root, "styles.css"), "body{background:#111}", "utf-8");

    const second = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-c", workspaceRoot: ROOT, templateId: "blank-static",
    });

    expect(second.root).toBe(first.root);
    expect(second.workspaceId).toBe(first.workspaceId);
    // THE regression: the edit must survive re-provisioning.
    expect(readFileSync(join(second.root, "index.html"), "utf-8")).toBe("<h1>Ember Roast</h1>");
    expect(existsSync(join(second.root, "styles.css"))).toBe(true);
  });

  it("recovers source after a terminal-server restart loses the registry", async () => {
    // Simulate a restart: the durable volume survives, the in-memory map
    // does not. Re-preparing must ADOPT the directory on the volume.
    const root = managedWorkspaceRoot(ROOT, USER, "proj-restart");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "index.html"), "<h1>Survives restart</h1>", "utf-8");

    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-restart", workspaceRoot: ROOT, templateId: "blank-static",
    });

    expect(ws.root).toBe(root);
    expect(readFileSync(join(ws.root, "index.html"), "utf-8")).toBe("<h1>Survives restart</h1>");
    // Git is initialised over the adopted content rather than replacing it.
    expect(existsSync(join(ws.root, ".git"))).toBe(true);
    expect(ws.branch).toBe("main");
  });

  it("adopts a legacy random-id root instead of stranding it", async () => {
    // Workspaces created under the old scheme live at an unrelated path.
    const legacyRoot = join(ROOT, USER, "ws-proj-leg-9f3a2b1c");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, "index.html"), "<h1>Legacy</h1>", "utf-8");

    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-legacy", workspaceRoot: ROOT, templateId: "blank-static",
      existingRoot: legacyRoot,
      existingWorkspaceId: "ws-proj-leg-9f3a2b1c",
    });

    expect(ws.root).toBe(legacyRoot);
    expect(ws.workspaceId).toBe("ws-proj-leg-9f3a2b1c");
    expect(readFileSync(join(ws.root, "index.html"), "utf-8")).toBe("<h1>Legacy</h1>");
  });

  it("ignores a recorded root that no longer exists and provisions fresh", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-gone", workspaceRoot: ROOT, templateId: "blank-static",
      existingRoot: join(ROOT, USER, "ws-vanished"),
      existingWorkspaceId: "ws-vanished",
    });
    expect(ws.root).toBe(managedWorkspaceRoot(ROOT, USER, "proj-gone"));
    expect(existsSync(join(ws.root, "index.html"))).toBe(true);
  });

  it("registers the workspace so cwd resolution finds it", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-reg", workspaceRoot: ROOT, templateId: "blank-static",
    });
    expect(getWorkspaceRoot(ws.workspaceId, USER)).toBe(ws.root);
  });

  it("does not leak another user's workspace root", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-own", workspaceRoot: ROOT, templateId: "blank-static",
    });
    expect(getWorkspaceRoot(ws.workspaceId, "attacker_user")).toBeNull();
  });

  it("isolates two users' workspaces for the same project id", async () => {
    const a = await prepareManagedWorkspace({
      userId: "user_a", projectId: "shared-id", workspaceRoot: ROOT, templateId: "blank-static",
    });
    const b = await prepareManagedWorkspace({
      userId: "user_b", projectId: "shared-id", workspaceRoot: ROOT, templateId: "blank-static",
    });
    expect(a.root).not.toBe(b.root);
  });

  it("rejects path traversal in identifiers", () => {
    expect(() => managedWorkspaceRoot(ROOT, "..", "proj")).toThrow(/Invalid identifier/);
    expect(() => managedWorkspaceId("../../etc")).not.toThrow(); // sanitised, not thrown
    expect(managedWorkspaceId("../../etc")).toBe("ws-etc");
    // A traversal attempt can never escape the configured root.
    expect(managedWorkspaceRoot(ROOT, "user/../..", "proj").startsWith(ROOT)).toBe(true);
  });

  it("provisions a nextjs template with its package.json", async () => {
    const ws = await prepareManagedWorkspace({
      userId: USER, projectId: "proj-next", workspaceRoot: ROOT, templateId: "nextjs",
    });
    expect(existsSync(join(ws.root, "package.json"))).toBe(true);
    expect(existsSync(join(ws.root, "app", "page.tsx"))).toBe(true);
    expect(ws.branch).toBe("main");
  });
});
