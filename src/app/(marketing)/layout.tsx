import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import UserSync from "@/components/UserSync";
import CookieConsent from "@/components/CookieConsent";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

/**
 * Marketing layout — public-facing pages.
 *
 * Includes ProfileProvider and WalletProvider because the landing page's
 * auth component (LandingHeaderAuth → NavAuth) calls useProfile/useWallet
 * to show the right auth state. These are lightweight context providers,
 * NOT app chrome.
 *
 * This layout does NOT include:
 * - LayoutShell / AppShell (dashboard sidebar, bottom nav)
 * - AnimatedBackgroundWrapper (app wallpaper; landing has its own)
 * - GlobalCompanion (LiTT companion widget)
 * - YouTubePlayerShell / MusicPlayerProvider / MediaHubProvider
 *
 * The architectural separation between (marketing) and (app) ensures
 * the public landing page never renders dashboard chrome.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProfileProvider>
      <WalletProvider>
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserSync /> : null}
        {children}
        <CookieConsent />
        <ServiceWorkerRegistration />
      </WalletProvider>
    </ProfileProvider>
  );
}
