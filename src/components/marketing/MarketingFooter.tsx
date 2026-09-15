import Link from "next/link";
import BrandMark from "./BrandMark";

export default function MarketingFooter() {
  return (
    <footer className="border-t border-white/8 bg-[#03050a] px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 md:grid-cols-[1.2fr_2fr] md:items-end">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5 font-black text-white"><BrandMark /> LiTTree LabStudios</Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/38">An AI creative operating system for turning ideas into real, ownable work.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-white/42 md:justify-end">
          <Link href="/studio" className="litt-footer-link">Studio</Link>
          <Link href="/agents" className="litt-footer-link">Agents</Link>
          <Link href="/marketplace" className="litt-footer-link">Marketplace</Link>
          <Link href="/discover" className="litt-footer-link">Community</Link>
          <Link href="/pricing" className="litt-footer-link">Pricing</Link>
          <a href="https://github.com/LabsConnected" target="_blank" rel="noopener noreferrer" className="litt-footer-link">GitHub</a>
          <Link href="/privacy" className="litt-footer-link">Privacy</Link>
          <Link href="/terms" className="litt-footer-link">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
