import { redirect } from "next/navigation";

/**
 * `/create` remains a compatibility entry point. Creation now lives on the
 * Dashboard so there is one prompt, one set of intents, and one state path.
 * Preserve every query parameter for old bookmarks and deep links.
 */
export default async function CreateRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  redirect(`/dashboard${suffix ? `?${suffix}` : ""}`);
}
