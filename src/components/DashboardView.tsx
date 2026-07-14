"use client";

import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { CenterStage } from "@/components/dashboard/DashboardCards";

export default function DashboardView() {
  const { user } = useAppUser();
  const { profile } = useProfile();
  const { resolvedColors: T } = useTheme();

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Center */}
      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6">
        <CenterStage activeApp="home" displayName={displayName} />
      </main>
    </div>
  );
}
