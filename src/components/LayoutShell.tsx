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

// Routes that render minimal chrome (no navbar / footer)
const BARE_PUBLIC_PATHS = [
  "/login",
  "/sign-in",
  "/sign-up",
  "/privacy",
  "/terms",
  "/cookies",
];

// Routes that render their own custom interactive chrome (e.g. cloud emulator)
const SELF_CONTAINED_CHROME = ["/games/cloud"];

function isBarePublicPath(path: string) {
  return BARE_PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
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
  const pathname = usePathname() || "/";
  const barePublic = isBarePublicPath(pathname);
  const isStudio = pathname.startsWith("/studio");
  const ownChrome = hasOwnChrome(pathname);

  if (isStudio) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <div className="relative z-10 h-dvh w-full max-w-full overflow-hidden">
          {children}
        </div>
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
