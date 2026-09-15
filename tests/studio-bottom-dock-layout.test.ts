import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandStudio = readFileSync("src/app/(app)/studio/components/CommandStudio.tsx", "utf8");
const frame = readFileSync("src/app/(app)/studio/components/StudioWorkspaceFrame.tsx", "utf8");

describe("Studio bottom-dock layout", () => {
  it("exposes the exact canonical primary workspace tabs", () => {
    for (const label of ["Plan", "Canvas", "Code", "Preview", "Media", "Files", "Assets", "Inspector"]) {
      expect(commandStudio).toContain(`label: "${label}"`);
    }
  });

  it("uses one desktop dock for all utility tabs", () => {
    const drawerTabs = frame.slice(frame.indexOf("const DRAWER_TABS"), frame.indexOf("export interface StudioInspectorData"));
    for (const label of ["Activity", "Terminal"]) {
      expect(drawerTabs).toContain(`label: "${label}"`);
    }
    expect(drawerTabs).not.toContain('{ id: "work", label: "Work"');
    expect(drawerTabs).not.toContain('{ id: "files", label: "Files"');
    expect(commandStudio).not.toContain('position="left"');
    expect(commandStudio).toContain('!isMobileLitt && (');
  });

  it("collapses the dock when its active tab is clicked again", () => {
    expect(frame).toContain("activeTab === t.id");
    expect(frame).toContain('setView("collapsed")');
  });

  it("keeps terminal mounted while the dock changes tabs", () => {
    expect(commandStudio).toContain("Keep the terminal mounted");
    expect(commandStudio).toContain("drawerTab === \"terminal\"");
    expect(commandStudio).toContain("StudioTerminalDrawer");
  });
});
