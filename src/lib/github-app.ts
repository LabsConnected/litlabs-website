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
