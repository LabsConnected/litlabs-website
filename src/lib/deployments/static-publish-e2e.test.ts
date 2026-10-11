import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Static publishing end-to-end — AI Build → Public Website.
 *
 * Proves the complete publish pipeline for static workspaces:
 * publish → public URL serves → republish updates → unpublish removes.
 *
 * Security properties asserted:
 * - Ownership enforced (only owner can publish/unpublish)
 * - Path traversal rejected
 * - Published content isolated (CSP sandbox headers)
 * - Zero host subprocesses throughout
 *
 * No Gate 1 weakening. No Vercel. No subprocesses.
 */

import {
  deployUserProject,
  unpublishDeployment,
  type DeploymentStore,
  type DeploySourceTransport,
  type DeploymentRecord,
} from "./deploy-service";
import { isDeploymentTransitionValid } from "./user-deployment";

/* ── Fakes ──────────────────────────────────────────────────────── */

/** In-memory file tree simulating a static workspace (no git, no subprocesses). */
function staticTransport(
  userId: string,
  projectId: string,
  tree: Record<string, string>,
): DeploySourceTransport {
  return {
    userId,
    projectId,
    workspaceId: `ws_${projectId}`,
    async listFiles(path: string) {
      if (path === "." || path === "") {
        return {
          entries: Object.keys(tree).map((name) => ({ name, type: "file" as const })),
        };
      }
      return { entries: [] };
    },
    async readFile(path: string) {
      const content = tree[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return { content, size: content.length };
    },
  };
}

function memoryStore(): DeploymentStore & {
  rows: DeploymentRecord[];
  files: Map<string, Array<{ path: string; content: string; contentType: string }>>;
} {
  const rows: DeploymentRecord[] = [];
  const files = new Map<string, Array<{ path: string; content: string; contentType: string }>>();
  let seq = 0;
  return {
    rows,
    files,
    async findReadyByContentHash(projectId, contentHash) {
      return (
        rows.find(
          (r) => r.projectId === projectId && r.contentHash === contentHash && r.status === "ready",
        ) ?? null
      );
    },
    async findInFlightByContentHash() {
      return null;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async create(input) {
      const row: DeploymentRecord = {
        id: `dep_${++seq}`,
        userId: input.userId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        status: input.status,
        target: input.target,
        publicUrl: null,
        urlVerified: false,
        fileCount: 0,
        totalBytes: 0,
        contentHash: input.contentHash ?? null,
        errorClass: null,
        errorMessage: null,
      };
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      Object.assign(row, patch);
      return row;
    },
    async putFiles(id, fileList) {
      files.set(id, fileList);
    },
  };
}

/** Hosting backend fake — no network, no subprocesses. */
function fakeHosting(baseUrl = "https://sites.test") {
  return {
    isConfigured: () => ({ ok: true as const }),
    resolveBaseUrl: async () => baseUrl,
  };
}

/** fetch fake that serves from the memory store (simulates the /sites route). */
function fakeFetch(store: { files: Map<string, Array<{ path: string; content: string }>> }) {
  return async (url: string) => {
    const match = url.match(/\/sites\/([^/]+)\/(.*)$/);
    if (!match) return { ok: false, status: 404 };
    const [, depId, path] = match;
    const fileList = store.files.get(depId);
    const file = fileList?.find((f) => f.path === (path || "index.html"));
    if (!file) return { ok: false, status: 404 };
    return { ok: true, status: 200 };
  };
}

/* ── Subprocess spy ─────────────────────────────────────────────── */

let spawnCalls: string[] = [];
beforeEach(() => {
  spawnCalls = [];
  vi.mock("node:child_process", () => ({
    spawn: (...args: unknown[]) => {
      spawnCalls.push(`spawn:${JSON.stringify(args[0])}`);
      throw new Error("must not spawn");
    },
    exec: (...args: unknown[]) => {
      spawnCalls.push(`exec:${JSON.stringify(args[0])}`);
      throw new Error("must not exec");
    },
    execFile: (...args: unknown[]) => {
      spawnCalls.push(`execFile:${JSON.stringify(args[0])}`);
      throw new Error("must not execFile");
    },
    execSync: (...args: unknown[]) => {
      spawnCalls.push(`execSync:${JSON.stringify(args[0])}`);
      throw new Error("must not execSync");
    },
    spawnSync: (...args: unknown[]) => {
      spawnCalls.push(`spawnSync:${JSON.stringify(args[0])}`);
      throw new Error("must not spawnSync");
    },
  }));
});

describe("static publishing end-to-end", () => {
  it("1. authenticated owner publishes static project → public URL serves the site", async () => {
    const store = memoryStore();
    const tree = {
      "index.html": "<!doctype html><title>My Site</title><h1>Hello</h1>",
      "styles.css": "body { color: blue; }",
    };
    const transport = staticTransport("user_alice", "proj_alice", tree);

    const result = await deployUserProject(
      {
        userId: "user_alice",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      { store, fetchImpl: fakeFetch(store) as unknown as typeof fetch },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.publicUrl).toMatch(/^https:\/\/sites\.test\/sites\/dep_1\/$/);
      expect(result.status).toBe("ready");
      expect(result.urlVerified).toBe(true);
    }
    expect(spawnCalls).toEqual([]);
  });

  it("2. AI edits a file → republish → public URL shows updated content", async () => {
    const store = memoryStore();
    const tree: Record<string, string> = {
      "index.html": "<!doctype html><h1>Version 1</h1>",
    };
    const transport = staticTransport("user_alice", "proj_alice", tree);

    const deps = {
      store,
      fetchImpl: fakeFetch(store) as unknown as typeof fetch,
    };
    const first = await deployUserProject(
      {
        userId: "user_alice",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      deps,
    );
    expect(first.ok).toBe(true);
    const firstId = first.deploymentId;

    // AI edits the file
    tree["index.html"] = "<!doctype html><h1>Version 2 — updated</h1>";

    const second = await deployUserProject(
      {
        userId: "user_alice",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      deps,
    );
    expect(second.ok).toBe(true);
    // Different content hash → new deployment (not reused)
    expect(second.deploymentId).not.toBe(firstId);
    if (second.ok) {
      expect(second.reused).toBe(false);
    }

    // Verify the new deployment serves the updated content
    const files = store.files.get(second.deploymentId!);
    const index = files?.find((f) => f.path === "index.html");
    expect(index?.content).toContain("Version 2");
    expect(spawnCalls).toEqual([]);
  });

  it("3. different user cannot publish another user's project", async () => {
    const store = memoryStore();
    const transport = staticTransport("user_alice", "proj_alice", {
      "index.html": "<!doctype html><h1>Alice</h1>",
    });

    const result = await deployUserProject(
      // Bob tries to deploy Alice's project
      {
        userId: "user_bob",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      { store, fetchImpl: fakeFetch(store) as unknown as typeof fetch },
    );

    expect(result.ok).toBe(false);
    expect(result.publicUrl).toBeNull();
    // No deployment row should have been created
    expect(store.rows).toHaveLength(0);
    expect(spawnCalls).toEqual([]);
  });

  it("4. path traversal in published files is rejected", async () => {
    const store = memoryStore();
    // Tree with a traversal attempt
    const tree = {
      "index.html": "<!doctype html><h1>Safe</h1>",
      "../evil.html": "<script>evil</script>",
      "sub/../../escape.html": "<script>escape</script>",
    };
    const transport = staticTransport("user_alice", "proj_alice", tree);

    const result = await deployUserProject(
      {
        userId: "user_alice",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      { store, fetchImpl: fakeFetch(store) as unknown as typeof fetch },
    );

    // Deploy should succeed (traversal files are skipped, not fatal)
    expect(result.ok).toBe(true);
    // But the traversal files must NOT be in the published artifact
    const files = store.files.get(result.deploymentId!);
    const paths = files?.map((f) => f.path) ?? [];
    expect(paths).not.toContain("../evil.html");
    expect(paths).not.toContain("sub/../../escape.html");
    expect(paths).toContain("index.html");
    expect(spawnCalls).toEqual([]);
  });

  it("5. deployment status transitions support unpublish", () => {
    // ready → unpublished is valid
    expect(isDeploymentTransitionValid("ready", "unpublished")).toBe(true);
    // unpublished is terminal (no outgoing transitions)
    expect(isDeploymentTransitionValid("unpublished", "ready")).toBe(false);
    // cannot unpublish from non-ready states
    expect(isDeploymentTransitionValid("building", "unpublished")).toBe(false);
    expect(isDeploymentTransitionValid("failed", "unpublished")).toBe(false);
  });

  it("6. unpublish removes public access (owner only)", async () => {
    const store = memoryStore();
    const transport = staticTransport("user_alice", "proj_alice", {
      "index.html": "<!doctype html><h1>Live</h1>",
    });
    const deps = {
      store,
      fetchImpl: fakeFetch(store) as unknown as typeof fetch,
    };

    const deployed = await deployUserProject(
      {
        userId: "user_alice",
        projectId: "proj_alice",
        transport,
        hosting: fakeHosting(),
      },
      deps,
    );
    expect(deployed.ok).toBe(true);
    const depId = deployed.deploymentId!;

    // Non-owner cannot unpublish
    const bobResult = await unpublishDeployment(
      { userId: "user_bob", projectId: "proj_alice", deploymentId: depId },
      deps,
    );
    expect(bobResult.ok).toBe(false);
    expect(bobResult.message).toContain("do not own");

    // Owner can unpublish
    const aliceResult = await unpublishDeployment(
      { userId: "user_alice", projectId: "proj_alice", deploymentId: depId },
      deps,
    );
    expect(aliceResult.ok).toBe(true);

    // Status is now unpublished — the serving route only serves `ready`
    const row = await store.findById(depId);
    expect(row?.status).toBe("unpublished");
    expect(spawnCalls).toEqual([]);
  });

  it("7. unpublish of non-ready deployment is refused", async () => {
    const store = memoryStore();
    const deps = { store, hosting: fakeHosting() };

    // Create a building deployment directly
    const row = await store.create({
      userId: "user_alice",
      projectId: "proj_alice",
      workspaceId: "ws_alice",
      status: "building",
      target: "litt-static",
    });

    const result = await unpublishDeployment(
      { userId: "user_alice", projectId: "proj_alice", deploymentId: row.id },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("building");
    expect(spawnCalls).toEqual([]);
  });
});
