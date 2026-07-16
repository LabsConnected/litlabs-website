"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import NavbarWrapper from "@/components/NavbarWrapper";
import FooterWrapper from "@/components/FooterWrapper";
import Sidebar from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useNavDrawer } from "@/context/NavDrawerContext";
import dynamic from "next/dynamic";
const CookieConsent = dynamic(() => import("@/components/CookieConsent"), {
  ssr: false,
});
const FloatingChat = dynamic(
  () => import("@/components/FloatingChat").then((m) => ({ default: m.FloatingChat })),
  { ssr: false },
);
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
  "/docs",
];

// Routes that render their own bottom navigation / floating chrome
const SELF_CONTAINED_CHROME = ["/games/cloud"];

function isPublicPath(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function hasOwnChrome(path: string) {
  return SELF_CONTAINED_CHROME.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { open, setOpen, toggle } = useNavDrawer();
  const publicPage = isPublicPath(pathname || "/");
  const isStudio =
    pathname === "/studio" || pathname?.startsWith("/studio/") || false;
  const ownChrome = hasOwnChrome(pathname || "/");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggle]);

  // Close the drawer on route changes so it never stays open after navigation.
  useEffect(() => {
    if (open) setOpen(false);
  }, [pathname, open, setOpen]);

  if (publicPage) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <main className="relative z-10 min-h-dvh">{children}</main>
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  if (isStudio) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        <div className="relative z-10 flex h-dvh w-full max-w-full flex-col overflow-hidden">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <main className="flex h-full w-full min-w-0 flex-col overflow-hidden">
              {children}
            </main>
          </div>
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </>
    );
  }

  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10 flex min-h-dvh">
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          <NavbarWrapper />
          <main
            className={`flex-1 w-full max-w-full min-w-0 overflow-x-hidden md:pb-0 ${
              ownChrome ? "pb-0" : "pb-[calc(72px+env(safe-area-inset-bottom))]"
            }`}
          >
            {children}
          </main>
          {!ownChrome && <MobileBottomNav />}
          <FloatingChat />
          <FooterWrapper />
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </div>
      <Sidebar open={open} onClose={() => setOpen(false)} />
    </>
  );
}
