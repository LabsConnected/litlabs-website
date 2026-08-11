"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import FooterWrapper from "@/components/FooterWrapper";
import CookieConsent from "@/components/CookieConsent";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { GlobalCompanion } from "@/components/companion/GlobalCompanion";
import { YouTubePlayerShell } from "@/components/youtube/YouTubePlayerShell";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
  "/docs",
  "/pricing",
  "/showcase",
  "/marketplace",
  "/gallery",
  "/games",
  "/social",
  "/hire",
];

// Routes that render their own bottom navigation / floating chrome
const SELF_CONTAINED_CHROME = ["/games/cloud"];

// Routes that have their own full-page navigation/sidebar and should NOT
// be wrapped in the AppShell (which would create a double-sidebar).
// These pages still require auth but manage their own chrome.
const OWN_SHELL_PATHS = ["/settings"];

function isPublicPath(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function hasOwnChrome(path: string) {
  return SELF_CONTAINED_CHROME.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

function hasOwnShell(path: string) {
  return OWN_SHELL_PATHS.some(
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
  const isStudio = (pathname || "").startsWith("/studio");
  const ownChrome = hasOwnChrome(pathname || "/");
  const ownShell = hasOwnShell(pathname || "/");

  if (isStudio) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <div className="relative z-10 h-dvh w-full max-w-full overflow-hidden">
          {children}
        </div>
        {/* Media Hub lives inside the Studio drawer — no floating player */}
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
        <main id="main-content" className="relative z-10 min-h-screen">{children}</main>
        <GlobalCompanion />
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  // Authenticated pages that manage their own full-page shell (e.g. Settings
  // has its own 260px nav sidebar). Skip AppShell to avoid a double sidebar.
  if (ownShell) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        <div className="relative z-10">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
          <main id="main-content" className="min-h-screen">{children}</main>
          <GlobalCompanion />
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </>
    );
  }

  // Authenticated routes — use the unified AppShell
  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <AppShell>{children}</AppShell>
        {!ownChrome && <FooterWrapper />}
        <GlobalCompanion />
        <YouTubePlayerShell />
        <CookieConsent />
        <ServiceWorkerRegistration />
      </div>
    </>
  );
}
