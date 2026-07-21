"use client";

import { usePathname } from "next/navigation";
import NavbarWrapper from "@/components/NavbarWrapper";
import FooterWrapper from "@/components/FooterWrapper";
import MobileBottomNav from "@/components/MobileBottomNav";
import { FloatingChat } from "@/components/FloatingChat";
import CookieConsent from "@/components/CookieConsent";
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
const SELF_CONTAINED_CHROME = ["/games/cloud", "/agents"];

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
  const publicPage = isPublicPath(pathname || "/");
  const isStudio = pathname === "/studio";
  const ownChrome = hasOwnChrome(pathname || "/");

  if (isStudio) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        <div className="relative z-10 flex h-dvh w-full max-w-full flex-col overflow-hidden">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          <NavbarWrapper />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <main className="flex h-full w-full min-w-0 flex-col overflow-hidden">
              {children}
            </main>
          </div>
        </div>
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  if (publicPage) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <main className="relative z-10 min-h-screen">{children}</main>
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10 flex min-h-screen">
        <div className="flex-1 flex flex-col min-h-screen min-w-0">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          <NavbarWrapper />
          <main
            className={`flex-1 w-full max-w-full min-w-0 overflow-x-hidden md:pb-0 ${
              ownChrome ? "pb-0" : "pb-[calc(88px+env(safe-area-inset-bottom))]"
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
    </>
  );
}
