"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: "◈" },
  { href: "/gallery", label: "Agents", icon: "🏛" },
  { href: "/marketplace", label: "Forge", icon: "🔧" },
  { href: "/agent-chat", label: "Chat", icon: "⚡" },
  { href: "/social", label: "Social", icon: "👥" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/70 backdrop-blur-2xl">
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link
          href={user ? "/dashboard" : "/"}
          className="font-heading text-lg sm:text-xl font-bold tracking-tighter text-neon-cyan text-glow-cyan hover:text-cyan-300 transition-colors"
        >
          LiT<span className="text-neon-purple">Tree</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                className={`relative rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                  isActive
                    ? "text-neon-cyan"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
                }`}
                href={item.href}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-neon-cyan" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden text-right lg:block">
                <div className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                  {user.name || user.email?.split("@")[0]}
                </div>
                <div className="text-[10px] text-text-muted font-code tracking-tighter">ONLINE</div>
              </div>
              <Link
                href="/settings"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-neon-cyan/10 border border-neon-cyan/30 text-sm hover:bg-neon-cyan/20 transition-all"
              >
                <span className="font-heading text-xs font-bold text-neon-cyan">
                  {(user.name?.charAt(0) || user.email?.charAt(0) || "U").toUpperCase()}
                </span>
              </Link>
              <form action="/api/auth/logout" method="POST" className="hidden sm:block">
                <button
                  type="submit"
                  className="text-[10px] text-text-muted hover:text-red-400 transition-colors font-code tracking-widest uppercase px-2 py-1"
                >
                  Logout
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/gallery"
                className="hidden sm:flex text-xs text-text-secondary hover:text-neon-cyan transition-colors font-medium px-3 py-2"
              >
                Explore
              </Link>
              <Link
                href="/login"
                className="btn-primary text-xs px-4 py-2 uppercase tracking-widest"
              >
                {pathname === "/" ? "Get Started" : "Sign In"}
              </Link>
            </div>
          )}

          {/* Mobile Toggle */}
          <button
            className="md:hidden text-text-primary p-2 focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-3xl animate-slide-up">
          <div className="flex flex-col p-3 gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium transition-all min-h-[48px] ${
                    isActive
                      ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20"
                      : "text-text-secondary hover:bg-white/[0.04]"
                  }`}
                  href={item.href}
                >
                  <span className="text-lg w-6 text-center">{item.icon}</span>
                  {item.label}
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
                  )}
                </Link>
              );
            })}
            {!user && (
              <Link
                href="/gallery"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium text-text-secondary hover:bg-white/[0.04] min-h-[48px]"
              >
                <span className="text-lg w-6 text-center">🏛</span>
                Explore Agents
              </Link>
            )}
            {user && (
              <form action="/api/auth/logout" method="POST" className="mt-1">
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium text-red-400 hover:bg-red-400/5 transition-all min-h-[48px]"
                >
                  <span className="text-lg w-6 text-center">⏻</span>
                  End Session
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
