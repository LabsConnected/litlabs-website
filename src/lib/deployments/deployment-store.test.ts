import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deployment-store contract tests.
 *
 * The store must read/write ONLY the V1 user-project deployment tables:
 *
 *   public.user_project_deployments
 *   public.user_project_deployment_files
 *
 * The pre-existing integration-platform table public.project_deployments
 * (created by 20260723160000_integration_platform.sql, used by the
 * dashboard/owner routes) must never be touched by this code path — it has
 * a different schema (integration_project_id, provider, environment) and a
 * different lifecycle.
 */

interface QueryCall {
  table: string;
  method: string;
  filters: Array<[string, unknown]>;
  payload: unknown;
  terminal?: string;
}

const calls: QueryCall[] = [];

// Per-test override: given the table + captured call state, return the
// PostgREST-style { data, error } resolution for that query.
let handler: (table: string, _call: QueryCall) => { data: unknown; error: unknown } = (_t, _c) => ({
  data: null,
  error: null,
});

function makeChain(table: string) {
  const call: QueryCall = { table, method: "", filters: [], payload: undefined };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = (cols?: string) => {
    if (!call.method) call.method = "select";
    call.payload = cols ?? call.payload;
    return self();
  };
  chain.insert = (p: unknown) => {
    call.method = "insert";
    call.payload = p;
    return self();
  };
  chain.update = (p: unknown) => {
    call.method = "update";
    call.payload = p;
    return self();
  };
  chain.delete = () => {
    call.method = "delete";
    return self();
  };
  chain.eq = (c: string, v: unknown) => {
    call.filters.push([c, v]);
    return self();
  };
  chain.order = () => self();
  chain.limit = () => self();
  chain.single = () => {
    call.terminal = "single";
    return self();
  };
  chain.maybeSingle = () => {
    call.terminal = "maybeSingle";
    return self();
  };
  chain.then = (resolve: (v: unknown) => void) => {
    calls.push(call);
    resolve(handler(table, call));
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
  },
}));

import {
  supabaseDeploymentStore,
  readPublishedFile,
  findLatestDeploymentForProject,
} from "./deployment-store";

const DEPLOYMENTS = "user_project_deployments";
const FILES = "user_project_deployment_files";
const INTEGRATION_TABLE = "project_deployments";

function expectOnlyV1Tables() {
  for (const call of calls) {
    expect(call.table).not.toBe(INTEGRATION_TABLE);
    expect(call.table).toMatch(/^user_project_deployment/);
  }
}

const readyRow = {
  id: "dep-1",
  user_id: "user-A",
  project_id: "proj-A",
  workspace_id: "ws-A",
  status: "ready",
  target: "litt-static",
  public_url: "https://www.litlabs.net/sites/dep-1",
  url_verified: true,
  file_count: 2,
  total_bytes: 500,
  content_hash: "sha-1",
  error_class: null,
  error_message: null,
};

beforeEach(() => {
  calls.length = 0;
  handler = () => ({ data: null, error: null });
});

describe("supabaseDeploymentStore — table targeting", () => {
  it("creates deployments in user_project_deployments only", async () => {
    handler = () => ({ data: { ...readyRow, status: "building" }, error: null });
    await supabaseDeploymentStore.create({
      userId: "user-A",
      projectId: "proj-A",
      workspaceId: "ws-A",
      status: "building",
      target: "litt-static",
      contentHash: "sha-1",
    });
    expectOnlyV1Tables();
    const insert = calls.find((c) => c.method === "insert");
    expect(insert?.table).toBe(DEPLOYMENTS);
    expect(insert?.payload).toMatchObject({
      user_id: "user-A",
      project_id: "proj-A",
      workspace_id: "ws-A",
      status: "building",
      content_hash: "sha-1",
    });
  });

  it("updates deployments in user_project_deployments only", async () => {
    handler = () => ({ data: readyRow, error: null });
    await supabaseDeploymentStore.update("dep-1", { status: "ready", publicUrl: "https://x/sites/dep-1" });
    expectOnlyV1Tables();
    const update = calls.find((c) => c.method === "update");
    expect(update?.table).toBe(DEPLOYMENTS);
    expect(update?.filters).toContainEqual(["id", "dep-1"]);
    expect(update?.payload).toMatchObject({ status: "ready", public_url: "https://x/sites/dep-1" });
  });

  it("writes files to user_project_deployment_files only", async () => {
    await supabaseDeploymentStore.putFiles("dep-1", [
      { path: "index.html", content: "<html/>", contentType: "text/html", bytes: 7 },
      { path: "assets/app.css", content: "body{}", contentType: "text/css", bytes: 6 },
    ]);
    expectOnlyV1Tables();
    const del = calls.find((c) => c.method === "delete");
    const ins = calls.find((c) => c.method === "insert");
    expect(del?.table).toBe(FILES);
    expect(del?.filters).toContainEqual(["deployment_id", "dep-1"]);
    expect(ins?.table).toBe(FILES);
    expect(ins?.payload).toHaveLength(2);
    expect((ins?.payload as Array<Record<string, unknown>>)[0]).toMatchObject({
      deployment_id: "dep-1",
      path: "index.html",
      content_type: "text/html",
    });
  });
});

