"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function WorkspaceShell({
  children,
  className,
  rightPanel,
  rightPanelWidth = "320px",
  rightPanelOpen = false,
}: {
  children: React.ReactNode;
  className?: string;
  rightPanel?: React.ReactNode;
  rightPanelWidth?: string;
  rightPanelOpen?: boolean;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn("flex min-h-screen", className)}
      style={{ backgroundColor: tokens.background, color: tokens.text }}
    >
      <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
        {children}
      </main>
      {rightPanel && (
        <aside
          className={cn(
            "hidden shrink-0 border-l transition-all duration-300 lg:block",
            rightPanelOpen ? "p-4" : "p-0",
          )}
          style={{
            width: rightPanelOpen ? rightPanelWidth : "0px",
            borderColor: tokens.border,
            backgroundColor: tokens.surface,
          }}
        >
          {rightPanelOpen && rightPanel}
        </aside>
      )}
    </div>
  );
}
