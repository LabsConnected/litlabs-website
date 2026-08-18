import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { VisualProvider } from "@/context/VisualContext";
import { MediaHubProvider } from "@/components/media/MediaHubProvider";
import { YouTubePlayerProvider } from "@/context/YouTubePlayerContext";
import { MusicPlayerProvider } from "@/context/MusicPlayerContext";
import { UserEnsureProvider } from "@/context/UserEnsureContext";
import LayoutShell from "@/components/LayoutShell";

/**
 * App layout — authenticated application routes.
 *
 * Wraps all dashboard/studio/app routes in the app-specific providers
 * and the LayoutShell (which renders the AppShell sidebar, footer,
 * companion, etc. based on the current pathname).
 *
 * UserEnsureProvider calls /api/user/ensure on first auth so the
 * backend user + wallet rows exist before any app route renders.
 *
 * This layout is intentionally separate from the root layout so that
 * public marketing routes under (marketing) never receive the app shell.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserEnsureProvider>
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
    </UserEnsureProvider>
  );
}
