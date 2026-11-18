"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Menu, X } from "lucide-react";
import { track, type FunnelEvent } from "@/lib/analytics";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { BrandLogo } from "@/components/branding/BrandLogo";

type MarketingNavItem = {
  label: string;
  href: string;
  /** Analytics event fired on click (with the render source), if any. */
  trackEvent?: FunnelEvent;
};

// Larry's site audit (2026-09-23 round 2): cut the nav to four items —
// Studio · Capabilities · Pricing · Docs. Developers bounce from clutter.
const NAV_ITEMS: MarketingNavItem[] = [
  { label: "Studio", href: "/studio" },
  { label: "Capabilities", href: "/capabilities" },
  { label: "Pricing", href: "/pricing", trackEvent: "pricing_link_click" },
  { label: "Docs", href: "/docs" },
];

export default function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { isLoaded, isSignedIn } = useClerkAuth();
  // Swap auth CTAs only after hydration — Clerk state is client-only,
  // so render the signed-out CTAs on first paint to avoid a mismatch.
  const signedIn = mounted && isLoaded && isSignedIn;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="litt-site-header fixed inset-x-0 top-0 z-50 border-b border-[#177a36]/15">
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 lg:px-8">
        {/* The full logo art carries a baked-in dark backdrop (white wordmark
            on black glow) — it sits on a deliberate #0b120d plate, the
            approved deep-green dark hue, so it stays legible on the light
            header instead of smudging. ART-20261111-096. */}
        <BrandLogo
          href="/"
          size={42}
          showText={false}
          variant="full"
          className="max-w-[190px] rounded-[10px] bg-[#0b120d] px-2 py-1"
        />

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 text-[13px] font-bold text-[#63745f] lg:flex">
          {NAV_ITEMS.map((item) => {
            const onClick = item.trackEvent
              ? () => track(item.trackEvent as FunnelEvent, { source: "nav" })
              : undefined;
            return item.href.startsWith("#") ? (
              <a key={item.href} href={item.href} className="litt-nav-link" onClick={onClick}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className="litt-nav-link" onClick={onClick}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/studio" className="litt-primary-button !min-h-10 !px-4 !py-2 text-sm" onClick={() => track("hero_cta_click", { source: "header" })}>
              Open Studio <ArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-[#63745f] transition hover:text-[#0c5a26] sm:block">
                Sign in
              </Link>
              <Link href="/sign-up" className="litt-primary-button !min-h-10 !px-4 !py-2 text-sm" onClick={() => track("hero_cta_click", { source: "header" })}>
                Start free <ArrowRight size={14} />
              </Link>
            </>
          )}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-[#177a36]/20 bg-white text-[#0e1510] lg:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-[#177a36]/15 bg-white/95 px-5 py-4 backdrop-blur-2xl lg:hidden"
        >
          <div className="mx-auto grid max-w-[1500px] gap-1">
            {NAV_ITEMS.map((item) => {
              const onClick = () => {
                setMenuOpen(false);
                if (item.trackEvent) track(item.trackEvent, { source: "mobile_nav" });
              };
              return item.href.startsWith("#") ? (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={onClick}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-[#0e1510]/75 hover:bg-[#177a36]/8 hover:text-[#0c5a26]"
                >
                  {item.label} <ChevronRight size={15} />
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClick}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-[#0e1510]/75 hover:bg-[#177a36]/8 hover:text-[#0c5a26]"
                >
                  {item.label} <ChevronRight size={15} />
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
