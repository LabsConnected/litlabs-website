import { auth } from "@clerk/nextjs/server";

type ClerkMetadata = { role?: string };

export async function isAdmin(): Promise<boolean> {
  const { sessionClaims } = await auth();
  const metadata = (sessionClaims?.metadata as ClerkMetadata | undefined) ?? {};
  return metadata.role === "admin";
}

export async function getRole(): Promise<string> {
  const { sessionClaims } = await auth();
  const metadata = (sessionClaims?.metadata as ClerkMetadata | undefined) ?? {};
  return metadata.role || "user";
}
