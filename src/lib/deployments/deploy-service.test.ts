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
import { isCanonicalBase64, isStorableUtf8 } from "./user-deployment";

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
    async findInFlightByContentHash(projectId, contentHash) {
      return rows.find(
        (r) => r.projectId === projectId && r.contentHash === contentHash &&
          (r.status === "building" || r.status === "deploying"),
      ) ?? null;
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

/** A LiTT Hosting backend fake: the live URL is resolved from "infrastructure". */
function fakeHosting(baseUrl: string = BASE): import("./litt-hosting").HostingBackend {
  return {
    isConfigured: () => ({ ok: true }),
    resolveBaseUrl: async () => baseUrl,
  };
}

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

  it("recurses into directories reported as \"folder\"", async () => {
    // Regression: the terminal workspace API labels directories "folder",
    // not "directory" — assets under subdirectories were never collected,
    // so every deployment shipped only root-level files and the artifact
    // validator failed deploys that referenced images.
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") {
          return { entries: [{ name: "images", type: "folder" }] };
        }
        if (path === "assets/images") {
          return { entries: [{ name: "hero.png", type: "file" }] };
        }
        return { entries: [] };
      },
      async readBinaryFile(path: string) {
        if (path !== "assets/images/hero.png") throw new Error(`no such file: ${path}`);
        const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
        return { content, size: 4 };
      },
    });
    const artifact = await collectStaticArtifact(transport);
    const png = artifact.find((f) => f.path === "assets/images/hero.png");
    expect(png).toBeDefined();
    expect(png!.encoding).toBe("base64");
    expect(Buffer.from(png!.content, "base64")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("skips binary files when the transport cannot read them, so validation reports the missing reference", async () => {
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") {
          return { entries: [{ name: "hero.png", type: "file" }] };
        }
        return { entries: [] };
      },
      readBinaryFile: undefined,
    });
    const artifact = await collectStaticArtifact(transport);
    expect(artifact.find((f) => f.path === "assets/hero.png")).toBeUndefined();
  });

  it("collects the full set of generated-site binary types", async () => {
    const names = ["hero.avif", "doc.pdf", "mod.wasm", "font.otf", "img.bmp", "bundle.zip"];
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") {
          return { entries: names.map((name) => ({ name, type: "file" })) };
        }
        return { entries: [] };
      },
      async readBinaryFile() {
        const content = Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString("base64");
        return { content, size: 4 };
      },
    });
    const artifact = await collectStaticArtifact(transport);
    for (const name of names) {
      const file = artifact.find((f) => f.path === `assets/${name}`);
      expect(file, `assets/${name} should be collected`).toBeDefined();
      expect(file!.encoding).toBe("base64");
    }
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
    }, { store: spied, fetchImpl: reachableFetch });

    expect(seen).toEqual(["deploying", "ready"]);
  });

  it("never returns provider credentials in the result", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/service[-_]?key|secret|password|bearer|sk-/i);
  });

  it("stores each file with its explicit storage encoding", async () => {
    // The 22P05 "unsupported Unicode escape sequence" failure happened
    // because binary content reached a text-shaped insert. Files must be
    // persisted with an explicit encoding so serving can decode correctly.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") return { entries: [{ name: "hero.png", type: "file" }] };
        return { entries: [] };
      },
      async readBinaryFile() {
        return { content: pngBytes.toString("base64"), size: pngBytes.length };
      },
    });
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = store.files.get(result.deploymentId) as Array<{
      path: string; content: string; encoding: string; bytes: number;
    }>;
    const htmlRow = stored.find((f) => f.path === "index.html")!;
    const pngRow = stored.find((f) => f.path === "assets/hero.png")!;
    expect(htmlRow.encoding).toBe("utf-8");
    expect(pngRow.encoding).toBe("base64");
    // The stored payload decodes back to the exact source bytes.
    expect(Buffer.from(pngRow.content, "base64")).toEqual(pngBytes);
    expect(pngRow.bytes).toBe(pngBytes.length);
  });

  it("fails cleanly before persisting when binary content arrives corrupted", async () => {
    // A transport that returns a utf-8 decode labeled as binary (e.g. an
    // older terminal ignoring encoding=base64) must not reach the insert —
    // the content contains NULs that Postgres rejects with 22P05.
    const utf8Jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("utf-8");
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") return { entries: [{ name: "x.jpeg", type: "file" }] };
        return { entries: [] };
      },
      async readBinaryFile() {
        // Dishonored contract: utf-8 content masquerading as base64.
        return { content: utf8Jpeg, size: 6 };
      },
    });
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("validation");
    expect(result.message).toContain("assets/x.jpeg");
    // Nothing was persisted — no half-written deployment.
    expect(store.rows).toHaveLength(0);
  });

  it("stores a generated JPEG as canonical base64, not as mangled text", async () => {
    // The incident artifact: an image-generated JPEG under assets/images/.
    // Through the honored base64 contract it must persist byte-exact —
    // and its stored payload must itself satisfy the storable-text rules
    // (a utf-8 decode of these bytes would contain NULs and fail).
    const jpegBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x02, 0x03, 0x04, 0x05, 0xff, 0xd9,
    ]);
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return {
            entries: [
              { name: "index.html", type: "file" },
              { name: "assets", type: "folder" },
            ],
          };
        }
        if (path === "assets") return { entries: [{ name: "images", type: "folder" }] };
        if (path === "assets/images") {
          return { entries: [{ name: "puppy.jpeg", type: "file" }] };
        }
        return { entries: [] };
      },
      async readBinaryFile() {
        return { content: jpegBytes.toString("base64"), size: jpegBytes.length };
      },
    });
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = store.files.get(result.deploymentId) as Array<{
      path: string; content: string; encoding: string; bytes: number;
    }>;
    const jpegRow = stored.find((f) => f.path === "assets/images/puppy.jpeg")!;
    expect(jpegRow.encoding).toBe("base64");
    expect(isCanonicalBase64(jpegRow.content)).toBe(true);
    expect(isStorableUtf8(jpegRow.content)).toBe(true);
    expect(Buffer.from(jpegRow.content, "base64")).toEqual(jpegBytes);
  });
});

