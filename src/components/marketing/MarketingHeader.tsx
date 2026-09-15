"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Menu, X } from "lucide-react";
import { track } from "@/lib/analytics";
import BrandMark from "./BrandMark";

const NAV_ITEMS = [
  { label: "Capabilities", href: "/#what-we-do" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Studio", href: "/studio" },
  { label: "CLI", href: "/cli" },
  { label: "Creations", href: "/#creations" },
  { label: "FAQ", href: "/#faq" },
  { label: "Community", href: "/discover" },
] as const;

export default function MarketingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="litt-site-header fixed inset-x-0 top-0 z-50 border-b border-white/8">
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 lg:px-8">
        <Link
          href="/"
          aria-label="LiTTree LabStudios home"
          className="flex items-center gap-2.5 font-black tracking-[-0.02em] text-white"
        >
          <BrandMark />
          <span className="hidden sm:block">LiTTree <span className="text-white/48">LabStudios</span></span>
          <span className="sm:hidden">LiTTree</span>
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 text-[13px] font-bold text-white/55 lg:flex">
          {NAV_ITEMS.map((item) =>
            item.href.startsWith("#") ? (
              <a key={item.href} href={item.href} className="litt-nav-link">
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className="litt-nav-link">
                {item.label}
              </Link>
            ),
          )}
          <Link href="/pricing" className="litt-nav-link" onClick={() => track("pricing_link_click", { source: "nav" })}>Pricing</Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-white/55 transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-up" className="litt-primary-button !min-h-10 !px-4 !py-2 text-sm" onClick={() => track("hero_cta_click", { source: "header" })}>
            Start free <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white lg:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-white/8 bg-[#05070d]/96 px-5 py-4 backdrop-blur-2xl lg:hidden"
        >
          <div className="mx-auto grid max-w-[1500px] gap-1">
            {NAV_ITEMS.map((item) =>
              item.href.startsWith("#") ? (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white"
                >
                  {item.label} <ChevronRight size={15} />
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white"
                >
                  {item.label} <ChevronRight size={15} />
                </Link>
              ),
            )}
            <Link href="/pricing" onClick={() => { setMenuOpen(false); track("pricing_link_click", { source: "mobile_nav" }); }} className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white">
              Pricing <ChevronRight size={15} />
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
