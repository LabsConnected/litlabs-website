import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandStudio = readFileSync("src/app/(app)/studio/components/CommandStudio.tsx", "utf8");
const frame = readFileSync("src/app/(app)/studio/components/StudioWorkspaceFrame.tsx", "utf8");

describe("Studio bottom-dock layout", () => {
  it("keeps the primary workspace focused on Plan, Canvas, Code, and Preview", () => {
    expect(commandStudio).toContain('{ id: "plan", label: "Plan" }');
    expect(commandStudio).toContain('{ id: "canvas", label: "Canvas" }');
    expect(commandStudio).toContain('{ id: "code", label: "Code" }');
    expect(commandStudio).toContain('{ id: "preview", label: "Preview" }');
    expect(commandStudio).not.toContain('{ id: "media", label: "Media" }');
  });

  it("uses one desktop dock for all utility tabs", () => {
    for (const label of ["Activity", "Work", "Files", "Inspector", "Terminal", "Media", "Assets"]) {
      expect(frame).toContain(`label: "${label}"`);
    }
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
