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
import { useClerkAuth } from "@/hooks/useClerkAuth";

// Routes that render minimal chrome (no navbar / footer).
// Only truly public pages: auth, legal, docs, pricing.
// Note: /hire is hybrid — bare for signed-out, AppShell for signed-in.
const BARE_PUBLIC_PATHS = [
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
  "/docs",
  "/pricing",
];

// Routes that are bare-public ONLY when signed out.
// When signed in, they get the AppShell sidebar.
const HYBRID_PUBLIC_PATHS = ["/hire"];

// Routes that render their own custom interactive chrome (e.g. cloud emulator)
const SELF_CONTAINED_CHROME = ["/games/cloud"];

// Routes that have their own full-page navigation/sidebar and should NOT
// be wrapped in the AppShell (which would create a double-sidebar).
// These pages still require auth but manage their own chrome.
const OWN_SHELL_PATHS = ["/settings"];

function isBarePublicPath(path: string) {
  return BARE_PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function isHybridPublicPath(path: string) {
  return HYBRID_PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
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
  const pathname = usePathname() || "/";
  const { isSignedIn } = useClerkAuth();
  const barePublic = isBarePublicPath(pathname);
  const hybridPublic = isHybridPublicPath(pathname);
  const isStudio = pathname.startsWith("/studio");
  const ownChrome = hasOwnChrome(pathname);
  const ownShell = hasOwnShell(pathname);

  // Hybrid pages: bare public for signed-out, AppShell for signed-in
  if (hybridPublic && !isSignedIn) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <main id="main-content" className="relative z-10 min-h-screen">
          {children}
        </main>
        <GlobalCompanion />
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  if (barePublic) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <main id="main-content" className="relative z-10 min-h-screen">
          {children}
        </main>
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

  // Authenticated routes — use the unified AppShell.
  // Studio flows through AppShell too (shared sidebar) but skips footer,
  // global companion, and YouTube shell since it manages its own full-height chrome.
  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <AppShell>{children}</AppShell>
        {!ownChrome && !isStudio && <FooterWrapper />}
        {!isStudio && <GlobalCompanion />}
        {!isStudio && <YouTubePlayerShell />}
        <CookieConsent />
        <ServiceWorkerRegistration />
      </div>
    </>
  );
}
