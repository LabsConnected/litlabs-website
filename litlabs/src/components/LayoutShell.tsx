"use client";

import { AppShell } from "@/components/site/AppShell";
import CreateFAB from "@/components/CreateFAB";
import FooterWrapper from "@/components/FooterWrapper";
import CookieConsent from "@/components/CookieConsent";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import SignupAttributionTracker from "@/components/SignupAttributionTracker";
import GlobalLiTAssistant from "@/components/GlobalLiTAssistant";
import { LiTAssistantProvider } from "@/context/LiTAssistantContext";

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LiTAssistantProvider>
      <AppShell>
        <SignupAttributionTracker />
        {children}
        <CreateFAB />
        <FooterWrapper />
        <CookieConsent />
        <ServiceWorkerRegistration />
        <GlobalLiTAssistant />
      </AppShell>
    </LiTAssistantProvider>
  );
}
