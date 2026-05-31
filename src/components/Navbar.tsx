"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/dashboard", label: "TERMINAL", icon: "◈" },
  { href: "/gallery", label: "CHAMPIONS", icon: "🏛" },
  { href: "/marketplace", label: "FORGE", icon: "🔧" },
  { href: "/agent-chat", label: "UPLINK", icon: "⚡" },
  { href: "/social", label: "THE MATRIX", icon: "👥" },
];

interface User {
  id: string;
  email: string;
  name: string | null;
}

export default function Navbar({ user: ssrUser }: { user?: User | null }) {
  const pathname = usePathname();
  const { user: clientUser } = useAuth();
  const user = ssrUser ?? clientUser;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-black/80 backdrop-blur-3xl hologram-glow">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-10">
        <Link
          href={user ? "/dashboard" : "/"}
          className="font-heading text-xl sm:text-2xl font-black tracking-tighter text-white hover:text-neon-cyan transition-all group flex items-center gap-2"
        >
          <span className="text-neon-cyan drop-shadow-[0_0_10px_var(--neon-cyan)] group-hover:animate-glitch">LiT</span>
          <span className="text-neon-purple opacity-80 group-hover:opacity-100 transition-opacity">Tree</span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-2 lg:flex">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                className={`relative px-4 py-2 text-[10px] font-black tracking-[0.2em] transition-all hover:text-white uppercase ${
                  isActive
                    ? "text-neon-cyan"
                    : "text-zinc-500"
                }`}
                href={item.href}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-neon-cyan shadow-[0_0_10px_var(--neon-cyan)] rounded-full animate-pulse" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden text-right md:block space-y-0.5">
                <div className="text-[10px] font-black text-white uppercase tracking-wider">
                  {user.name || user.email?.split("@")[0]}
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[8px] font-bold text-zinc-600 tracking-widest uppercase">NODE_ONLINE</span>
                </div>
              </div>
              <Link
                href="/settings"
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/5 hover:border-neon-cyan/40 hover:bg-black transition-all shadow-inner"
              >
                <span className="font-heading text-sm font-black text-neon-cyan">
                  {(user.name?.charAt(0) || user.email?.charAt(0) || "U").toUpperCase()}
                </span>
              </Link>
              <form action="/api/auth/logout" method="POST" className="hidden sm:block">
                <button
                  type="submit"
                  className="text-[9px] font-black text-zinc-600 hover:text-red-500 transition-colors tracking-widest uppercase"
                >
                  SIGNOUT
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link
                href="/login"
                className="btn-primary text-[10px] px-8 py-3 font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(0,242,254,0.1)]"
              >
                INITIALIZE
              </Link>
            </div>
          )}

          {/* Mobile Toggle */}
          <button
            className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] text-white hover:border-neon-cyan/40 transition-all"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-white/5 bg-black/95 backdrop-blur-3xl animate-slide-up">
          <div className="flex flex-col p-6 gap-3">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-4 rounded-xl px-5 py-4 text-xs font-black tracking-[0.2em] transition-all uppercase ${
                    isActive
                      ? "bg-neon-cyan text-black shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
                  }`}
                  href={item.href}
                >
                  <span className="text-xl w-6 text-center">{item.icon}</span>
                  {item.label}
                  {isActive && (
                    <span className="ml-auto text-[8px] font-black animate-pulse">ACTIVE</span>
                  )}
                </Link>
              );
            })}
            {user && (
              <form action="/api/auth/logout" method="POST" className="mt-4 pt-4 border-t border-white/5">
                <button
                  type="submit"
                  className="w-full flex items-center gap-4 rounded-xl px-5 py-4 text-xs font-black tracking-[0.2em] text-red-500 hover:bg-red-500/5 transition-all uppercase"
                >
                  <span className="text-xl w-6 text-center">⏻</span>
                  ABORT_SESSION
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
