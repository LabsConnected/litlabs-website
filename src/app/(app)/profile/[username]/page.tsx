export const dynamic = "force-dynamic";

import { permanentRedirect } from "next/navigation";

// Legacy route — superseded by the canonical public profiles at /u/[handle]
// (social-mission Phase 2). The proxy issues the 308 redirect before auth so
// signed-out visitors land on the public profile too; this page-level
// redirect is defense in depth in case the proxy rule is ever bypassed.
export default async function LegacyProfileRedirectPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const handle = Array.isArray(username) ? username[0] : username;
  permanentRedirect(`/u/${encodeURIComponent(handle)}`);
}
