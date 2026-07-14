import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "littree-terminal";

type TerminalTokenPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
};

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function verifyTerminalToken(token: unknown): TerminalTokenPayload {
  const secret = process.env.TERMINAL_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("Terminal authentication is not configured");
  if (typeof token !== "string") throw new Error("Missing terminal token");

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid terminal token");

  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = sign(encodedPayload, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid terminal token");
  }

  let payload: TerminalTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid terminal token");
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
    throw new Error("Expired or invalid terminal token");
  }
  return payload;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
