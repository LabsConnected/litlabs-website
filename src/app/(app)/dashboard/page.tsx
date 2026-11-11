import { redirect } from "next/navigation";

/**
 * /dashboard is retired as a page — Studio is the one prime signed-in
 * surface (ART-20261110-029). This route survives only as a server-side
 * redirect so old bookmarks, emailed links, and the legacy surfaces
 * that pointed here land in Studio instead of a duplicate home page.
 *
 * Handoffs preserved from the dashboard era:
 *   ?prompt=<text>  → /studio?prompt=<text>  (universal composer handoff;
 *                                            CommandStudio consumes it)
 *   ?app=music      → /studio?tool=music     (legacy bookmark compat)
 */
export default async function DashboardRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  if (params.app === "music") {
    query.set("tool", "music");
  }
  if (typeof params.prompt === "string" && params.prompt) {
    query.set("prompt", params.prompt);
  }

  const suffix = query.toString();
  redirect(suffix ? `/studio?${suffix}` : "/studio");
}
