import { ProductFrame } from "@/components/ProductPageFrame";
import Link from "next/link";

/** Bounded loading state — renders the real H1/copy/links immediately so the
 *  page is never blank, even if the catalog fetch is slow. */
export default function Loading() {
  return (
    <>
      <div className="border-b border-[color-mix(in_srgb,var(--text-color)_10%,transparent)] bg-gradient-to-b from-[color-mix(in_srgb,var(--text-color)_3%,transparent)] to-transparent px-4 py-8 sm:px-6 sm:py-10">
        <ProductFrame>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-[var(--text-color)] sm:text-3xl">
              Marketplace
            </h1>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--accent-color)]">
              Beta
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-[color-mix(in_srgb,var(--text-color)_55%,transparent)]">
            Browse verified capabilities for LiTT. Installable items show a clear action; everything else is labeled Coming Soon.
          </p>
          <nav aria-label="Marketplace related" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link href="/studio" className="text-[var(--link-color)] underline-offset-4 hover:underline">
              Open Studio
            </Link>
            <Link href="/capabilities" className="text-[var(--link-color)] underline-offset-4 hover:underline">
              What LiTT can do
            </Link>
            <Link href="/docs/marketplace" className="text-[color-mix(in_srgb,var(--text-color)_50%,transparent)] underline-offset-4 hover:text-[color-mix(in_srgb,var(--text-color)_80%,transparent)] hover:underline">
              Marketplace docs
            </Link>
          </nav>
        </ProductFrame>
      </div>
      <ProductFrame className="py-12">
        <p className="text-center text-sm text-[color-mix(in_srgb,var(--text-color)_40%,transparent)]" role="status" aria-live="polite">
          Loading capabilities…
        </p>
      </ProductFrame>
    </>
  );
}
