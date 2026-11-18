import { describe, it, expect, vi } from "vitest";

/**
 * Netlify deploy service — behavioural tests.
 *
 * Mirrors deploy-service.test.ts's fakes. Proves: the connect-first
 * refusal creates nothing; a successful deploy records the Netlify
 * target, site id and verified URL; Netlify's own failure message is
 * what lands on the record; duplicate suppression never crosses targets;
 * and `ready` is never claimed when the live URL does not answer.
 * The Netlify client is a fake — no live calls, no real token.
 */

import {
  deployProjectToNetlify,
  type NetlifyDeployDeps,
} from "./netlify-deploy-service";
import {
  collectStaticArtifact,
  hashArtifact,
  type DeploymentStore,
  type DeploymentRecord,
  type DeploySourceTransport,
} from "./deploy-service";
import { validateArtifact } from "./user-deployment";
import { sha1Hex, artifactFileBytes, NetlifyApiError, type NetlifyClient } from "./netlify-client";

const INDEX = "<!doctype html><title>Ember Roast</title><h1>Ember Roast</h1>";
const CSS = "body{background:#1a1a1a}";

function fakeTransport(over: Partial<DeploySourceTransport> = {}): DeploySourceTransport {
  const tree: Record<string, string> = { "index.html": INDEX, "styles.css": CSS };
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

function fakeStore(): DeploymentStore & { rows: DeploymentRecord[] } {
  const rows: DeploymentRecord[] = [];
  let seq = 0;
  return {
    rows,
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
        externalSiteId: input.externalSiteId ?? null,
      };
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no such deployment: ${id}`);
      Object.assign(row, patch);
      return row;
    },
    async putFiles() {
      throw new Error("Netlify deploys must not store a snapshot");
    },
  };
}

const SITE = {
  id: "site_ember",
  name: "litt-ember-roast-abcd1234",
  url: "http://litt-ember-roast-abcd1234.netlify.app",
  sslUrl: "https://litt-ember-roast-abcd1234.netlify.app",
};

function fakeClient(over: Partial<NetlifyClient> = {}): NetlifyClient {
  return {
    getCurrentUser: vi.fn(async () => ({ id: "u1", fullName: "Larry", email: null, slug: "larry" })),
    findSiteByName: vi.fn(async () => SITE),
    createSite: vi.fn(async () => SITE),
    createDeploy: vi.fn(async () => ({
      id: "ndeploy_1",
      state: "preparing",
      required: [sha1Hex(artifactFileBytes({ path: "styles.css", content: CSS }))],
      sslUrl: SITE.sslUrl,
      deploySslUrl: "https://ndeploy_1--litt-ember-roast-abcd1234.netlify.app",
      errorMessage: null,
    })),
    uploadDeployFile: vi.fn(async () => {}),
    getDeploy: vi.fn(async () => ({
      id: "ndeploy_1",
      state: "ready",
      required: [],
      sslUrl: SITE.sslUrl,
      deploySslUrl: "https://ndeploy_1--litt-ember-roast-abcd1234.netlify.app",
      errorMessage: null,
    })),
    ...over,
  };
}

type FakeDeps = NetlifyDeployDeps & {
  store: ReturnType<typeof fakeStore>;
  client: NetlifyClient;
};

function fakeDeps(over: Partial<NetlifyDeployDeps> = {}): FakeDeps {
  const store = fakeStore();
  const client = fakeClient();
  const deps: NetlifyDeployDeps = {
    store,
    getToken: async () => ({ token: "test-token" }),
    createClient: () => client,
    fetchImpl: (async () => new Response("ok", { status: 200 })) as typeof fetch,
    sleep: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 5_000,
    ...over,
  };
  return Object.assign(deps, { store, client });
}

const request = (transport = fakeTransport()) => ({
  userId: "user_owner",
  projectId: "proj_ember",
  transport,
  projectName: "Ember Roast",
});

describe("deployProjectToNetlify", () => {
  it("fails honestly with a connect-first state when Netlify is not connected — and creates nothing", async () => {
    const deps = fakeDeps({ getToken: async () => null });
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe("needs_connection");
      expect(result.message).toContain("Settings → Connections");
      expect(result.deploymentId).toBeNull();
    }
    expect(deps.store.rows).toHaveLength(0);
    expect(deps.client.createDeploy).not.toHaveBeenCalled();
  });

  it("deploys via the digest flow and records target, site id and the verified Netlify URL", async () => {
    const deps = fakeDeps();
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toBe("netlify");
      expect(result.publicUrl).toBe(SITE.sslUrl);
      expect(result.urlVerified).toBe(true);
      expect(result.fileCount).toBe(2);
    }
    // Only the file Netlify marked required was uploaded.
    expect(deps.client.uploadDeployFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.client.uploadDeployFile).mock.calls[0][1]).toBe("/styles.css");
    const row = deps.store.rows[0];
    expect(row.target).toBe("netlify");
    expect(row.externalSiteId).toBe(SITE.id);
    expect(row.status).toBe("ready");
    expect(row.urlVerified).toBe(true);
    expect(row.publicUrl).toBe(SITE.sslUrl);
  });

  it("propagates Netlify's own error message onto the failed record", async () => {
    const client = fakeClient({
      getDeploy: vi.fn(async () => ({
        id: "ndeploy_1",
        state: "error",
        required: [],
        sslUrl: null,
        deploySslUrl: null,
        errorMessage: "Your site failed to build: bad redirect rule",
      })),
    });
    const deps = fakeDeps({ createClient: () => client });
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("bad redirect rule");
    }
    const row = deps.store.rows[0];
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toContain("bad redirect rule");
    expect(row.publicUrl).toBeNull();
  });

  it("maps a Netlify 401 to an authorization failure naming the reconnect step", async () => {
    const client = fakeClient({
      createDeploy: vi.fn(async () => {
        throw new NetlifyApiError(401, "Unauthorized");
      }),
    });
    const deps = fakeDeps({ createClient: () => client });
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe("authorization");
      expect(result.message).toContain("Reconnect Netlify");
    }
    expect(deps.store.rows[0].status).toBe("failed");
  });

  it("never reuses a ready LiTT deployment of identical content for a Netlify deploy", async () => {
    const deps = fakeDeps();
    // Seed a ready, verified LiTT row with the artifact's real content hash.
    const artifact = await collectStaticArtifact(fakeTransport());
    const validation = validateArtifact(artifact);
    if (!validation.ok) throw new Error("fixture artifact must validate");
    deps.store.rows.push({
      id: "dep_litt",
      userId: "user_owner",
      projectId: "proj_ember",
      workspaceId: "ws_ember",
      status: "ready",
      target: "litt-static",
      publicUrl: "https://example.invalid/sites/dep_litt/",
      urlVerified: true,
      fileCount: 2,
      totalBytes: 10,
      contentHash: hashArtifact(validation.files),
      errorClass: null,
      errorMessage: null,
      externalSiteId: null,
    });
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reused).toBe(false);
    expect(deps.client.createDeploy).toHaveBeenCalledTimes(1);
    expect(deps.store.rows.filter((r) => r.target === "netlify")).toHaveLength(1);
  });

  it("reuses its own ready Netlify deployment of identical content", async () => {
    const deps = fakeDeps();
    const first = await deployProjectToNetlify(request(), deps);
    expect(first.ok).toBe(true);
    const second = await deployProjectToNetlify(request(), deps);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.reused).toBe(true);
    expect(deps.client.createDeploy).toHaveBeenCalledTimes(1);
  });

  it("does not claim ready when the live URL does not answer", async () => {
    const deps = fakeDeps({
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
      verifyAttempts: 2,
    });
    const result = await deployProjectToNetlify(request(), deps);
    expect(result.ok).toBe(false);
    const row = deps.store.rows[0];
    expect(row.status).toBe("failed");
    expect(row.urlVerified).toBe(false);
  });

  it("refuses a transport that does not belong to the caller", async () => {
    const deps = fakeDeps();
    const result = await deployProjectToNetlify(
      request(fakeTransport({ userId: "user_someone_else" })),
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorClass).toBe("authorization");
    expect(deps.store.rows).toHaveLength(0);
  });
});
