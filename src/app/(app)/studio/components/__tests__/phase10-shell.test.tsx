/**
 * Phase 10.3 — Permanent Shell Tests
 *
 * Verifies the 5-region layout renders correctly and each region
 * is present with the right ARIA roles.
 *
 * Phase 10.3 — Studio Control Plane V1
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StudioShell } from "../shell/StudioShell";
import { StudioContextBar } from "../shell/StudioContextBar";
import { StudioProductRail, type RailDestination } from "../shell/StudioProductRail";
import { StudioWorkspace } from "../shell/StudioWorkspace";
import { StudioInspector, type InspectorTabId } from "../shell/StudioInspector";
import { StudioComposer } from "../shell/StudioComposer";
import { MessageSquare, Code, Eye, FolderOpen, Sparkles, Bot, Play } from "lucide-react";

const destinations: RailDestination[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { id: "code", label: "Code", icon: <Code size={16} /> },
  { id: "preview", label: "Preview", icon: <Eye size={16} /> },
  { id: "files", label: "Files", icon: <FolderOpen size={16} /> },
];

describe("Phase 10.3 — Permanent Shell", () => {
  describe("StudioShell", () => {
    it("renders all 5 regions", () => {
      const { getByTestId } = render(
        <StudioShell
          project="litlabs-website"
          branch="feat/test"
          headSha="abc123"
          railDestinations={destinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          workspaceContent={<div>workspace content</div>}
          inspectorActiveTab="plan"
          onInspectorTabChange={() => {}}
          renderInspectorTab={() => <div>inspector content</div>}
          composerContent={<div>composer content</div>}
        />,
      );

      expect(getByTestId("studio-shell")).toBeDefined();
      expect(getByTestId("studio-context-bar")).toBeDefined();
      expect(getByTestId("studio-product-rail")).toBeDefined();
      expect(getByTestId("studio-workspace")).toBeDefined();
      expect(getByTestId("studio-inspector")).toBeDefined();
      expect(getByTestId("studio-composer")).toBeDefined();
    });

    it("passes project/branch/SHA to context bar", () => {
      const { getByTestId } = render(
        <StudioShell
          project="my-project"
          branch="main"
          headSha="def456"
          railDestinations={destinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          workspaceContent={<div />}
          inspectorActiveTab="plan"
          onInspectorTabChange={() => {}}
          renderInspectorTab={() => <div />}
          composerContent={<div />}
        />,
      );

      expect(getByTestId("context-bar-project").textContent).toBe("my-project");
      expect(getByTestId("context-bar-branch").textContent).toBe("main");
      expect(getByTestId("context-bar-sha").textContent).toBe("def456");
    });
  });

  describe("StudioContextBar", () => {
    it("renders with all status items", () => {
      const { getByTestId } = render(
        <StudioContextBar
          project="test"
          branch="feat/x"
          headSha="abc"
          runtimeStatus={{ label: "Ready", tone: "success" }}
          model="gpt-4"
          runState={{ label: "Running", tone: "info" }}
          reviewStatus={{ label: "Approved", tone: "success" }}
          connectionHealthy={true}
        />,
      );

      expect(getByTestId("context-bar-project").textContent).toBe("test");
      expect(getByTestId("context-bar-model").textContent).toBe("gpt-4");
      expect(getByTestId("context-bar-connection")).toBeDefined();
    });

    it("renders without optional items", () => {
      const { getByTestId } = render(<StudioContextBar />);
      expect(getByTestId("studio-context-bar")).toBeDefined();
    });
  });

  describe("StudioProductRail", () => {
    it("renders all destinations", () => {
      const { getByTestId } = render(
        <StudioProductRail
          destinations={destinations}
          activeDestination="code"
          onDestinationChange={() => {}}
        />,
      );

      expect(getByTestId("rail-chat")).toBeDefined();
      expect(getByTestId("rail-code")).toBeDefined();
      expect(getByTestId("rail-preview")).toBeDefined();
      expect(getByTestId("rail-files")).toBeDefined();
    });

    it("marks active destination with aria-current", () => {
      const { getByTestId } = render(
        <StudioProductRail
          destinations={destinations}
          activeDestination="code"
          onDestinationChange={() => {}}
        />,
      );

      expect(getByTestId("rail-code").getAttribute("aria-current")).toBe("page");
      expect(getByTestId("rail-chat").getAttribute("aria-current")).toBeNull();
    });

    it("calls onDestinationChange when clicked", () => {
      let clicked = "";
      const { getByTestId } = render(
        <StudioProductRail
          destinations={destinations}
          activeDestination="chat"
          onDestinationChange={(id) => { clicked = id; }}
        />,
      );

      getByTestId("rail-code").click();
      expect(clicked).toBe("code");
    });

    it("renders secondary destinations", () => {
      const { getByTestId } = render(
        <StudioProductRail
          destinations={destinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          secondaryDestinations={[
            { id: "assets", label: "Assets", icon: <Sparkles size={16} /> },
            { id: "agents", label: "Agents", icon: <Bot size={16} /> },
          ]}
        />,
      );

      expect(getByTestId("rail-secondary-assets")).toBeDefined();
      expect(getByTestId("rail-secondary-agents")).toBeDefined();
    });
  });

  describe("StudioWorkspace", () => {
    it("renders content", () => {
      const { getByTestId } = render(
        <StudioWorkspace>
          <div data-testid="ws-content">Hello</div>
        </StudioWorkspace>,
      );
      expect(getByTestId("ws-content")).toBeDefined();
    });

    it("renders split view when enabled", () => {
      const { getByTestId } = render(
        <StudioWorkspace split={true} splitView={<div data-testid="ws-split">Split</div>}>
          <div data-testid="ws-content">Main</div>
        </StudioWorkspace>,
      );
      expect(getByTestId("studio-workspace-split")).toBeDefined();
      expect(getByTestId("ws-content")).toBeDefined();
      expect(getByTestId("ws-split")).toBeDefined();
    });
  });

  describe("StudioInspector", () => {
    it("renders all 6 permanent tabs", () => {
      const { getByTestId } = render(
        <StudioInspector
          activeTab="plan"
          onTabChange={() => {}}
          renderTab={() => <div>content</div>}
        />,
      );
      expect(getByTestId("studio-tab-plan")).toBeDefined();
      expect(getByTestId("studio-tab-activity")).toBeDefined();
      expect(getByTestId("studio-tab-changes")).toBeDefined();
      expect(getByTestId("studio-tab-checks")).toBeDefined();
      expect(getByTestId("studio-tab-acceptance")).toBeDefined();
      expect(getByTestId("studio-tab-review")).toBeDefined();
    });

    it("renders tab content for active tab", () => {
      const { getByTestId } = render(
        <StudioInspector
          activeTab="checks"
          onTabChange={() => {}}
          renderTab={(tab) => <div data-testid={`tab-content-${tab}`}>{tab}</div>}
        />,
      );
      expect(getByTestId("tab-content-checks")).toBeDefined();
    });

    it("calls onTabChange when tab is clicked", () => {
      let activeTab: InspectorTabId = "plan";
      const { getByTestId } = render(
        <StudioInspector
          activeTab={activeTab}
          onTabChange={(tab) => { activeTab = tab; }}
          renderTab={() => <div />}
        />,
      );
      getByTestId("studio-tab-changes").click();
      expect(activeTab).toBe("changes");
    });

    it("collapses when open is false", () => {
      const { getByTestId } = render(
        <StudioInspector
          activeTab="plan"
          onTabChange={() => {}}
          renderTab={() => <div />}
          open={false}
        />,
      );
      const inspector = getByTestId("studio-inspector");
      expect(inspector.style.width).toBe("0px");
    });
  });

  describe("StudioComposer", () => {
    it("renders composer content", () => {
      const { getByTestId } = render(
        <StudioComposer>
          <div data-testid="composer-input">Input</div>
        </StudioComposer>,
      );
      expect(getByTestId("studio-composer")).toBeDefined();
      expect(getByTestId("composer-input")).toBeDefined();
    });

    it("renders run progress when provided", () => {
      const { getByTestId } = render(
        <StudioComposer runProgress={<div>Building...</div>}>
          <div />
        </StudioComposer>,
      );
      expect(getByTestId("composer-run-progress")).toBeDefined();
    });
  });
});
