import { createHmac, timingSafeEqual } from "crypto";

/**
 * Scoped capability tokens for static-preview asset requests.
 *
 * The preview document is served into a sandboxed iframe with an opaque
 * origin, so the browser cannot send the owner's session cookie with
 * subresource requests (scripts, module imports, nested pages). The
 * authenticated document response therefore mints a short-lived token bound
 * to exactly one (user, project, workspace) triple and embeds it in the
 * asset URLs it rewrites. The preview route accepts the token in place of a
 * session for those asset GETs only, and still enforces project ownership
 * and workspace binding server-side on every request.
 *
 * The signing key is DERIVED from TERMINAL_AUTH_SECRET with a fixed label,
 * so a preview token can never verify as a terminal token (or vice versa)
 * even though both token families share the same payload shape and the same
 * base secret. The audience claim is also checked on verify.
 */

const TOKEN_AUDIENCE = "littree-preview";
const TOKEN_TTL_SECONDS = 5 * 60;
const KEY_DERIVATION_LABEL = "littree-preview-token-key-v1";

export type CreatedPreviewToken = Record<"token", string> & { expiresAt: number };

type PreviewTokenPayload = {
  sub: string;
  aud: typeof TOKEN_AUDIENCE;
  iat: number;
  exp: number;
  pid: string; // projectId (required: preview tokens are always project-bound)
  wid: string; // workspaceId (required)
};

function getPreviewSigningKey(): Buffer {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("TERMINAL_AUTH_SECRET must contain at least 32 characters");
  }
  return createHmac("sha256", secret).update(KEY_DERIVATION_LABEL).digest();
}

function sign(encodedPayload: string, key: Buffer): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

export function createPreviewToken(
  userId: string,
  options: { projectId: string; workspaceId: string },
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): CreatedPreviewToken {
  const now = Math.floor(Date.now() / 1000);
  const payload: PreviewTokenPayload = {
    sub: userId,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
    pid: options.projectId,
    wid: options.workspaceId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const created = { expiresAt: payload.exp * 1000 } as CreatedPreviewToken;
  created.token = [encodedPayload, sign(encodedPayload, getPreviewSigningKey())].join(".");
  return created;
}

export function verifyPreviewToken(token: string): {
  userId: string;
  projectId: string;
  workspaceId: string;
  expiresAt: number;
} {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid preview token format");
  }

  const key = getPreviewSigningKey();
  const expected = sign(encodedPayload, key);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error("Invalid preview token signature");
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as PreviewTokenPayload;
  } catch {
    throw new Error("Malformed preview token payload");
  }

  if (payload.aud !== TOKEN_AUDIENCE) {
    throw new Error("Invalid preview token audience");
  }
  if (!payload.sub || !payload.pid || !payload.wid) {
    throw new Error("Preview token is missing its scope binding");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new Error("Preview token expired");
  }

  return {
    userId: payload.sub,
    projectId: payload.pid,
    workspaceId: payload.wid,
    expiresAt: payload.exp * 1000,
  };
}
