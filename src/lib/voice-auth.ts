import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_AUDIENCE = "litlab-voice";
const TOKEN_TTL_SECONDS = 5 * 60;

type VoiceTokenPayload = {
  sub: string;
  aud: typeof TOKEN_AUDIENCE;
  iat: number;
  exp: number;
};

function getVoiceSecret(): string {
  const secret = process.env.VOICE_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("VOICE_AUTH_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createVoiceToken(userId: string): {
  token: string;
  expiresAt: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const payload: VoiceTokenPayload = {
    sub: userId,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encodedPayload}.${sign(encodedPayload, getVoiceSecret())}`,
    expiresAt: payload.exp * 1000,
  };
}

export function verifyVoiceToken(token: string): {
  userId: string;
  issuedAt: number;
  expiresAt: number;
} {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid voice token format");
  }

  const secret = getVoiceSecret();
  const expected = sign(encodedPayload, secret);
  if (
    !signature ||
    !expected ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error("Invalid voice token signature");
  }

  let payload: VoiceTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as VoiceTokenPayload;
  } catch {
    throw new Error("Malformed voice token payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== TOKEN_AUDIENCE) {
    throw new Error("Invalid voice token audience");
  }
  if (payload.exp < now) {
    throw new Error("Voice token expired");
  }

  return {
    userId: payload.sub,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}
