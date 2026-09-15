import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { VisualProvider } from "@/context/VisualContext";
import { MediaHubProvider } from "@/components/media/MediaHubProvider";
import { YouTubePlayerProvider } from "@/context/YouTubePlayerContext";
import { MusicPlayerProvider } from "@/context/MusicPlayerContext";
import LayoutShell from "@/components/LayoutShell";

/**
 * App layout — authenticated application routes.
 *
 * Wraps all dashboard/studio/app routes in the app-specific providers
 * and the LayoutShell (which renders the AppShell sidebar, footer,
 * companion, etc. based on the current pathname).
 *
 * This layout is intentionally separate from the root layout so that
 * public marketing routes under (marketing) never receive the app shell.
 *
 * Force dynamic rendering for the whole app subtree: these routes are
 * inherently dynamic (Clerk auth, user state, live studio data), so
 * static prerendering provides no benefit here. Marketing routes outside
 * this group remain statically prerenderable.
 */
export const dynamic = "force-dynamic";
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProfileProvider>
      <WalletProvider>
        <VisualProvider>
          <MediaHubProvider>
            <YouTubePlayerProvider>
              <MusicPlayerProvider>
                <LayoutShell>{children}</LayoutShell>
              </MusicPlayerProvider>
            </YouTubePlayerProvider>
          </MediaHubProvider>
        </VisualProvider>
      </WalletProvider>
    </ProfileProvider>
  );
}
