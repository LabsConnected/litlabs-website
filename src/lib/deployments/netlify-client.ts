/**
 * Netlify API client for user-project publishing.
 *
 * Talks to the Netlify API (https://api.netlify.com/api/v1) with the
 * USER'S OWN personal access token — resolved server-side from the
 * credential store, passed in by the caller, never logged here.
 *
 * Deploy mechanics use the DIGEST flow, which is the proven flow in this
 * workspace's history:
 *   1. POST /sites/{siteId}/deploys with { files: { "/path": sha1hex } }
 *      — the digest map MUST be nested under the "files" key; a flat
 *      top-level map is silently ignored and the deploy sticks forever.
 *   2. The response's `required` array lists the sha1 digests Netlify
 *      still needs; upload ONLY those files
 *      (PUT /deploys/{deployId}/files/{path}, raw bytes).
 *   3. Poll GET /deploys/{deployId} until state "ready" or "error".
 * The older zip-upload flow mis-files single-file sites and is not used.
 *
 * Every call goes through an injectable fetch so tests exercise this
 * client against a mock — no live calls happen in tests, and no real
 * token is ever present in this module.
 */

import { createHash } from "node:crypto";

import type { ArtifactFile } from "./user-deployment";

export const NETLIFY_API_BASE = "https://api.netlify.com/api/v1";

/** An error from the Netlify API, carrying its HTTP status + message. */
export class NetlifyApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NetlifyApiError";
    this.status = status;
  }
}

export interface NetlifyUser {
  id: string;
  fullName: string | null;
  email: string | null;
  slug: string | null;
}

export interface NetlifySite {
  id: string;
  name: string;
  url: string | null;
  sslUrl: string | null;
}

export interface NetlifyDeploy {
  id: string;
  state: string;
  required: string[];
  sslUrl: string | null;
  deploySslUrl: string | null;
  errorMessage: string | null;
}

export interface NetlifyClient {
  getCurrentUser(): Promise<NetlifyUser>;
  findSiteByName(name: string): Promise<NetlifySite | null>;
  createSite(name: string): Promise<NetlifySite>;
  createDeploy(siteId: string, filesMap: Record<string, string>): Promise<NetlifyDeploy>;
  uploadDeployFile(deployId: string, path: string, bytes: Buffer): Promise<void>;
  getDeploy(deployId: string): Promise<NetlifyDeploy>;
}

interface NetlifyClientDeps {
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

function siteFromJson(json: Record<string, unknown>): NetlifySite {
  return {
    id: String(json.id ?? ""),
    name: String(json.name ?? ""),
    url: typeof json.url === "string" ? json.url : null,
    sslUrl: typeof json.ssl_url === "string" ? json.ssl_url : null,
  };
}

function deployFromJson(json: Record<string, unknown>): NetlifyDeploy {
  return {
    id: String(json.id ?? ""),
    state: String(json.state ?? ""),
    required: Array.isArray(json.required)
      ? json.required.filter((v): v is string => typeof v === "string")
      : [],
    sslUrl: typeof json.ssl_url === "string" ? json.ssl_url : null,
    deploySslUrl:
      typeof json.deploy_ssl_url === "string" ? json.deploy_ssl_url : null,
    errorMessage:
      typeof json.error_message === "string" ? json.error_message : null,
  };
}

export function createNetlifyClient(deps: NetlifyClientDeps): NetlifyClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBase = (deps.apiBase ?? NETLIFY_API_BASE).replace(/\/+$/, "");

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${deps.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new NetlifyApiError(
        0,
        `Netlify request failed: ${err instanceof Error ? err.message : "network error"}`,
      );
    }
    const text = await response.text().catch(() => "");
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          json = parsed as Record<string, unknown>;
        } else if (Array.isArray(parsed)) {
          json = { items: parsed };
        }
      } catch {
        // Non-JSON body — the status-based error below still applies.
      }
    }
    if (!response.ok) {
      const message =
        (typeof json.message === "string" && json.message) ||
        (typeof json.error === "string" && json.error) ||
        `Netlify API returned HTTP ${response.status}`;
      throw new NetlifyApiError(response.status, message);
    }
    return json;
  }

  return {
    async getCurrentUser() {
      const json = await request("GET", "/user");
      return {
        id: String(json.id ?? ""),
        fullName: typeof json.full_name === "string" ? json.full_name : null,
        email: typeof json.email === "string" ? json.email : null,
        slug: typeof json.slug === "string" ? json.slug : null,
      };
    },

    async findSiteByName(name) {
      const json = await request(
        "GET",
        `/sites?name=${encodeURIComponent(name)}`,
      );
      const items = Array.isArray(json.items) ? json.items : [];
      for (const item of items) {
        if (item && typeof item === "object") {
          const site = siteFromJson(item as Record<string, unknown>);
          if (site.name === name) return site;
        }
      }
      return null;
    },

    async createSite(name) {
      const json = await request("POST", "/sites", { name });
      return siteFromJson(json);
    },

    async createDeploy(siteId, filesMap) {
      // The digest map is nested under "files" — see the module header.
      const json = await request(
        "POST",
        `/sites/${encodeURIComponent(siteId)}/deploys`,
        { files: filesMap },
      );
      return deployFromJson(json);
    },

    async uploadDeployFile(deployId, path, bytes) {
      const encodedPath = path
        .replace(/^\/+/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      let response: Response;
      try {
        response = await fetchImpl(
          `${apiBase}/deploys/${encodeURIComponent(deployId)}/files/${encodedPath}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${deps.token}`,
              "Content-Type": "application/octet-stream",
            },
            body: new Uint8Array(bytes),
          },
        );
      } catch (err) {
        throw new NetlifyApiError(
          0,
          `Netlify upload failed: ${err instanceof Error ? err.message : "network error"}`,
        );
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = `Netlify API returned HTTP ${response.status}`;
        try {
          const parsed: unknown = JSON.parse(text);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as { message?: unknown }).message === "string"
          ) {
            message = (parsed as { message: string }).message;
          }
        } catch {
          // Keep the status-based message.
        }
        throw new NetlifyApiError(response.status, message);
      }
    },

    async getDeploy(deployId) {
      const json = await request(
        "GET",
        `/deploys/${encodeURIComponent(deployId)}`,
      );
      return deployFromJson(json);
    },
  };
}

