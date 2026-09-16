import { redirect } from "next/navigation";

/**
 * Legacy route — /u/[handle] is now the canonical public profile.
 * This file replaces the old 100% fake generated-profile page; the route
 * itself is kept so old /profile/<username> links redirect instead of 404.
 */
export default async function ProfileUsernameRedirect({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  redirect(`/u/${encodeURIComponent(username)}`);
}
