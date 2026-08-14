"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { LandingHeaderAuth } from "./LandingHeaderAuth";
import { BrandLogo } from "@/components/branding/BrandLogo";

const NAV_LINKS = [
  { label: "Studio", href: "/studio" },
  { label: "Missions", href: "/studio?tool=workflows" },
  { label: "Marketplace", href: "/marketplace", badge: "Beta" },
  { label: "Pricing", href: "/pricing" },
  { label: "How it works", href: "#how" },
  { label: "Docs", href: "/docs" },
];

export function LandingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#06060e]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4 md:px-10 md:py-5">
        {/* Logo — icon only on mobile, icon+text on md+ */}
        <BrandLogo
          href="/"
          size={36}
          showText={false}
          className="md:hidden"
        />
        <BrandLogo
          href="/"
          size={36}
          showText
          className="hidden md:inline-flex"
        />

        {/* Desktop nav — slightly larger */}
        <nav className="hidden items-center gap-8 text-[15px] text-neutral-400 md:flex">
          {NAV_LINKS.map((l) =>
            l.href.startsWith("#") ? (
              <a
                key={l.label}
                href={l.href}
                className="transition hover:text-white"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                href={l.href}
                className="transition hover:text-white"
              >
                {l.label}
                {"badge" in l && l.badge && (
                  <span className="ml-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber-300">
                    {l.badge}
                  </span>
                )}
              </Link>
            ),
          )}
        </nav>

        {/* Auth + mobile toggle */}
        <div className="flex items-center gap-2">
          <LandingHeaderAuth />
          <button
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/3 text-neutral-300 transition hover:border-white/20 hover:bg-white/7 md:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/5 bg-[#06060e]/95 px-6 pb-5 pt-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((l) =>
              l.href.startsWith("#") ? (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                  {"badge" in l && l.badge && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber-300">
                      {l.badge}
                    </span>
                  )}
                </Link>
              ),
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
