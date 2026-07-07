"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import Link from "next/link";
import { Bell, Home, Settings, User } from "lucide-react";
import NavbarWrapper from "@/components/NavbarWrapper";
import MobileBottomNav from "@/components/MobileBottomNav";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const PUBLIC_ROUTES = ["/", "/sign-in", "/sign-up", "/login", "/privacy", "/terms", "/cookies"];
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname?.startsWith(r + "/"));
  const isStudio = !isPublic && pathname?.startsWith("/studio");
  const isAdmin = !isPublic && pathname?.startsWith("/admin");
  const isConsole = isStudio || isAdmin;
  const hideMobileBottomNav = isPublic || isConsole;

  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className={`relative z-10 flex ${isConsole ? "h-[100dvh] overflow-hidden md:h-screen" : "min-h-screen"}`}>
        <div className={`min-w-0 flex-1 flex flex-col ${isConsole ? "h-[100dvh] overflow-hidden md:h-screen" : "min-h-screen"}`}>
          {isConsole && pathname?.startsWith("/admin") && (
            <header
              className="md:hidden flex h-[52px] shrink-0 items-center justify-between border-b px-3"
              style={{
                backgroundColor: `${T.bgColor}f2`,
                borderColor: `${T.borderColor}30`,
                color: T.textColor,
              }}
            >
              <Link
                href="/admin"
                className="flex h-10 w-10 items-center justify-center rounded-lg border"
                style={{
                  backgroundColor: `${T.boxBg}cc`,
                  borderColor: `${T.borderColor}35`,
                  color: T.accentColor,
                }}
                aria-label="Admin home"
              >
                <Home size={21} />
              </Link>
              <Link href={pathname?.startsWith("/admin") ? "/admin" : "/studio"} className="min-w-0 text-center">
                <div className="truncate text-sm font-black tracking-tight">
                  {pathname?.startsWith("/admin") ? "Admin" : "Studio"}
                </div>
                <div
                  className="text-[9px] font-black uppercase tracking-[0.18em]"
                  style={{ color: T.textMuted }}
                >
                  Online
                </div>
              </Link>
              <div className="flex items-center gap-1">
                <Link
                  href="/social?tab=notifications"
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ color: T.textMuted }}
                  aria-label="Notifications"
                >
                  <Bell size={18} />
                </Link>
                <Link
                  href="/settings"
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ color: T.textMuted }}
                  aria-label="Settings"
                >
                  <Settings size={18} />
                </Link>
                <Link
                  href="/profile"
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ color: T.textMuted }}
                  aria-label="Profile"
                >
                  <User size={18} />
                </Link>
              </div>
            </header>
          )}
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          {!isConsole && !isPublic && (
            <NavbarWrapper />
          )}
          <main className={isConsole ? "h-0 min-h-0 flex-1 w-full max-w-full overflow-hidden flex flex-col" : "flex-1 w-full max-w-full overflow-x-hidden pb-16 md:pb-0"}>
            {children}
          </main>
          {!hideMobileBottomNav && <MobileBottomNav />}
        </div>
      </div>
    </>
  );
}
