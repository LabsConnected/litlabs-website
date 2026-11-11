import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * Netlify client — the digest flow is the contract under test:
 * the digest map MUST nest under "files", only `required` digests get
 * uploaded, and site naming is deterministic per project with bounded
 * collision handling. All HTTP is mocked — no live calls, no real token.
 */

import {
  createNetlifyClient,
  buildNetlifyFilesMap,
  deriveNetlifySiteName,
  resolveOrCreateSite,
  NetlifyApiError,
  type NetlifyClient,
} from "./netlify-client";
import type { ArtifactFile } from "./user-deployment";

const sha1 = (data: Buffer | string) =>
  createHash("sha1").update(data).digest("hex");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildNetlifyFilesMap", () => {
  it("maps slash-prefixed paths to sha1 digests of the file bytes", () => {
    const files: ArtifactFile[] = [
      { path: "index.html", content: "<h1>Ember Roast</h1>" },
      { path: "assets/app.js", content: "console.log(1)" },
    ];
    const map = buildNetlifyFilesMap(files);
    expect(map).toEqual({
      "/index.html": sha1("<h1>Ember Roast</h1>"),
      "/assets/app.js": sha1("console.log(1)"),
    });
  });

  it("digests binary files by their decoded bytes, not the base64 text", () => {
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const files: ArtifactFile[] = [
      { path: "logo.png", content: raw.toString("base64"), encoding: "base64" },
    ];
    expect(buildNetlifyFilesMap(files)["/logo.png"]).toBe(sha1(raw));
  });
});

describe("createDeploy request shape", () => {
  it("nests the digest map under the \"files\" key — never flat", async () => {
    let capturedBody: unknown = null;
    let capturedUrl = "";
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ id: "dep_1", state: "preparing", required: [] });
    });
    const client = createNetlifyClient({
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const filesMap = { "/index.html": sha1("x") };
    await client.createDeploy("site_1", filesMap);
    expect(capturedUrl).toContain("/sites/site_1/deploys");
    // The whole body is exactly { files: {...} } — a flat {"/index.html": …}
    // body is the known silently-ignored failure mode.
    expect(capturedBody).toEqual({ files: filesMap });
  });

  it("sends the bearer token and surfaces Netlify's error message", async () => {
    let authHeader: string | null = null;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ message: "Token expired or revoked" }, 401);
    });
    const client = createNetlifyClient({
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getCurrentUser()).rejects.toMatchObject({
      name: "NetlifyApiError",
      status: 401,
      message: "Token expired or revoked",
    });
    expect(authHeader).toBe("Bearer test-token");
  });
});

describe("deriveNetlifySiteName", () => {
  it("is deterministic per project and slugifies the project name", () => {
    const a = deriveNetlifySiteName("LiTT Food Court!", "proj-123");
    const b = deriveNetlifySiteName("LiTT Food Court!", "proj-123");
    expect(a).toBe(b);
    expect(a).toMatch(/^litt-litt-food-court-[0-9a-f]{8}$/);
  });

  it("separates same-named projects by their id hash", () => {
    expect(deriveNetlifySiteName("My Site", "proj-a")).not.toBe(
      deriveNetlifySiteName("My Site", "proj-b"),
    );
  });

  it("falls back to a safe slug for unusable names and stays within limits", () => {
    const name = deriveNetlifySiteName("!!!", "proj-x");
    expect(name).toMatch(/^litt-site-[0-9a-f]{8}$/);
    const long = deriveNetlifySiteName("a".repeat(200), "proj-x");
    expect(long.length).toBeLessThanOrEqual(63);
  });
});

describe("resolveOrCreateSite", () => {
  function fakeClient(over: Partial<NetlifyClient>): NetlifyClient {
    return {
      getCurrentUser: vi.fn(),
      findSiteByName: vi.fn(async () => null),
      createSite: vi.fn(async (name: string) => ({
        id: "site_new",
        name,
        url: `http://${name}.netlify.app`,
        sslUrl: `https://${name}.netlify.app`,
      })),
      createDeploy: vi.fn(),
      uploadDeployFile: vi.fn(),
      getDeploy: vi.fn(),
      ...over,
    };
  }

  it("reuses the site when the deterministic name already exists in the account", async () => {
    const existing = { id: "site_1", name: "litt-x", url: null, sslUrl: "https://x.netlify.app" };
    const client = fakeClient({
      findSiteByName: vi.fn(async () => existing),
    });
    const site = await resolveOrCreateSite(client, "X", "proj-1");
    expect(site.id).toBe("site_1");
    expect(client.createSite).not.toHaveBeenCalled();
  });

  it("creates the site when the name is free", async () => {
    const client = fakeClient({});
    const site = await resolveOrCreateSite(client, "Ember Roast", "proj-2");
    expect(site.id).toBe("site_new");
    expect(client.createSite).toHaveBeenCalledTimes(1);
  });

  it("on a 422 name collision with no account match, retries with a longer suffix", async () => {
    const names: string[] = [];
    const client = fakeClient({
      createSite: vi.fn(async (name: string) => {
        names.push(name);
        if (names.length === 1) throw new NetlifyApiError(422, "name is taken");
        return { id: "site_retry", name, url: null, sslUrl: null };
      }),
    });
    const site = await resolveOrCreateSite(client, "Ember Roast", "proj-3");
    expect(site.id).toBe("site_retry");
    expect(names).toHaveLength(2);
    // Second attempt keeps the slug but lengthens the hash suffix.
    expect(names[1].startsWith(names[0].slice(0, -8))).toBe(true);
    expect(names[1].length).toBeGreaterThan(names[0].length);
  });

  it("adopts the site when a 422 was a concurrent create in the same account", async () => {
    const raced = { id: "site_raced", name: "litt-x", url: null, sslUrl: null };
    let lookups = 0;
    const client = fakeClient({
      findSiteByName: vi.fn(async () => (++lookups >= 2 ? raced : null)),
      createSite: vi.fn(async () => {
        throw new NetlifyApiError(422, "name is taken");
      }),
    });
    const site = await resolveOrCreateSite(client, "X", "proj-4");
    expect(site.id).toBe("site_raced");
  });
});
