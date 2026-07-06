"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Menu } from "lucide-react";
import NavbarWrapper from "@/components/NavbarWrapper";
import Sidebar from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const isConsole = pathname === "/lit-console";

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileSidebarOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (window.innerWidth < 1024) setMobileSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10 flex min-h-screen">
        <Sidebar
          open={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
          collapsed={desktopSidebarCollapsed}
        />
        <div className="flex-1 flex flex-col min-h-screen">
          {!isConsole && (
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden fixed top-3 left-3 z-40 p-2 rounded-lg backdrop-blur-md border"
              style={{
                backgroundColor: `${T.bgColor}e0`,
                borderColor: `${T.borderColor}30`,
                color: T.textMuted,
              }}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
          )}
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          {!isConsole && (
            <NavbarWrapper
              onMenuClick={() => setDesktopSidebarCollapsed((v) => !v)}
            />
          )}
          <main className={isConsole ? "flex-1 w-full max-w-full overflow-hidden flex flex-col" : "flex-1 w-full max-w-full overflow-x-hidden pb-16 md:pb-0"}>
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </>
  );
}
