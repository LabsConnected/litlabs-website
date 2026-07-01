"use client";

import { useState, useEffect } from "react";
import NavbarWrapper from "@/components/NavbarWrapper";
import FooterWrapper from "@/components/FooterWrapper";
import Sidebar from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import CreateFAB from "@/components/CreateFAB";
import CookieConsent from "@/components/CookieConsent";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { Menu } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { resolvedColors: T } = useTheme();

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
        <Sidebar open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
        <div className="flex-1 flex flex-col min-h-screen">
          {/* Mobile hamburger trigger */}
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
          <UserSync />
          <NavbarWrapper onMenuClick={() => setMobileSidebarOpen(true)} />
          <main className="flex-1 w-full max-w-full overflow-x-hidden pb-16 md:pb-0">
            {children}
          </main>
          <MobileBottomNav />
          <CreateFAB />
          <FooterWrapper />
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </div>
    </>
  );
}