/* ── Case M: concurrent duplicate deploys attach to the in-flight one ─ */

describe("M. in-flight duplicate deploy is reused, not republished", () => {
  it("waits for the in-flight deployment and returns its outcome", async () => {
    const store = fakeStore();
    // First deploy completes normally.
    const first = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstId = first.deploymentId;

    // Simulate the row still being in-flight (a concurrent worker's deploy).
    // The ready-dedup path must NOT match; the in-flight path must.
    const row = store.rows.find((r) => r.id === firstId)!;
    row.status = "building";
    row.urlVerified = false;

    // The "other worker" finishes on the second status poll.
    let polls = 0;
    const origFindById = store.findById.bind(store);
    store.findById = async (id: string) => {
      const rec = await origFindById(id);
      polls += 1;
      if (polls >= 2 && rec) {
        rec.status = "ready";
        rec.urlVerified = true;
      }
      return rec;
    };

    const second = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.deploymentId).toBe(firstId);
    expect(second.status).toBe("ready");
    expect(second.urlVerified).toBe(true);
    // No second deployment row was published.
    expect(store.rows).toHaveLength(1);
  });

  it("falls through to a fresh deploy when the in-flight one fails", async () => {
    const store = fakeStore();
    const first = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const row = store.rows.find((r) => r.id === first.deploymentId)!;
    row.status = "building";
    row.urlVerified = false;
    // The in-flight deploy fails immediately.
    store.findById = async (id: string) => {
      const rec = store.rows.find((r) => r.id === id) ?? null;
      if (rec) rec.status = "failed";
      return rec;
    };

    const second = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(false);
    expect(store.rows).toHaveLength(2);
  });
});

/* ── Case L: the URL is verified BEFORE completion is reported ──── */

describe("L. live URL must be independently verified before success", () => {
  it("fetches the public URL before marking it verified", async () => {
    const store = fakeStore();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      // The serving route only answers `ready` rows — at verification time
      // the row must already be ready, but NOT yet urlVerified.
      expect(store.rows[0].status).toBe("ready");
      expect(store.rows[0].urlVerified).toBe(false);
      return new Response("ok", { status: 200 });
    });

    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(BASE);
    expect(result.ok).toBe(true);
  });

  it("regression: verifies through the ready-gated serving path", async () => {
    const store = fakeStore();
    // Mimics the real /sites/[deploymentId] route: the row is served only
    // while status === "ready". Verifying before publishing can never pass.
    const fetchImpl = vi.fn(async () =>
      store.rows[0]?.status === "ready"
        ? new Response("<h1>Ember Roast</h1>", { status: 200 })
        : new Response("not found", { status: 404 }),
    );

    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.urlVerified).toBe(true);
    expect(store.rows[0].status).toBe("ready");
  });

  it("reverts ready to failed when the public URL does not serve", async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
        hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    const other = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_other",
      transport: fakeTransport({ projectId: "proj_other" }),
      hosting: fakeHosting(),
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
      hosting: fakeHosting(),
    }, { store, fetchImpl: failing as unknown as typeof fetch });

    const retry = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(retry.ok).toBe(true);
    expect(store.rows).toHaveLength(2);
  });
});

