import { headers } from "next/headers";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteConfig";

// --- Types ---

type CatalogItem = {
  id: string;
  name: string;
  description: string;
};

// --- Data ---

/**
 * Public catalog fetch, typed per the public-route recovery spec.
 * Returns the live catalog when the API responds, [] when the API
 * responds without items (or non-OK — the catalog is empty today),
 * and null only when the fetch itself throws (network/parse failure).
 */
async function getCatalogItems(): Promise<CatalogItem[] | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const forwardedProto = h.get("x-forwarded-proto");
    // Local dev serves plain http; production is always behind the
    // proxy with x-forwarded-proto set.
    const proto =
      forwardedProto ??
      (host && /^(localhost|127\.|0\.0\.0\.0)/.test(host) ? "http" : "https");
    const base = host ? `${proto}://${host}` : SITE_URL;
    const res = await fetch(`${base}/api/marketplace/items`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { items?: unknown };
    if (!Array.isArray(data.items)) {
      return [];
    }
    return data.items.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? "Untitled"),
        description: String(item.description ?? ""),
      };
    });
  } catch {
    return null;
  }
}

// --- Page ---

/**
 * Public marketplace page — a server component on purpose.
 *
 * The catalog must be in the initial HTML: no Clerk/auth initialization,
 * no client-side loading shell ("Loading marketplace..." never renders).
 * Empty and failure states render server-side too, so crawlers, curl,
 * and JS-disabled browsers all see the real content.
 */
export default async function MarketplacePage() {
  const items = await getCatalogItems();

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[#070812] text-white"
    >
      {/* === HEADER === */}
      <div className="border-b border-white/10 bg-gradient-to-b from-white/[.03] to-transparent px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              Marketplace
            </h1>
            <span className="rounded-full bg-lime-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-lime-300">
              Beta
            </span>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">
            Give LiTT new abilities. Agents, skills, and workflows you can
            install to extend what your AI project operator can do.
          </p>
        </div>
      </div>

      {/* === BODY === */}
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {items === null ? (
          <div className="py-12 text-center">
            <p className="text-white/60">
              The marketplace couldn&apos;t load right now.
            </p>
            <p className="mt-2 text-sm text-white/40">
              Please try again in a moment.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto max-w-md">
              <div className="mb-4 text-4xl" aria-hidden="true">
                ⚡
              </div>
              <h2 className="text-xl font-black tracking-tight">
                Coming soon
              </h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/55">
                The first agents and workflows are being added now. Contact
                us for early marketplace access.
              </p>
              <Link
                href="/capabilities"
                className="mt-6 inline-block rounded-xl border border-white/15 px-5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/5"
              >
                See what LiTT can do
              </Link>
            </div>
          </div>
        ) : (
          <section aria-label="Marketplace catalog">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <h2 className="text-[15px] font-black tracking-tight">
                    {item.name}
                  </h2>
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-white/55">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
