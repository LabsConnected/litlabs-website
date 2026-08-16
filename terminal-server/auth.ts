import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "littree-terminal";

type TerminalTokenPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  wid?: string;
  pid?: string;
  cwd?: string;
};

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function verifyTerminalToken(token: unknown): TerminalTokenPayload {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";

  // Development mode: accept "dev-" prefixed unsigned tokens when secret is not configured
  // This allows local Desktop/TUI development without requiring full auth setup
  if (typeof token === "string" && token.startsWith("dev-")) {
    const payload = parseTokenPayload(token, "dev-");
    if (payload) return payload;
    // Fall through to error if dev token is malformed
  }

  if (secret.length < 32) throw new Error("Terminal authentication is not configured");
  if (typeof token !== "string") throw new Error("Missing terminal token");

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid terminal token");

  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = Buffer.from(sign(encodedPayload, secret), "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid terminal token");
  }

  const payload = parseTokenPayload(encodedPayload, "");
  if (!payload) throw new Error("Invalid terminal token");
  return payload;
}

/** Parse token payload from base64url encoded string, optionally stripping prefix */
function parseTokenPayload(encodedPayload: string, prefix: string): TerminalTokenPayload | null {
  let payloadStr: string;
  if (prefix && encodedPayload.startsWith(prefix)) {
    // Dev token: "dev-" + base64url(JSON)
    payloadStr = Buffer.from(encodedPayload.slice(prefix.length), "base64url").toString("utf8");
  } else {
    // Signed token: base64url(JSON) + "." + signature
    payloadStr = Buffer.from(encodedPayload, "base64url").toString("utf8");
  }
  let payload: TerminalTokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.aud !== TOKEN_AUDIENCE ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + 30 ||
    payload.exp <= now
  ) {
    return null;
  }
  return payload;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
