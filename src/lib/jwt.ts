import { SignJWT, jwtVerify } from "jose";

function getSecret() {
  const raw =
    process.env.AUTH_SECRET ||
    "dev-auth-secret-for-litlabs-studio-local-testing";
  return new TextEncoder().encode(raw);
}

export async function signToken(payload: Record<string, unknown>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}
