/**
 * Phase 10.7 — Responsive Completion Tests
 *
 * Verifies mobile navigation, mobile sheet, and responsive shell
 * behavior across viewport tiers.
 *
 * Phase 10.7 — Studio Control Plane V1
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  StudioMobileNavigation,
  StudioMobileSheet,
  StudioResponsiveShell,
  type MobileNavTab,
} from "../shell/StudioResponsive";
import { MessageSquare, Code, Eye, ListChecks } from "lucide-react";

const navTabs: MobileNavTab[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={20} /> },
  { id: "code", label: "Code", icon: <Code size={20} /> },
  { id: "preview", label: "Preview", icon: <Eye size={20} /> },
  { id: "review", label: "Review", icon: <ListChecks size={20} /> },
];

describe("Phase 10.7 — Responsive Completion", () => {
  describe("StudioMobileNavigation", () => {
    it("renders all nav tabs", () => {
      const { getByTestId } = render(
        <StudioMobileNavigation tabs={navTabs} activeTab="chat" onTabChange={() => {}} />,
      );
      expect(getByTestId("mobile-nav-chat")).toBeDefined();
      expect(getByTestId("mobile-nav-code")).toBeDefined();
      expect(getByTestId("mobile-nav-preview")).toBeDefined();
      expect(getByTestId("mobile-nav-review")).toBeDefined();
    });

    it("marks active tab with aria-current", () => {
      const { getByTestId } = render(
        <StudioMobileNavigation tabs={navTabs} activeTab="code" onTabChange={() => {}} />,
      );
      expect(getByTestId("mobile-nav-code").getAttribute("aria-current")).toBe("page");
      expect(getByTestId("mobile-nav-chat").getAttribute("aria-current")).toBeNull();
    });

    it("calls onTabChange when tab is clicked", () => {
      const onTabChange = vi.fn();
      const { getByTestId } = render(
        <StudioMobileNavigation tabs={navTabs} activeTab="chat" onTabChange={onTabChange} />,
      );
      fireEvent.click(getByTestId("mobile-nav-preview"));
      expect(onTabChange).toHaveBeenCalledWith("preview");
    });
  });

  describe("StudioMobileSheet", () => {
    it("renders when open", () => {
      const { getByTestId } = render(
        <StudioMobileSheet open={true} onClose={() => {}} title="Review">
          <div data-testid="sheet-content">Content</div>
        </StudioMobileSheet>,
      );
      expect(getByTestId("studio-mobile-sheet")).toBeDefined();
      expect(getByTestId("sheet-content")).toBeDefined();
    });

    it("does not render when closed", () => {
      const { queryByTestId } = render(
        <StudioMobileSheet open={false} onClose={() => {}} title="Review">
          <div>Content</div>
        </StudioMobileSheet>,
      );
      expect(queryByTestId("studio-mobile-sheet")).toBeNull();
    });

    it("shows title in header", () => {
      const { getByTestId } = render(
        <StudioMobileSheet open={true} onClose={() => {}} title="Inspector">
          <div />
        </StudioMobileSheet>,
      );
      expect(getByTestId("studio-mobile-sheet").textContent).toContain("Inspector");
    });

    it("calls onClose when close button is clicked", () => {
      const onClose = vi.fn();
      const { getByTestId } = render(
        <StudioMobileSheet open={true} onClose={onClose} title="Review">
          <div />
        </StudioMobileSheet>,
      );
      fireEvent.click(getByTestId("mobile-sheet-close"));
      expect(onClose).toHaveBeenCalled();
    });

    it("has aria-modal and role=dialog", () => {
      const { getByTestId } = render(
        <StudioMobileSheet open={true} onClose={() => {}} title="Review">
          <div />
        </StudioMobileSheet>,
      );
      const sheet = getByTestId("studio-mobile-sheet");
      expect(sheet.getAttribute("role")).toBe("dialog");
      expect(sheet.getAttribute("aria-modal")).toBe("true");
    });
  });

  describe("StudioResponsiveShell", () => {
    it("renders mobile shell with bottom nav", () => {
      const { getByTestId } = render(
        <StudioResponsiveShell
          tier="mobile"
          mobileNav={{ tabs: navTabs, activeTab: "chat", onTabChange: () => {} }}
        >
          <div data-testid="ws-content">Workspace</div>
        </StudioResponsiveShell>,
      );
      expect(getByTestId("responsive-shell-mobile")).toBeDefined();
      expect(getByTestId("ws-content")).toBeDefined();
      expect(getByTestId("studio-mobile-nav")).toBeDefined();
    });

    it("renders mobile shell with sheet when open", () => {
      const { getByTestId } = render(
        <StudioResponsiveShell
          tier="mobile"
          mobileNav={{ tabs: navTabs, activeTab: "chat", onTabChange: () => {} }}
          mobileSheet={{
            open: true,
            title: "Review",
            content: <div data-testid="sheet-content">Review content</div>,
          }}
          onMobileSheetClose={() => {}}
        >
          <div />
        </StudioResponsiveShell>,
      );
      expect(getByTestId("studio-mobile-sheet")).toBeDefined();
      expect(getByTestId("sheet-content")).toBeDefined();
    });

    it("does not render mobile sheet when closed", () => {
      const { queryByTestId } = render(
        <StudioResponsiveShell
          tier="mobile"
          mobileNav={{ tabs: navTabs, activeTab: "chat", onTabChange: () => {} }}
          mobileSheet={{
            open: false,
            title: "Review",
            content: <div />,
          }}
          onMobileSheetClose={() => {}}
        >
          <div />
        </StudioResponsiveShell>,
      );
      expect(queryByTestId("studio-mobile-sheet")).toBeNull();
    });

    it("renders desktop shell", () => {
      const { getByTestId } = render(
        <StudioResponsiveShell tier="desktop">
          <div data-testid="ws-content">Workspace</div>
        </StudioResponsiveShell>,
      );
      expect(getByTestId("responsive-shell-desktop")).toBeDefined();
      expect(getByTestId("ws-content")).toBeDefined();
    });

    it("renders laptop shell", () => {
      const { getByTestId } = render(
        <StudioResponsiveShell tier="laptop">
          <div />
        </StudioResponsiveShell>,
      );
      expect(getByTestId("responsive-shell-laptop")).toBeDefined();
    });

    it("renders tablet shell", () => {
      const { getByTestId } = render(
        <StudioResponsiveShell tier="tablet">
          <div />
        </StudioResponsiveShell>,
      );
      expect(getByTestId("responsive-shell-tablet")).toBeDefined();
    });
  });
});
