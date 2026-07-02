"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { APPS } from "@/components/dashboard/dashboard-data";
import { CenterStage } from "@/components/dashboard/DashboardCards";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";

export default function DashboardView() {
  const { user } = useUser();
  const { profile } = useProfile();
  const { resolvedColors: T } = useTheme();
  const { balance, claimed, claim } = useWallet();
  const [activeApp, setActiveApp] = useState("home");
  const visitors = 133742;

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Left Dock */}
      <aside
        className="hidden md:flex flex-col items-center py-4 gap-2 w-16 shrink-0 border-r"
        style={{
          borderColor: `${T.borderColor}30`,
          backgroundColor: `${T.bgColor}80`,
        }}
      >
        {APPS.map((app) => {
          const Icon = app.icon;
          const active = activeApp === app.id;
          return (
            <button
              key={app.id}
              onClick={() => setActiveApp(app.id)}
              className="relative group w-11 h-11 rounded-xl flex items-center justify-center transition-all"
              style={{
                backgroundColor: active ? `${app.color}15` : "transparent",
                border: active
                  ? `1px solid ${app.color}40`
                  : "1px solid transparent",
              }}
              title={app.label}
            >
              <Icon
                size={20}
                style={{ color: active ? app.color : T.textMuted }}
              />
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                  style={{ backgroundColor: app.color }}
                />
              )}
              <span
                className="absolute left-14 px-2 py-1 rounded text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50"
                style={{
                  backgroundColor: T.boxBg,
                  border: `1px solid ${T.borderColor}40`,
                  color: T.textColor,
                }}
              >
                {app.label}
              </span>
            </button>
          );
        })}
      </aside>

      {/* Left Widgets Sidebar */}
      <DashboardWidgets
        displayName={displayName}
        balance={balance}
        claimed={claimed}
        visitors={visitors}
        onClaimAction={claim}
      />

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


