"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useSearchParams } from "next/navigation";
import { Activity, X } from "lucide-react";
import { APPS } from "@/components/dashboard/dashboard-data";
import { CenterStage } from "@/components/dashboard/DashboardCards";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";
import NotificationInbox from "@/components/dashboard/NotificationInbox";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";

export default function DashboardView() {
  const { user } = useUser();
  const { profile } = useProfile();
  const { resolvedColors: T } = useTheme();
  const { balance, claimed, claim } = useWallet();
  const searchParams = useSearchParams();
  const visitors = 133742;

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  const appFromUrl = searchParams?.get("app") ?? null;
  const [manualApp, setManualApp] = useState("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const activeApp = appFromUrl ?? manualApp;
  const setActiveApp = (app: string) => setManualApp(app);

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Grouped sidebar — handles all 3 modes internally */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main column: top bar + content + right rail */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Slim top bar — global actions only */}
        <Navbar onMenuClick={() => setSidebarOpen(true)} />

        <div className="flex flex-1 min-h-0">
          {/* Center content */}
          <main
            className={`flex-1 min-w-0 p-4 lg:p-6 ${
              activeApp === "jarvis"
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto"
            }`}
          >
            {/* Notification bell */}
            <div className="flex justify-end mb-2">
              <NotificationInbox />
            </div>

            {/* Mobile app bar — compact horizontal scroll below md */}
            <div className="md:hidden flex gap-2 overflow-x-auto pb-4 mb-4 scrollbar-hide">
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

            <CenterStage
              activeApp={activeApp}
              displayName={displayName}
              onAppChange={setActiveApp}
            />
          </main>

          {/* Right rail — live widgets (xl+ only) */}
          <DashboardWidgets
            displayName={displayName}
            balance={balance}
            claimed={claimed}
            visitors={visitors}
            onClaimAction={claim}
            onOpenMusic={() => setActiveApp("music")}
            onOpenRadio={() => setActiveApp("radio")}
          />
        </div>
      </div>

      {/* Mobile: floating Status button (hidden at xl+) */}
      <button
        className="xl:hidden fixed bottom-5 right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg transition-all active:scale-95"
        style={{
          backgroundColor: T.accentColor,
          color: "#000",
          boxShadow: `0 0 20px ${T.accentColor}60`,
        }}
        onClick={() => setStatusOpen(true)}
      >
        <Activity size={14} /> Status
      </button>

      {/* Mobile: Status drawer overlay */}
      {statusOpen && (
        <div className="xl:hidden fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setStatusOpen(false)}
          />
          <div
            className="relative flex flex-col w-80 max-w-[90vw] h-full overflow-y-auto shadow-2xl border-l"
            style={{
              backgroundColor: `${T.bgColor}f8`,
              borderColor: `${T.borderColor}30`,
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: `${T.borderColor}25` }}
            >
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>Live Status</span>
              <button onClick={() => setStatusOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: T.textMuted }}>
                <X size={15} />
              </button>
            </div>
            <DashboardWidgets
              displayName={displayName}
              balance={balance}
              claimed={claimed}
              visitors={visitors}
              onClaimAction={claim}
              onOpenMusic={() => { setActiveApp("music"); setStatusOpen(false); }}
              onOpenRadio={() => { setActiveApp("radio"); setStatusOpen(false); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
