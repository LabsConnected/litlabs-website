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

/**
 * Return an installation token for cloning, or null when GitHub directly
 * confirms that the repository is public.
 *
 * This keeps private repositories fail-closed when GitHub App credentials are
 * missing or invalid, while allowing public projects to use the canonical
 * workspace preparation path without embedding credentials in the clone URL.
 */
export async function getInstallationTokenForClone(input: {
  installationId: number;
  owner: string;
  repo: string;
}): Promise<string | null> {
  try {
    return await getInstallationToken(input.installationId);
  } catch (authError) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "LiTTree-Workspace-Preparer",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (response.ok) {
        const repository = (await response.json()) as { private?: unknown };
        if (repository.private === false) return null;
      }
    } catch {
      // Public verification is best-effort. Preserve the original auth error.
    }
    throw authError;
  }
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
