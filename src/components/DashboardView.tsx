"use client";

import { useState } from "react";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { APPS } from "@/components/dashboard/dashboard-data";
import { CenterStage } from "@/components/dashboard/DashboardCards";

export default function DashboardView() {
  const { user } = useAppUser();
  const { profile } = useProfile();
  const { resolvedColors: T } = useTheme();
  const [activeApp, setActiveApp] = useState("home");

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Center */}
      <main
        className={`flex-1 min-w-0 p-4 lg:p-6 ${
          activeApp === "jarvis"
            ? "flex flex-col overflow-hidden"
            : "overflow-y-auto"
        }`}
      >
        {/* Mobile app bar */}
        <div className="md:hidden flex gap-2 overflow-x-auto pb-4 mb-4 scrollbar-hide" onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}>
          {APPS.map((app) => {
            const Icon = app.icon;
            const active = activeApp === app.id;
            return (
              <button
                key={app.id}
                onClick={() => setActiveApp(app.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active ? `${app.color}15` : `${T.boxBg}60`,
                  border: active
                    ? `1px solid ${app.color}40`
                    : `1px solid ${T.borderColor}30`,
                  color: active ? app.color : T.textMuted,
                }}
              >
                <Icon size={14} />
                {app.label}
              </button>
            );
          })}
        </div>

        <CenterStage activeApp={activeApp} displayName={displayName} />
      </main>
    </div>
  );
}

