import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { apiFetch, type ProfileDTO } from "@/lib/social-server";
import ProfileClient from "./ProfileClient";

async function getProfile(handle: string): Promise<ProfileDTO | null> {
  let res: Response;
  try {
    res = await apiFetch(
      `/api/users/by-username/${encodeURIComponent(handle)}`,
    );
  } catch {
    throw new Error("Could not reach the profile service. Please try again.");
  }
  // 401/403 are treated as not found so we never leak whether a
  // handle exists to an unauthorized viewer.
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Profile service returned ${res.status}. Please try again.`,
    );
  }
  const data = (await res.json().catch(() => null)) as
    | { profile?: ProfileDTO; user?: ProfileDTO }
    | ProfileDTO
    | null;
  // Accept the contract shape ({id, username, ...}) directly, or a
  // {profile}/{user} wrapper, without inventing any fields.
  const p =
    (data as { profile?: ProfileDTO } | null)?.profile ??
    (data as { user?: ProfileDTO } | null)?.user ??
    (data as ProfileDTO | null);
  if (!p || typeof p.id !== "string" || typeof p.username !== "string") {
    return null;
  }
  return p;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getProfile(handle).catch(() => null);
  if (!profile) {
    return { title: "Profile not found | LiTTree" };
  }
  const name = profile.displayName || `@${profile.username}`;
  return {
    title: `${name} (@${profile.username}) | LiTTree`,
    description: profile.bio ?? `${name} on LiTTree`,
  };
}

export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { handle } = await params;
  const { tab } = await searchParams;
  const profile = await getProfile(handle);
  if (!profile) notFound();
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28">
      <ProfileClient
        profile={profile}
        handle={handle}
        initialTab={tab === "about" ? "about" : "posts"}
      />
    </div>
  );
}
