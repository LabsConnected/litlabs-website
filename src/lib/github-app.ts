/**
 * GitHub App helpers for LiTT.
 *
 * Required env vars:
 *   GITHUB_APP_ID
 *   GITHUB_PRIVATE_KEY (PEM string, can use \n newlines)
 *   GITHUB_WEBHOOK_SECRET
 *
 * Docs:
 *   https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
 */

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createHmac, timingSafeEqual } from "crypto";

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n");

export function getAppAuth() {
  if (!appId || !privateKey) {
    throw new Error(
      "GitHub App credentials are missing. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY.",
    );
  }
  return createAppAuth({ appId, privateKey });
}

export async function getInstallationToken(installationId: number) {
  const auth = getAppAuth();
  const { token } = await auth({ type: "installation", installationId });
  return token;
}

interface GithubRepoMetadata {
  id?: number;
  private?: boolean;
}

function repoMetadataUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function parseRepoMetadata(repository: { id?: unknown; private?: unknown }): GithubRepoMetadata {
  return {
    id: typeof repository.id === "number" ? repository.id : undefined,
    private: typeof repository.private === "boolean" ? repository.private : undefined,
  };
}

/**
 * Resolve a repository's numeric id and visibility for the clone path.
 *
 * The app-authenticated lookup runs first: an app JWT can read metadata
 * for private repositories the app is installed on, which is exactly
 * where scoping matters. The unauthenticated lookup follows — it can
 * only ever see public repositories, but it is also the public-repo
 * confirmation the historical flow relied on. Never throws: every
 * failure simply yields no metadata, and the caller fails closed.
 */
async function resolveCloneRepoMetadata(input: {
  owner: string;
  repo: string;
}): Promise<GithubRepoMetadata | null> {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "LiTTree-Workspace-Preparer",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const auth = getAppAuth();
    const { token } = await auth({ type: "app" });
    const response = await fetch(repoMetadataUrl(input.owner, input.repo), {
      headers: { ...headers, Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return parseRepoMetadata((await response.json()) as { id?: unknown; private?: unknown });
    }
  } catch {
    // App credentials missing/invalid or the lookup failed — the
    // unauthenticated lookup below may still prove the repo public.
  }
  try {
    const response = await fetch(repoMetadataUrl(input.owner, input.repo), { headers });
    if (response.ok) {
      return parseRepoMetadata((await response.json()) as { id?: unknown; private?: unknown });
    }
  } catch {
    // Public verification is best-effort.
  }
  return null;
}

/**
 * Return a SCOPED installation token for cloning, or null when GitHub
 * directly confirms that the repository is public.
 *
 * Phase 2 build-list fix #1: the clone token is the one credential that
 * may be handed to a sandbox (per command, via a credential helper —
 * never in a URL), so it is minted for exactly one repository with
 * read-only contents permission. The unscoped getInstallationToken
 * above stays for its other consumers; the clone path never uses it.
 *
 * Fail-closed, as before: private repositories throw when GitHub App
 * credentials are missing or invalid, while public projects may use
 * the canonical workspace preparation path without embedding
 * credentials in the clone URL.
 */
export async function getInstallationTokenForClone(input: {
  installationId: number;
  owner: string;
  repo: string;
}): Promise<string | null> {
  const metadata = await resolveCloneRepoMetadata(input);

  if (metadata && typeof metadata.id === "number") {
    try {
      const auth = getAppAuth();
      const { token } = await auth({
        type: "installation",
        installationId: input.installationId,
        repositoryIds: [metadata.id],
        permissions: { contents: "read" },
      });
      return token;
    } catch (authError) {
      // A public repository needs no credential at all; a private one
      // keeps the historical fail-closed error.
      if (metadata.private === false) return null;
      throw authError;
    }
  }

  if (metadata?.private === false) return null;

  // No repository id could be resolved, so no scoped token can be
  // minted — and an unscoped token must never take the clone path.
  // Reproduce the historical failure surface for missing/invalid app
  // credentials (this throws the same error the old flow threw); when
  // the credentials are valid but metadata is unreachable, refuse
  // explicitly instead of silently widening the token.
  const auth = getAppAuth();
  await auth({ type: "app" });
  throw new Error(
    `Could not resolve GitHub repository ${input.owner}/${input.repo} to scope the clone token; refusing to mint an unscoped token for cloning.`,
  );
}

export async function getInstallationOctokit(installationId: number) {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token });
}

export async function getAppOctokit() {
  const auth = getAppAuth();
  const { token } = await auth({ type: "app" });
  return new Octokit({ auth: token });
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret = process.env.GITHUB_WEBHOOK_SECRET,
): boolean {
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not set");
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  const expected = "sha256=" + hmac.digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}
