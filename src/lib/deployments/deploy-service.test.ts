import { describe, it, expect, vi } from "vitest";

/**
 * User-project deploy service — behavioural regression tests.
 *
 * These prove the V1 journey can actually complete (build → deploy → live
 * URL) AND that it refuses to complete when it should not. The service is
 * the only place a user project becomes publicly reachable, so every
 * authorization boundary is asserted here.
 */

import {
  deployUserProject,
  collectStaticArtifact,
  type DeploymentStore,
  type DeploySourceTransport,
  type DeploymentRecord,
} from "./deploy-service";

/* ── Fakes ──────────────────────────────────────────────────────── */

/** A workspace holding a minimal Ember Roast static site. */
function fakeTransport(over: Partial<DeploySourceTransport> = {}): DeploySourceTransport {
  const tree: Record<string, string> = {
    "index.html": "<!doctype html><title>Ember Roast</title><h1>Ember Roast</h1>",
    "styles.css": "body{background:#1a1a1a}",
  };
  return {
    userId: "user_owner",
    projectId: "proj_ember",
    workspaceId: "ws_ember",
    async listFiles(path: string) {
      if (path === "." || path === "") {
        return { entries: [{ name: "index.html", type: "file" }, { name: "styles.css", type: "file" }] };
      }
      return { entries: [] };
    },
    async readFile(path: string) {
      const content = tree[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return { content, size: content.length };
    },
    ...over,
  };
}

function fakeStore(): DeploymentStore & { rows: DeploymentRecord[]; files: Map<string, unknown[]> } {
  const rows: DeploymentRecord[] = [];
  const files = new Map<string, unknown[]>();
  let seq = 0;
  return {
    rows,
    files,
    async findReadyByContentHash(projectId, contentHash) {
      return rows.find(
        (r) => r.projectId === projectId && r.contentHash === contentHash && r.status === "ready",
      ) ?? null;
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
      if (!row) throw new Error("deployment not found");
      Object.assign(row, patch);
      return row;
    },
    async putFiles(id, artifactFiles) {
      files.set(id, artifactFiles);
    },
  };
}

/** A fetch that reports the published site as reachable. */
const reachableFetch = vi.fn(async () => new Response("<h1>Ember Roast</h1>", { status: 200 }));

const BASE = "https://litlabs.example";

/* ── Artifact collection ────────────────────────────────────────── */

describe("collectStaticArtifact", () => {
  it("collects the workspace's static files", async () => {
    const artifact = await collectStaticArtifact(fakeTransport());
    const paths = artifact.map((f) => f.path).sort();
    expect(paths).toEqual(["index.html", "styles.css"]);
  });

  it("skips directories that never belong in a deployment", async () => {
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "node_modules", type: "directory" },
              { name: ".git", type: "directory" },
              { name: ".env", type: "file" },
            ],
          };
        }
        return { entries: [] };
      },
    });
    const artifact = await collectStaticArtifact(transport);
    const paths = artifact.map((f) => f.path);
    expect(paths).toEqual(["index.html"]);
    expect(paths).not.toContain(".env");
  });
});

/* ── Case A: successful deployment of a static project ──────────── */

describe("A. static project deploys and returns a verified live URL", () => {
  it("succeeds and reports a public URL", async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async () => new Response("<h1>Ember Roast</h1>", { status: 200 }));
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("ready");
    expect(result.publicUrl).toContain(BASE);
    expect(result.publicUrl).toContain(result.deploymentId);
    expect(result.urlVerified).toBe(true);
    expect(result.target).toBe("litt-static");
    expect(result.projectId).toBe("proj_ember");
    expect(result.workspaceId).toBe("ws_ember");
  });

  it("persists the artifact files", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.files.get(result.deploymentId)).toHaveLength(2);
  });

  it("walks not_started → building → deploying → ready", async () => {
    const store = fakeStore();
    const seen: string[] = [];
    const spied: DeploymentStore = {
      ...store,
      async update(id, patch) {
        if (patch.status) seen.push(patch.status);
        return store.update(id, patch);
      },
    };
    await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store: spied, fetchImpl: reachableFetch });

    expect(seen).toEqual(["deploying", "ready"]);
  });

  it("never returns provider credentials in the result", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/service[-_]?key|secret|password|bearer|sk-/i);
  });
});

/* ── Case L: the URL is verified BEFORE completion is reported ──── */

describe("L. live URL must be independently verified before ready", () => {
  it("fetches the public URL before marking ready", async () => {
    const store = fakeStore();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // At verification time the row must NOT yet be ready.
      expect(store.rows[0].status).not.toBe("ready");
      return new Response("ok", { status: 200 });
    });

    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(BASE);
    expect(result.ok).toBe(true);
  });

  it("fails — never ready — when the public URL does not serve", async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/not reachable|verification/i);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].urlVerified).toBe(false);
  });

  it("fails when verification throws (network error), and marks it retryable", async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.status).toBe("failed");
  });
});

/* ── Case C: deploy failure is reported truthfully ──────────────── */