describe("readPublishedFile — public serving read path", () => {
  it("serves a file only for a ready deployment", async () => {
    handler = (table) => {
      if (table === DEPLOYMENTS) return { data: readyRow, error: null };
      if (table === FILES) return { data: { content: "<h1>Ember</h1>", content_type: "text/html" }, error: null };
      return { data: null, error: null };
    };
    const file = await readPublishedFile("dep-1", "index.html");
    expect(file).toEqual({ content: "<h1>Ember</h1>", contentType: "text/html" });
    expectOnlyV1Tables();
    const fileRead = calls.find((c) => c.table === FILES);
    expect(fileRead?.filters).toContainEqual(["deployment_id", "dep-1"]);
    expect(fileRead?.filters).toContainEqual(["path", "index.html"]);
  });

  it("never reads the files table for a non-ready deployment", async () => {
    handler = (table) =>
      table === DEPLOYMENTS ? { data: { ...readyRow, status: "building" }, error: null } : { data: null, error: null };
    const file = await readPublishedFile("dep-1", "index.html");
    expect(file).toBeNull();
    // Draft/building/failed deployments must not leak artifact files.
    expect(calls.find((c) => c.table === FILES)).toBeUndefined();
  });

  it("returns null for a missing deployment", async () => {
    expect(await readPublishedFile("dep-missing", "index.html")).toBeNull();
    expect(calls.find((c) => c.table === FILES)).toBeUndefined();
  });
});

describe("findReadyByContentHash — duplicate suppression", () => {
  it("looks up ready deployments scoped to project and content hash", async () => {
    handler = () => ({ data: readyRow, error: null });
    const found = await supabaseDeploymentStore.findReadyByContentHash("proj-A", "sha-1");
    expect(found?.id).toBe("dep-1");
    const call = calls.find((c) => c.table === DEPLOYMENTS);
    expect(call?.filters).toContainEqual(["project_id", "proj-A"]);
    expect(call?.filters).toContainEqual(["content_hash", "sha-1"]);
    expect(call?.filters).toContainEqual(["status", "ready"]);
    expectOnlyV1Tables();
  });

  it("returns null when no ready deployment has the hash", async () => {
    expect(await supabaseDeploymentStore.findReadyByContentHash("proj-A", "sha-new")).toBeNull();
  });
});

describe("findLatestDeploymentForProject — ownership isolation", () => {
  it("always filters by both project_id and user_id", async () => {
    handler = () => ({ data: readyRow, error: null });
    await findLatestDeploymentForProject("proj-A", "user-A");
    const call = calls.find((c) => c.table === DEPLOYMENTS);
    expect(call?.filters).toContainEqual(["project_id", "proj-A"]);
    expect(call?.filters).toContainEqual(["user_id", "user-A"]);
    expectOnlyV1Tables();
  });

  it("returns null rather than leaking another user's deployment", async () => {
    // No row matching user-B + proj-B → null, never a cross-user record.
    expect(await findLatestDeploymentForProject("proj-B", "user-B")).toBeNull();
  });
});

describe("error propagation", () => {
  it("surfaces storage failures instead of silently succeeding", async () => {
    handler = () => ({ data: null, error: { message: "boom" } });
    await expect(
      supabaseDeploymentStore.create({
        userId: "u",
        projectId: "p",
        workspaceId: "w",
        status: "building",
        target: "litt-static",
      }),
    ).rejects.toThrow("Deployment create failed");
    // Public reads degrade to null rather than serving stale/wrong content.
    expect(await readPublishedFile("dep-1", "index.html")).toBeNull();
  });
});
