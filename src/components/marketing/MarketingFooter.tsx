import Link from "next/link";
import { BrandLogo } from "@/components/branding/BrandLogo";

export default function MarketingFooter() {
  return (
    <footer className="border-t border-[#177a36]/15 bg-white px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 md:grid-cols-[1.2fr_2fr] md:items-end">
        <div>
          {/* Logo art has a baked-in dark backdrop — same deliberate #0b120d
              plate as the header, so it reads cleanly on the light footer.
              ART-20261111-096. */}
          <BrandLogo href="/" size={42} showText={false} variant="full" className="max-w-[190px] rounded-[10px] bg-[#0b120d] px-2 py-1" />
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#63745f]">The AI Project Operator for turning ideas into real, ownable work.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-[#63745f] md:justify-end">
          <Link href="/studio" className="litt-footer-link">Studio</Link>
          <Link href="/agents" className="litt-footer-link">Agents</Link>
          <Link href="/marketplace" className="litt-footer-link">Marketplace</Link>
          <Link href="/discover" className="litt-footer-link">Discover</Link>
          <Link href="/pricing" className="litt-footer-link">Pricing</Link>
          <Link href="/cli" className="litt-footer-link">CLI</Link>
          <Link href="/about" className="litt-footer-link">About</Link>
          <a href="https://github.com/LabsConnected" target="_blank" rel="noopener noreferrer" className="litt-footer-link">GitHub</a>
          <Link href="/privacy" className="litt-footer-link">Privacy</Link>
          <Link href="/terms" className="litt-footer-link">Terms</Link>
          <Link href="/cookies" className="litt-footer-link">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
