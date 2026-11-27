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
  unpublishDeployment,
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
    async findFailedByContentHash(projectId, contentHash) {
      return [...rows].reverse().find(
        (r) => r.projectId === projectId && r.contentHash === contentHash && r.status === "failed",
      ) ?? null;
    },
    async readPublishedFile(id, path, options) {
      // Mirrors the real serving gate: `ready` rows serve; a `deploying`
      // row serves ONLY to its own verification token; nothing else does.
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      const tokenOk =
        row.status === "deploying" &&
        !!options?.verificationToken &&
        options.verificationToken === row.verificationToken;
      if (row.status !== "ready" && !tokenOk) return null;
      const file = (files.get(id) ?? []).find(
        (f) => (f as { path: string }).path === path,
      ) as { content: string; contentType: string; encoding: "utf-8" | "base64" } | undefined;
      return file ? { content: file.content, contentType: file.contentType, encoding: file.encoding } : null;
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
        verificationToken: input.verificationToken ?? null,
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
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      // Verification happens while the row is still `deploying` — NOT
      // ready. The serving route answers the fetch only because it
      // carries the deployment's own verification token. (The old flow
      // flipped the row to `ready` first, publicly serving unverified
      // content to break the ready-gate circle — the 2026-09-13
      // circularity the publication-integrity fix removes.)
      expect(store.rows[0].status).toBe("deploying");
      expect(store.rows[0].urlVerified).toBe(false);
      expect(new Headers(init?.headers).get("x-litt-deploy-verification")).toBe(
        store.rows[0].verificationToken,
      );
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

  it("regression: verifies through the token-gated serving path", async () => {
    const store = fakeStore();
    // Mimics the real /sites/[deploymentId] route: a deployment serves
    // while `ready`, or while `deploying` ONLY to a request carrying
    // its own verification token — never to the public early.
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const row = store.rows[0];
      const token = new Headers(init?.headers).get("x-litt-deploy-verification");
      const serves =
        row?.status === "ready" ||
        (row?.status === "deploying" && !!token && token === row.verificationToken);
      return serves
        ? new Response("<h1>Ember Roast</h1>", { status: 200 })
        : new Response("not found", { status: 404 });
    });

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

  it("marks the deployment failed when the public URL does not serve", async () => {
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

  it("repairs the failed deployment on a same-content retry instead of minting a second row", async () => {
    // Publication integrity (2026-11-27): a retry of the same logical
    // publish after a failure used to create a SECOND deployment row.
    // The failed row is repaired in place — same id, one row total.
    const store = fakeStore();
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    const first = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: failing as unknown as typeof fetch });
    expect(first.ok).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("failed");

    const retry = await deployUserProject({
      userId: "user_owner",
      projectId: "proj_ember",
      transport: fakeTransport(),
      hosting: fakeHosting(),
    }, { store, fetchImpl: reachableFetch });

    expect(retry.ok).toBe(true);
    if (!retry.ok || first.ok) return;
    expect(retry.deploymentId).toBe(first.deploymentId);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("ready");
    expect(store.rows[0].errorClass).toBeNull();
  });
});

/* ── Publish gates: fabrication blocks the deploy ───────────────── */

/* ── Case N: republish of earlier content after a newer unpublish ──
 * Greptile PR #1106, round 2: publish A, publish B, unpublish B, then
 * publish A's exact contents again. The dedupe REUSES A without
 * touching any row, so under the newest-publish-decides rule the
 * stable project address kept seeing B (unpublished) as the newest
 * word and stayed dark despite the successful republish. A reused
 * publish must be recorded as the newest publish event. */

