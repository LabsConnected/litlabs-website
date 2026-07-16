import { redirect } from "next/navigation";

type SearchParams = { [key: string]: string | string[] | undefined };

function buildStudioUrl(searchParams: SearchParams, tool: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tool") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, value);
    }
  }
  params.set("tool", tool);
  const query = params.toString();
  return `/studio${query ? `?${query}` : ""}`;
}

export default async function LittRedirectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  redirect(buildStudioUrl(resolved, "chat"));
}