describe("C. a failed deployment never reports live", () => {
  it("fails when the workspace has no index.html", async () => {
    const transport = fakeTransport({
      async listFiles() {
        return { entries: [{ name: "notes.txt", type: "file" }] };
      },
      async readFile() {
        return { content: "hello", size: 5 };
      },
    });
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/index\.html/);
    expect(result.retryable).toBe(false);
    expect(result.publicUrl).toBeNull();
  });

  it("does not publish anything when validation fails", async () => {
    const transport = fakeTransport({
      async listFiles() {
        return { entries: [] };
      },
    });
    const store = fakeStore();
    await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });
    expect(store.files.size).toBe(0);
  });
});

/* ── Case D: wrong user ─────────────────────────────────────────── */

describe("D. deployment is rejected for the wrong user", () => {
  it("refuses when the caller is not the transport's owner", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_attacker",
      projectId: "proj_ember",
      transport: fakeTransport({ userId: "user_owner" }),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("authorization");
    expect(store.rows).toHaveLength(0);
    expect(store.files.size).toBe(0);
  });

  it("refuses an empty or missing user id", async () => {
    const store = fakeStore();
    for (const userId of ["", "   "]) {
      const result = await deployUserProject({
        userId,
        projectId: "proj_ember",
        transport: fakeTransport(),
        publicBaseUrl: BASE,
      }, { store, fetchImpl: reachableFetch });
      expect(result.ok).toBe(false);
    }
    expect(store.rows).toHaveLength(0);
  });
});

/* ── Case E: project / workspace mismatch ───────────────────────── */

describe("E. deployment is rejected on project/workspace mismatch", () => {
  it("refuses when the requested project is not the transport's project", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_someone_else",
      transport: fakeTransport({ projectId: "proj_ember" }),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("authorization");
    expect(result.message).toMatch(/project/i);
    expect(store.rows).toHaveLength(0);
  });

  it("refuses when the transport has no workspace", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport({ workspaceId: "" }),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it("records the workspace the artifact actually came from", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport({ workspaceId: "ws_specific" }),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(true);
    expect(store.rows[0].workspaceId).toBe("ws_specific");
  });
});

/* ── Case G: LiTT's own infrastructure is unreachable from here ─── */

describe("G. the user deploy path cannot target LiTT infrastructure", () => {
  it("accepts no provider, service, or account input at all", async () => {
    const store = fakeStore();
    // Extra keys are not part of DeployRequest; even when forced through,
    // nothing reads them, so no Railway service can be selected.
    const forced = {
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
      railwayServiceId: "litt-production-service",
      provider: "railway",
      target: "railway",
    } as unknown as Parameters<typeof deployUserProject>[0];

    const result = await deployUserProject(forced, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The target is fixed by the server, never chosen by the caller.
    expect(result.target).toBe("litt-static");
    expect(store.rows[0].target).toBe("litt-static");
  });

  it("never calls the Railway API or LiTT's own deploy trigger", async () => {
    const store = fakeStore();
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("ok", { status: 200 });
    });
    await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    for (const url of urls) {
      expect(url).not.toMatch(/backboard\.railway\.app/);
      expect(url).not.toMatch(/\/api\/deploy\/trigger/);
    }
  });
});

/* ── Case J: duplicate deployment suppression ───────────────────── */

describe("J. a duplicate deploy of identical content does not republish", () => {
  it("returns the existing ready deployment instead of creating a second", async () => {
    const store = fakeStore();
    const request = {
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    };

    const first = await deployUserProject(request, { store, fetchImpl: reachableFetch });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await deployUserProject(request, { store, fetchImpl: reachableFetch });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.deploymentId).toBe(first.deploymentId);
    expect(second.reused).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("does publish again when the content actually changed", async () => {
    const store = fakeStore();
    const base = {
      userId: "user_owner",
      projectId: "proj_ember",
      publicBaseUrl: BASE,
    };
    const first = await deployUserProject(
      { ...base, transport: fakeTransport() },
      { store, fetchImpl: reachableFetch },
    );
    const changed = fakeTransport({
      async readFile(path: string) {
        if (path === "index.html") {
          return { content: "<!doctype html><title>Ember Roast v2</title>", size: 44 };
        }
        return { content: "body{}", size: 6 };
      },
    });
    const second = await deployUserProject(
      { ...base, transport: changed },
      { store, fetchImpl: reachableFetch },
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.deploymentId).not.toBe(first.deploymentId);
    expect(second.reused).toBe(false);
    expect(store.rows).toHaveLength(2);
  });

  it("does not reuse another project's deployment with the same content", async () => {
    const store = fakeStore();
    await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    const other = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_other",
      transport: fakeTransport({ projectId: "proj_other" }),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.reused).toBe(false);
    expect(store.rows).toHaveLength(2);
  });

  it("does not reuse a failed deployment", async () => {
    const store = fakeStore();
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: failing as unknown as typeof fetch });

    const retry = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      publicBaseUrl: BASE,
    }, { store, fetchImpl: reachableFetch });

    expect(retry.ok).toBe(true);
    expect(store.rows).toHaveLength(2);
  });
});
