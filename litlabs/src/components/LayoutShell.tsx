"use client";

import { AppShell } from "@/components/site/AppShell";
import CreateFAB from "@/components/CreateFAB";
import FooterWrapper from "@/components/FooterWrapper";
import CookieConsent from "@/components/CookieConsent";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import SignupAttributionTracker from "@/components/SignupAttributionTracker";
import LiTDock from "@/components/lit-dock/LiTDock";
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
        <LiTDock />
        <GlobalLiTAssistant />
      </AppShell>
    </LiTAssistantProvider>
  );
}
