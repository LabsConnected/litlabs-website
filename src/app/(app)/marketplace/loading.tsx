import { ProductFrame } from "@/components/ProductPageFrame";
import Link from "next/link";

/** Bounded loading state — renders the real H1/copy/links immediately so the
 *  page is never blank, even if the catalog fetch is slow. */
export default function Loading() {
  return (
    <>
      <div className="border-b border-white/10 bg-gradient-to-b from-white/[.03] to-transparent px-4 py-8 sm:px-6 sm:py-10">
        <ProductFrame>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Marketplace
            </h1>
            <span className="rounded-full bg-lime-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-lime-300">
              Beta
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Browse verified capabilities for LiTT. Installable items show a clear action; everything else is labeled Coming Soon.
          </p>
          <nav aria-label="Marketplace related" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link href="/studio" className="text-lime-300/90 underline-offset-4 hover:underline">
              Open Studio
            </Link>
            <Link href="/capabilities" className="text-lime-300/90 underline-offset-4 hover:underline">
              What LiTT can do
            </Link>
            <Link href="/docs/marketplace" className="text-white/50 underline-offset-4 hover:text-white/80 hover:underline">
              Marketplace docs
            </Link>
          </nav>
        </ProductFrame>
      </div>
      <ProductFrame className="py-12">
        <p className="text-center text-sm text-white/40" role="status" aria-live="polite">
          Loading capabilities…
        </p>
      </ProductFrame>
    </>
  );
}
