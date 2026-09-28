import type { Metadata, Viewport } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { isLittAppEnabled, resolveLittAppAccess } from "@/lib/litt-client/entry-points";
import { LittAppFrame } from "./litt-app-frame";
import "./litt-app.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LiTT",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#070b14",
};

/**
 * LiTT App layout. Separate from `(app)` so it does not inherit
 * LayoutShell or the wallet / music / YouTube providers.
 *
 * The feature flag defaults off. While it is off this layout 404s
 * before any app frame is rendered. While it is on, a missing Clerk
 * user is sent to sign-in. `src/proxy.ts` also protects `/app(.*)`.
 */
export default async function LittAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const enabled = isLittAppEnabled();
  let userId: string | null = null;
  if (enabled) {
    try {
      userId = (await auth()).userId;
    } catch {
      userId = null;
    }
  }

  const access = resolveLittAppAccess(enabled, userId);
  if (access === "not_found") notFound();
  if (access === "sign_in") {
    redirect("/sign-in?redirect_url=%2Fapp");
  }

  return <LittAppFrame>{children}</LittAppFrame>;
}
