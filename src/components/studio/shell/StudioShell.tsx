"use client";

import { useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useStudioStore } from "@/stores/useStudioStore";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { RightPanel } from "../inspector/RightPanel";
import { BottomDock } from "./BottomDock";
import { WorkspaceCanvas } from "../canvas/WorkspaceCanvas";
import { CommandBar } from "../command/CommandBar";

export function StudioShell() {
  const {
    leftRailOpen,
    rightPanelOpen,
    bottomDockOpen,
    focusMode,
    commandBarOpen,
    toggleCommandBar,
    toggleFocusMode,
  } = useStudioStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCommandBar();
      }
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        toggleFocusMode();
      }
      if (e.key === "Escape" && commandBarOpen) {
        toggleCommandBar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandBar, toggleFocusMode, commandBarOpen]);

  if (focusMode) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#07050a]">
        <TopBar />
        <div className="relative flex-1 overflow-hidden">
          <WorkspaceCanvas />
        </div>
        {commandBarOpen && <CommandBar />}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#07050a]">
      <TopBar />

      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal" className="h-full w-full">
          {leftRailOpen && (
            <>
              <Panel
                defaultSize="18"
                minSize="240"
                maxSize="30"
                className="border-r border-white/5"
              >
                <LeftRail />
              </Panel>
              <Separator className="w-px bg-white/5 hover:bg-[#8b5cf6]/40 transition-colors" />
            </>
          )}

          <Panel>
            <Group orientation="vertical" className="h-full w-full">
              <Panel minSize="30">
                <WorkspaceCanvas />
              </Panel>

              {bottomDockOpen && (
                <>
                  <Separator className="h-px bg-white/5 hover:bg-[#8b5cf6]/40 transition-colors" />
                  <Panel
                    defaultSize="25"
                    minSize="200"
                    maxSize="50"
                  >
                    <BottomDock />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>

          {rightPanelOpen && (
            <>
              <Separator className="w-px bg-white/5 hover:bg-[#8b5cf6]/40 transition-colors" />
              <Panel
                defaultSize="22"
                minSize="320"
                maxSize="40"
                className="border-l border-white/5"
              >
                <RightPanel />
              </Panel>
            </>
          )}
        </Group>
      </div>

      {commandBarOpen && <CommandBar />}
    </div>
  );
}
