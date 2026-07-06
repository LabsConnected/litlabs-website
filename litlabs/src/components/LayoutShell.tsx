"use client";

import { AppShell } from "@/components/site/AppShell";
import CreateFAB from "@/components/CreateFAB";
import FooterWrapper from "@/components/FooterWrapper";
import CookieConsent from "@/components/CookieConsent";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      {children}
      <CreateFAB />
      <FooterWrapper />
      <CookieConsent />
      <ServiceWorkerRegistration />
    </AppShell>
  );
}
