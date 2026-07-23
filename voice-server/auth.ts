import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "litlab-voice";

type VoiceTokenPayload = {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
};

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function verifyVoiceToken(token: unknown): VoiceTokenPayload {
  const secret = process.env.VOICE_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("Voice authentication is not configured");
  if (typeof token !== "string") throw new Error("Missing voice token");

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid voice token");

  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = sign(encodedPayload, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid voice token");
  }

  let payload: VoiceTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid voice token");
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
    throw new Error("Expired or invalid voice token");
  }
  return payload;
}
