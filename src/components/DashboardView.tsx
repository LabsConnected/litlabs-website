"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useSearchParams } from "next/navigation";
import { Activity, X, PanelLeft, PanelRight } from "lucide-react";
import { CenterStage } from "@/components/dashboard/DashboardCards";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";
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
  const [statusOpen, setStatusOpen] = useState(false);
  const [widgetSide, setWidgetSide] = useState<"left" | "right">(() => {
    if (typeof window === "undefined") return "right";
    const saved = localStorage.getItem("dashboard_widget_side");
    return saved === "left" ? "left" : "right";
  });

  const toggleWidgetSide = () => {
    const next = widgetSide === "right" ? "left" : "right";
    setWidgetSide(next);
    localStorage.setItem("dashboard_widget_side", next);
  };

  const activeApp = appFromUrl ?? manualApp;
  const setActiveApp = (app: string) => setManualApp(app);

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Main column: top bar + content + right rail */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Slim top bar — global actions only */}
        <Navbar />

        <div className="flex flex-1 min-h-0">
          {/* Left rail — shown when widgetSide === "left" */}
          {widgetSide === "left" && (
            <div className="relative">
              <button
                onClick={toggleWidgetSide}
                className="absolute top-3 right-2 z-10 p-1.5 rounded-lg transition-all hover:bg-white/10"
                style={{ color: T.textMuted }}
                title="Move panel to right"
              >
                <PanelRight size={13} />
              </button>
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
          )}

          {/* Center content */}
          <main
            className={`flex-1 min-w-0 p-4 lg:p-6 ${
              activeApp === "jarvis"
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto"
            }`}
          >
            <CenterStage
              activeApp={activeApp}
              displayName={displayName}
              onAppChange={setActiveApp}
            />
          </main>

          {/* Right rail — shown when widgetSide === "right" */}
          {widgetSide === "right" && (
            <div className="relative">
              <button
                onClick={toggleWidgetSide}
                className="absolute top-3 left-2 z-10 p-1.5 rounded-lg transition-all hover:bg-white/10"
                style={{ color: T.textMuted }}
                title="Move panel to left"
              >
                <PanelLeft size={13} />
              </button>
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
          )}
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
