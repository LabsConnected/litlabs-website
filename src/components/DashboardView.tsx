"use client";

import { useTheme } from "@/context/ThemeContext";
import DashboardContent from "@/components/dashboard/DashboardContent";

export default function DashboardView() {
  const { resolvedColors: T } = useTheme();

  return (
    <div
      className="flex min-h-dvh"
      style={{ backgroundColor: "transparent", color: T.textColor }}
    >
      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto w-full max-w-7xl">
          <DashboardContent />
        </div>
      </main>
    </div>
  );
}