/* ── Publish gates: fabrication blocks the deploy ───────────────── */

describe("publish gates", () => {
  it("fails the deploy when the artifact still has fabricated template content", async () => {
    const store = fakeStore();
    const transport = fakeTransport({
      async listFiles(path: string) {
        if (path === "." || path === "") {
          return { entries: [{ name: "index.html", type: "file" }] };
        }
        return { entries: [] };
      },
      async readFile(path: string) {
        if (path !== "index.html") throw new Error(`no such file: ${path}`);
        const content = `<!doctype html><h1>Build Something Amazing</h1><p>"Loved it" — Sarah Chen, CTO, TechFlow</p>`;
        return { content, size: content.length };
      },
    });

    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport,
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failed");
    expect(result.publicUrl).toBe(null);
    expect(result.errorClass).toBe("validation");
    expect(result.retryable).toBe(false);
    // User-facing: names the sections to fix, no jargon.
    expect(result.message).toContain("Hero section");
    expect(result.message).toContain("Testimonials");
    expect(result.message).not.toMatch(/stack|TypeError|undefined/i);
    // Nothing was published.
    expect(store.rows).toHaveLength(0);
  });

  it("lets a clean artifact through the gates", async () => {
    const store = fakeStore();
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(true);
  });
});

/* ── LiTT Hosting: infra-resolved live URL, honest failures ───────── */

describe("LiTT Hosting backend", () => {
  it("unconfigured hosting fails BEFORE any deployment row exists", async () => {
    const store = fakeStore();
    const unconfigured: import("./litt-hosting").HostingBackend = {
      isConfigured: () => ({ ok: false, reason: "LiTT Hosting isn't set up on this workspace yet." }),
      resolveBaseUrl: async () => {
        throw new Error("must not be called when unconfigured");
      },
    };
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: unconfigured,
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failed");
    expect(result.publicUrl).toBe(null);
    expect(result.deploymentId).toBe(null);
    // Honest, user-safe, and provider-agnostic.
    expect(result.message).toContain("LiTT Hosting");
    expect(result.message).not.toMatch(/railway|vercel/i);
    // No row was created — there is nothing to misreport as deployed.
    expect(store.rows).toHaveLength(0);
  });

  it("infrastructure URL-resolution failure marks the deployment failed with the real error", async () => {
    const store = fakeStore();
    const broken: import("./litt-hosting").HostingBackend = {
      isConfigured: () => ({ ok: true }),
      resolveBaseUrl: async () => {
        throw new Error("Hosting infrastructure error: service not found.");
      },
    };
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: broken,
    }, { store, fetchImpl: reachableFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.publicUrl).toBe(null);
    // The REAL infrastructure error surfaces — no fake URL, no fake success.
    expect(result.message).toContain("service not found");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].publicUrl).toBe(null);
    expect(store.rows[0].urlVerified).toBe(false);
    expect(store.rows[0].errorMessage).toContain("service not found");
  });

  it("persists the infrastructure-resolved live URL and verifies it", async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL): Promise<Response> => new Response("<h1>Ember Roast</h1>", { status: 200 }));
    const result = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting("https://infra-resolved.example"),
    }, { store, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The URL comes from the backend's resolved infrastructure base —
    // never from caller input.
    expect(result.publicUrl).toContain("https://infra-resolved.example");
    expect(result.publicUrl).toContain(result.deploymentId);
    expect(result.urlVerified).toBe(true);
    const row = store.rows.find((r) => r.id === result.deploymentId);
    expect(row?.publicUrl).toBe(result.publicUrl);
    expect(row?.urlVerified).toBe(true);
    expect(row?.target).toBe("litt-static");
    // Verification actually fetched the resolved URL.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(result.publicUrl);
  });

  it("retry of identical content reuses the verified deployment (idempotent)", async () => {
    const store = fakeStore();
    const first = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });
    expect(first.ok).toBe(true);

    const second = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting("https://other-infra.example"),
    }, { store, fetchImpl: reachableFetch });

    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    // Same deployment reused — the second backend's base never leaks in.
    expect(second.deploymentId).toBe(first.deploymentId);
    expect(second.publicUrl).toBe(first.publicUrl);
    expect(second.publicUrl).not.toContain("other-infra");
    expect(store.rows).toHaveLength(1);
  });
});