describe("N. republish after unpublish restores the stable address", () => {
  const transportB = () =>
    fakeTransport({
      async readFile(path: string) {
        if (path === "index.html") {
          return { content: "<!doctype html><title>Ember Roast v2</title>", size: 44 };
        }
        return { content: "body{}", size: 6 };
      },
    });

  /** The stable-address rule's first step: the newest publish event. */
  function newestPublish(rows: DeploymentRecord[]): DeploymentRecord | null {
    return (
      [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null
    );
  }

  async function publishAB(store: ReturnType<typeof fakeStore>) {
    const base = { userId: "user_owner", projectId: "proj_ember", hosting: fakeHosting() };
    const a = await deployUserProject(
      { ...base, transport: fakeTransport() },
      { store, fetchImpl: reachableFetch },
    );
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("publish A failed");
    const rowA = store.rows.find((r) => r.id === a.deploymentId)!;
    rowA.createdAt = "2026-11-23T10:00:00.000Z";
    const b = await deployUserProject(
      { ...base, transport: transportB() },
      { store, fetchImpl: reachableFetch },
    );
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error("publish B failed");
    const rowB = store.rows.find((r) => r.id === b.deploymentId)!;
    rowB.createdAt = "2026-11-23T11:00:00.000Z";
    return { base, a, b, rowA, rowB };
  }

  it("republishing A's exact content after unpublishing B makes A the newest publish again", async () => {
    const store = fakeStore();
    const { base, a, b } = await publishAB(store);

    const unpub = await unpublishDeployment(
      { userId: "user_owner", projectId: "proj_ember", deploymentId: b.deploymentId },
      { store },
    );
    expect(unpub.ok).toBe(true);
    // Mid-sequence: the newest publish is B and it is unpublished —
    // the stable address is dark at this point, correctly.
    expect(newestPublish(store.rows)?.id).toBe(b.deploymentId);
    expect(newestPublish(store.rows)?.status).toBe("unpublished");

    const again = await deployUserProject(
      { ...base, transport: fakeTransport() },
      { store, fetchImpl: reachableFetch },
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reused).toBe(true);
    expect(again.deploymentId).toBe(a.deploymentId);
    expect(store.rows).toHaveLength(2);

    // The republish was recorded: A is once again the newest publish,
    // and it is ready — the stable address serves A's content.
    const newest = newestPublish(store.rows);
    expect(newest?.id).toBe(a.deploymentId);
    expect(newest?.status).toBe("ready");
  });

  it("without a republish, unpublishing the newest leaves the older publish older", async () => {
    const store = fakeStore();
    const { a, b, rowA } = await publishAB(store);

    const unpub = await unpublishDeployment(
      { userId: "user_owner", projectId: "proj_ember", deploymentId: b.deploymentId },
      { store },
    );
    expect(unpub.ok).toBe(true);

    // Nothing was republished, so nothing may resurface: the newest
    // publish remains the unpublished B and A keeps its older stamp.
    const newest = newestPublish(store.rows);
    expect(newest?.id).toBe(b.deploymentId);
    expect(newest?.status).toBe("unpublished");
    expect(rowA.createdAt).toBe("2026-11-23T10:00:00.000Z");
    expect(a.deploymentId).not.toBe(newest?.id);
  });

  it("attaching to an in-flight deploy also records the republish", async () => {
    const store = fakeStore();
    const first = await deployUserProject(
      {
        userId: "user_owner",
        projectId: "proj_ember",
        transport: fakeTransport(),
        hosting: fakeHosting(),
      },
      { store, fetchImpl: reachableFetch },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const row = store.rows.find((r) => r.id === first.deploymentId)!;
    row.createdAt = "2026-11-23T10:00:00.000Z";
    row.status = "building";
    row.urlVerified = false;

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

    const second = await deployUserProject(
      {
        userId: "user_owner",
        projectId: "proj_ember",
        transport: fakeTransport(),
        hosting: fakeHosting(),
      },
      { store, fetchImpl: reachableFetch },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(true);
    // The reused row was stamped as the newest publish event.
    expect(row.createdAt).not.toBe("2026-11-23T10:00:00.000Z");
    expect((row.createdAt ?? "") > "2026-11-23T10:00:00.000Z").toBe(true);
  });
});

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

  it("infrastructure URL-resolution failure leaves NO deployment row and no stored files", async () => {
    // Publication integrity (2026-11-27): resolution used to run AFTER
    // putFiles, so this failure left stored files under a failed row
    // claiming file_count 0 and no URL (the 2026-11-04 signature).
    // Resolution now runs before any write — the failure leaves
    // nothing behind, and the REAL error still surfaces.
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
    expect(result.deploymentId).toBe(null);
    // The REAL infrastructure error surfaces — no fake URL, no fake success.
    expect(result.message).toContain("service not found");
    expect(store.rows).toHaveLength(0);
    expect(store.files.size).toBe(0);
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

/* ── P0 publication integrity (Larry's addendum, 2026-11-27) ──────
 * Regression tests shaped like the three historical failure classes
 * the read-only inspection confirmed still possible on main d8246e6d:
 * the 2026-09-13 verification race, the 2026-11-04 "Not Authorized"
 * ordering, and the failed-publish second-row gap. */

describe("P0. publication verification integrity", () => {
  const request = () => ({
    userId: "user_owner",
    projectId: "proj_ember",
    transport: fakeTransport(),
    hosting: fakeHosting(),
  });

  it("(a) transient verification failures are retried and the deployment ends ready — never stamped failed, never ready early", async () => {
    const store = fakeStore();
    const statusesSeen: string[] = [];
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      statusesSeen.push(store.rows[0].status);
      // The Sep-13 shape: the artifact is stored, but the serving path
      // answers 404, then a 503 blip, before it can see the deployment.
      if (attempts === 1) return new Response("not yet", { status: 404 });
      if (attempts === 2) return new Response("blip", { status: 503 });
      return new Response("<h1>Ember Roast</h1>", { status: 200 });
    });

    const result = await deployUserProject(request(), {
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
    // During every attempt the row was still `deploying`: unverified
    // content was never publicly servable under the `ready` gate.
    expect(statusesSeen).toEqual(["deploying", "deploying", "deploying"]);
    expect(store.rows[0].status).toBe("ready");
    expect(store.rows[0].urlVerified).toBe(true);
    expect(store.rows[0].errorClass).toBeNull();
  });

  it("(b) base-URL resolution failure ('Not Authorized') creates no row, stores no files, and classifies as authorization", async () => {
    const store = fakeStore();
    const unauthorized: import("./litt-hosting").HostingBackend = {
      isConfigured: () => ({ ok: true }),
      resolveBaseUrl: async () => {
        throw new Error("Hosting infrastructure error: Not Authorized.");
      },
    };

    const result = await deployUserProject(
      { ...request(), hosting: unauthorized },
      { store, fetchImpl: reachableFetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("authorization");
    expect(result.errorClass).not.toBe("unknown");
    expect(result.retryable).toBe(false);
    expect(result.deploymentId).toBe(null);
    expect(store.rows).toHaveLength(0);
    expect(store.files.size).toBe(0);
  });

  it("(c) a failed publish retried with identical content repairs the same row — exactly one row, counts consistent with stored files", async () => {
    const store = fakeStore();
    const down = vi.fn(async () => new Response("no", { status: 404 }));
    const first = await deployUserProject(request(), {
      store,
      fetchImpl: down as unknown as typeof fetch,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(store.rows).toHaveLength(1);
    const failedRow = store.rows[0];
    expect(failedRow.status).toBe("failed");
    // The recorded counts match the files actually stored — the Nov-4
    // mismatch (file_count 0 over stored files) cannot recur, because
    // the counts are written with the `deploying` update, before
    // verification runs.
    expect(failedRow.fileCount).toBe(2);
    expect(failedRow.fileCount).toBe((store.files.get(failedRow.id) ?? []).length);
    expect(failedRow.publicUrl).toContain(failedRow.id);

    const retry = await deployUserProject(request(), { store, fetchImpl: reachableFetch });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    // One row for the logical publish, repaired — not a second row.
    expect(retry.deploymentId).toBe(first.deploymentId);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("ready");
    expect(store.rows[0].urlVerified).toBe(true);
    expect(store.rows[0].errorClass).toBeNull();
    expect(store.rows[0].errorMessage).toBeNull();
    expect(store.rows[0].fileCount).toBe(2);
  });

  it("(d) an artifact that never reads back from storage fails permanently — validation class, not unknown, not retryable", async () => {
    const store = fakeStore();
    // The write is accepted but the files never become readable — the
    // artifact is genuinely absent, not merely unpropagated.
    store.readPublishedFile = async () => null;
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const result = await deployUserProject(request(), {
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("validation");
    expect(result.errorClass).not.toBe("unknown");
    expect(result.retryable).toBe(false);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].errorClass).toBe("validation");
    // HTTP verification is never reached — there is nothing to serve.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("(d2) a URL that never answers fails as temporary 'unavailable' after bounded retries — not unknown, not unbounded", async () => {
    const store = fakeStore();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      return new Response("no", { status: 404 });
    });

    const result = await deployUserProject(request(), {
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("unavailable");
    expect(result.errorClass).not.toBe("unknown");
    expect(result.retryable).toBe(true);
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].errorClass).toBe("unavailable");
    // Bounded: the test env pins 4 delays → exactly 5 attempts, then stop.
    expect(attempts).toBe(5);
  });

  it("pins the Sep-18 class: unstorable content fails validation before any row exists", async () => {
    // A lone surrogate in a text file is exactly what Postgres's JSON
    // parser rejected with 22P05 after a row existed. validateArtifact
    // (unchanged by this fix round) rejects it before persistence —
    // this test pins that the fence still stands in the new flow.
    const transport = fakeTransport({
      async readFile(path: string) {
        if (path === "index.html") {
          const content = "<!doctype html><title>x</title>\uD800";
          return { content, size: content.length };
        }
        return { content: "body{}", size: 6 };
      },
    });
    const store = fakeStore();
    const result = await deployUserProject(
      { ...request(), transport },
      { store, fetchImpl: reachableFetch },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("validation");
    expect(store.rows).toHaveLength(0);
    expect(store.files.size).toBe(0);
  });
});
