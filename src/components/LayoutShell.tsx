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
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";

// Routes that render minimal chrome (no navbar / footer).
// Only truly public pages: auth, legal, docs.
// Note: /hire is hybrid — bare for signed-out, AppShell for signed-in.
// /pricing lives in the (marketing) route group now — it never renders here.
const BARE_PUBLIC_PATHS = [
  "/login",
  "/sign-in",
  "/sign-up",
  "/oauth-consent",
  "/privacy",
  "/terms",
  "/cookies",
  "/docs",
];

// Routes that are bare-public ONLY when signed out.
// When signed in, they get the AppShell sidebar.
const HYBRID_PUBLIC_PATHS = ["/hire", "/marketplace", "/discover", "/showcase"];

// Routes that render their own custom interactive chrome (e.g. cloud emulator)
const SELF_CONTAINED_CHROME = ["/games/cloud"];

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

  // Hybrid pages: bare public for signed-out, AppShell for signed-in.
  // Signed-out visitors previously got zero site chrome here — no logo,
  // no way back to "/", pricing, or sign-in short of the browser back
  // button, on pages that are public and indexed (e.g. /marketplace,
  // /discover). Give them the same shared MarketingHeader/Footer every
  // other public page uses, same as the /docs fix. pt-[68px] clears the
  // header's fixed h-[68px] (MarketingHeader.tsx) exactly; the pages'
  // own internal top padding supplies the visual breathing room below it.
  if (hybridPublic && !isSignedIn) {
    return (
      <>
        <AnimatedBackgroundWrapper />
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <MarketingHeader />
        <main id="main-content" className="relative z-10 min-h-dvh pt-[68px]">
          {children}
        </main>
        <MarketingFooter />
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
        <main id="main-content" className="relative z-10 min-h-dvh">
          {children}
        </main>
        <GlobalCompanion />
        <CookieConsent />
        <ServiceWorkerRegistration />
      </>
    );
  }

  // Authenticated routes — use the unified AppShell with the sticky top bar.
  // Studio flows through AppShell too but skips footer,
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