/** Raw bytes of an artifact file (binary files are base64 in the artifact). */
export function artifactFileBytes(file: ArtifactFile): Buffer {
  return file.encoding === "base64"
    ? Buffer.from(file.content, "base64")
    : Buffer.from(file.content, "utf-8");
}

/** sha1 hex digest — the digest Netlify's deploy flow keys files by. */
export function sha1Hex(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Build the digest map for a Netlify deploy: { "/path": sha1hex }.
 * The caller nests this under the "files" key of the create-deploy body
 * (createNetlifyClient.createDeploy does exactly that).
 */
export function buildNetlifyFilesMap(
  files: ArtifactFile[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of files) {
    const path = file.path.startsWith("/") ? file.path : `/${file.path}`;
    map[path] = sha1Hex(artifactFileBytes(file));
  }
  return map;
}

/**
 * Deterministic Netlify site name for a project:
 *   litt-<slug>-<first 8 hex of sha256(projectId)>
 * The projectId hash makes the name unique per project (so two "My Site"
 * projects don't collide) and stable across deploys (so a re-deploy finds
 * the same site by name). Bounded to Netlify's subdomain limits.
 */
export function deriveNetlifySiteName(
  projectName: string | null | undefined,
  projectId: string,
  hashLength = 8,
): string {
  const slug =
    (projectName ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30)
      .replace(/-+$/g, "") || "site";
  const hash = createHash("sha256")
    .update(projectId)
    .digest("hex")
    .slice(0, Math.max(4, hashLength));
  return `litt-${slug}-${hash}`;
}

/**
 * Resolve the project's Netlify site, creating it when absent.
 *
 * Collision handling: the deterministic name is looked up first (a hit is
 * OUR site in the user's account — reuse it). On create, a 422 means the
 * name is taken; if a re-lookup still finds nothing in this account, the
 * name belongs to someone else, so retry with a longer hash suffix
 * (12, then 20) before giving up — the name stays deterministic per
 * (project, attempt), so concurrent deploys converge instead of
 * multiplying sites.
 */
export async function resolveOrCreateSite(
  client: NetlifyClient,
  projectName: string | null | undefined,
  projectId: string,
): Promise<NetlifySite> {
  for (const hashLength of [8, 12, 20]) {
    const name = deriveNetlifySiteName(projectName, projectId, hashLength);
    const existing = await client.findSiteByName(name);
    if (existing) return existing;
    try {
      return await client.createSite(name);
    } catch (err) {
      if (err instanceof NetlifyApiError && err.status === 422) {
        // Name taken — possibly by a concurrent create in this account.
        const after = await client.findSiteByName(name);
        if (after) return after;
        continue; // Someone else's name — lengthen the suffix and retry.
      }
      throw err;
    }
  }
  throw new NetlifyApiError(
    422,
    "Could not allocate a unique Netlify site name for this project.",
  );
}
