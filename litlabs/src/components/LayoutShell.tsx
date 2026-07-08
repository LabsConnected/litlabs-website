"use client";

import dynamic from "next/dynamic";
import { AppShell } from "@/components/site/AppShell";
import FooterWrapper from "@/components/FooterWrapper";

// Lazy-load heavy global components so they don't block the landing page initial bundle.
const CookieConsent = dynamic(() => import("@/components/CookieConsent"), {
  ssr: false,
});
const ServiceWorkerRegistration = dynamic(
  () => import("@/components/ServiceWorkerRegistration"),
  { ssr: false },
);
const SignupAttributionTracker = dynamic(
  () => import("@/components/SignupAttributionTracker"),
  { ssr: false },
);
const LazyAssistantShell = dynamic(
  () => import("@/components/LazyAssistantShell"),
  { ssr: false },
);

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <SignupAttributionTracker />
      {children}
      <FooterWrapper />
      <CookieConsent />
      <ServiceWorkerRegistration />
      <LazyAssistantShell />
    </AppShell>
  );
}
