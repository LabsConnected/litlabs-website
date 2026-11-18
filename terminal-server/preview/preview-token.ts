/**
 * Per-workspace signed preview tokens — terminal-side verifier.
 *
 * This is the terminal service's mirror of the web side's
 * `src/lib/projects/preview-token.ts` (seam S7: the two deployables
 * do not import from each other, and the formats MUST stay in sync).
 * The web app mints these tokens; this module only verifies them for
 * the dev-server preview proxy (preview/proxy.ts via preview-auth.ts).
 *
 * Why: the proxy historically authenticated with ONE static
 * PREVIEW_ACCESS_TOKEN shared by every workspace, and workspace ids
 * are predictable (`ws-<projectId>`) — anyone holding one preview
 * URL could request another project's running preview (design note
 * §3.5). A signed token binds the capability to exactly one
 * workspace (and one user + project), and expires in minutes.
 *
 * Format (identical to the web minter):
 *   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 *   key   = HMAC-SHA256(key = TERMINAL_AUTH_SECRET,
 *                       msg = "littree-preview-token-key-v1")
 *   payload = { sub, aud: "littree-preview", iat, exp, pid, wid, ast }
 *
 * Enforcement profile for the PROXY (differs from the static asset
 * route on purpose): signature, audience, expiry, scope binding, and
 * `wid === the workspace being proxied` are enforced. The `ast`
 * asset manifest is NOT enforced here — a dev server serves
 * arbitrary paths by design; the manifest is the static route's
 * control, and the proxy's control is the workspace binding itself.
 */

import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "littree-preview";
const KEY_DERIVATION_LABEL = "littree-preview-token-key-v1";

interface WorkspacePreviewTokenPayload {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  pid: string;
  wid: string;
  ast?: unknown;
}

function getPreviewSigningKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_DERIVATION_LABEL).digest();
}

/**
 * True when the signed-token channel is configured on this process:
 * TERMINAL_AUTH_SECRET present and at least 32 characters (the web
 * minter refuses to mint below that, so verification below it could
 * never succeed anyway).
 */
export function isWorkspacePreviewTokenConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.TERMINAL_AUTH_SECRET ?? "").length >= 32;
}

/**
 * Verify a signed preview token for exactly one workspace.
 * Returns the bound identity on success, null on ANY failure —
 * callers must not distinguish failure modes (no oracle).
 */
export function verifyWorkspacePreviewToken(
  token: string,
  workspaceId: string,
  env: Record<string, string | undefined> = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { userId: string; projectId: string; workspaceId: string } | null {
  if (!isWorkspacePreviewTokenConfigured(env)) return null;
  if (!workspaceId) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const key = getPreviewSigningKey(env.TERMINAL_AUTH_SECRET as string);
  const expected = createHmac("sha256", key).update(encodedPayload).digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  let payload: WorkspacePreviewTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as WorkspacePreviewTokenPayload;
  } catch {
    return null;
  }

  if (payload.aud !== TOKEN_AUDIENCE) return null;
  if (!payload.sub || !payload.pid || !payload.wid) return null;
  // The capability is bound to ONE workspace: the one being proxied.
  if (payload.wid !== workspaceId) return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;

  return { userId: payload.sub, projectId: payload.pid, workspaceId: payload.wid };
}

/**
 * Mint a token in the web minter's format. The terminal never mints
 * for production traffic (the web app does); this exists so tests can
 * prove cross-implementation compatibility with the real format, and
 * so the canary/diagnostics can exercise the verify path end to end.
 */
export function createWorkspacePreviewToken(
  input: { userId: string; projectId: string; workspaceId: string },
  env: Record<string, string | undefined> = process.env,
  ttlSeconds: number = 5 * 60,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const secret = env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("TERMINAL_AUTH_SECRET must contain at least 32 characters");
  }
  const payload = {
    sub: input.userId,
    aud: TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    pid: input.projectId,
    wid: input.workspaceId,
    ast: [] as string[],
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getPreviewSigningKey(secret))
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}
