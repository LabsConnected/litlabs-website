"use client";

import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import PersonalDashboard from "@/components/dashboard/PersonalDashboard";

export default function DashboardView() {
  const { user } = useAppUser();
  const { profile } = useProfile();
  const { resolvedColors: T } = useTheme();

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  return (
    <div
      className="flex min-h-dvh"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Center */}
      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6">
        <PersonalDashboard displayName={displayName} />
      </main>
    </div>
  );
}
