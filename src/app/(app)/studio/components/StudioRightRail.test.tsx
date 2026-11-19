import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import StudioRightRail, { type StudioRailTab } from "./StudioRightRail";

function RailHarness() {
  const [tab, setTab] = useState<StudioRailTab>("files");
  return (
    <StudioRightRail
      activeTab={tab}
      onTabChange={setTab}
      filesContent={<div data-testid="files-slot">Files surface</div>}
      activityContent={<div data-testid="activity-slot">Activity surface</div>}
      checksContent={<div data-testid="checks-slot">Checks surface</div>}
      approvalsContent={<div data-testid="approvals-slot">Approvals surface</div>}
    />
  );
}

describe("StudioRightRail (mockup port — Regular layout right rail)", () => {
  it("renders the mockup's four tabs: Files · Activity · Checks · Approvals", () => {
    render(<RailHarness />);
    for (const id of ["files", "activity", "checks", "approvals"]) {
      expect(screen.getByTestId(`studio-rail-tab-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("studio-rail-tab-files")).toHaveTextContent("Files");
    expect(screen.getByTestId("studio-rail-tab-activity")).toHaveTextContent("Activity");
    expect(screen.getByTestId("studio-rail-tab-checks")).toHaveTextContent("Checks");
    expect(screen.getByTestId("studio-rail-tab-approvals")).toHaveTextContent("Approvals");
  });

  it("starts on Files and switches the visible pane per tab, keeping every pane mounted", () => {
    render(<RailHarness />);
    expect(screen.getByTestId("studio-rail-pane-files")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("studio-rail-pane-checks")).toHaveAttribute("data-active", "false");

    fireEvent.click(screen.getByTestId("studio-rail-tab-checks"));
    expect(screen.getByTestId("studio-rail-tab-checks")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("studio-rail-pane-checks")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("studio-rail-pane-files")).toHaveAttribute("data-active", "false");
    // Panes stay mounted (visibility pattern) — no content is lost on switch.
    expect(screen.getByTestId("files-slot")).toBeInTheDocument();
    expect(screen.getByTestId("checks-slot")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("studio-rail-tab-approvals"));
    expect(screen.getByTestId("studio-rail-pane-approvals")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("approvals-slot")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("studio-rail-tab-activity"));
    expect(screen.getByTestId("studio-rail-pane-activity")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("activity-slot")).toBeInTheDocument();
  });
});
