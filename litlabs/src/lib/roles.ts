import { auth } from "@clerk/nextjs/server";

type ClerkMetadata = { role?: string };

const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export async function isAdmin(): Promise<boolean> {
  const { sessionClaims, userId } = await auth();
  const metadata = (sessionClaims?.metadata as ClerkMetadata | undefined) ?? {};
  if (metadata.role === "admin") return true;
  if (userId && ADMIN_CLERK_IDS.includes(userId)) return true;
  return false;
}

export async function getRole(): Promise<string> {
  const admin = await isAdmin();
  if (admin) return "admin";
  const { sessionClaims } = await auth();
  const metadata = (sessionClaims?.metadata as ClerkMetadata | undefined) ?? {};
  return metadata.role || "user";
}
