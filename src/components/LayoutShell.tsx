"use client";

import { usePathname } from "next/navigation";
import TopNavbar from "@/components/TopNavbar";
import FooterWrapper from "@/components/FooterWrapper";
import MobileBottomNav from "@/components/MobileBottomNav";
import Sidebar from "@/components/Sidebar";
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

function isPublicPath(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const publicPage = isPublicPath(pathname || "/");
  const isStudio =
    pathname === "/studio" || pathname?.startsWith("/studio/") || false;
  const { open: drawerOpen, setOpen: setDrawerOpen } = useNavDrawer();

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
          <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
            {children}
          </main>
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </>
    );
  }

  return (
    <>
      <AnimatedBackgroundWrapper />
      <div className="relative z-10 flex min-h-dvh flex-col">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        <TopNavbar />
        <main className="flex-1 w-full max-w-full min-w-0 overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
        <FloatingChat />
        <FooterWrapper />
        <MobileBottomNav />
        <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <CookieConsent />
        <ServiceWorkerRegistration />
      </div>
    </>
  );
}
