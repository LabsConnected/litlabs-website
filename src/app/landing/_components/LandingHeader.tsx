"use client";

import Link from "next/link";
import { Sparkles, Menu, X } from "lucide-react";
import { useState } from "react";
import { LandingHeaderAuth } from "./LandingHeaderAuth";

const NAV_LINKS = [
  { label: "Generate", href: "/generate" },
  { label: "Flow", href: "/flow" },
  { label: "Studio", href: "/studio" },
  { label: "Agents", href: "/agents" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "How it works", href: "#how" },
  { label: "Docs", href: "/docs" },
];

export function LandingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#06060e]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 md:px-8">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-black tracking-tight text-white"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-cyan-400 via-fuchsia-500 to-amber-400 shadow-lg shadow-fuchsia-500/30">
            <Sparkles size={15} className="text-black" />
          </div>
          <span>
            LiTT <span className="text-neutral-500">/</span> Labs
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 text-sm text-neutral-400 md:flex">
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
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/3 text-neutral-300 transition hover:border-white/20 hover:bg-white/7 md:hidden"
          >
            {open ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/5 bg-[#06060e]/95 px-5 pb-5 pt-3 md:hidden">
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
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
