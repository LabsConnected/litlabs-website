import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  MessageEventCard,
  PlanCard,
  ActivityCard,
  ApprovalCard,
  CompletionCard,
  ErrorCard,
  ArtifactCard,
  ToolResultCard,
} from "./MessageEventCards";
import type { MessageEventData } from "../types/conversation";

// Mock useTheme to avoid theme context requirements
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ tokens: { background: "#000", text: "#fff" } }),
}));

describe("MessageEventCards — Phase 2.6 structured event cards", () => {
  // 1. PlanCard renders steps
  it("PlanCard renders all steps with status indicators", () => {
    render(
      <PlanCard
        steps={[
          { id: "s1", label: "Read files", status: "complete" },
          { id: "s2", label: "Write code", status: "in-progress" },
          { id: "s3", label: "Deploy", status: "pending" },
        ]}
      />,
    );
    expect(screen.getByTestId("plan-card")).toBeTruthy();
    expect(screen.getByText("Read files")).toBeTruthy();
    expect(screen.getByText("Write code")).toBeTruthy();
    expect(screen.getByText("Deploy")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  // 2. ActivityCard renders action and detail
  it("ActivityCard renders action and optional detail", () => {
    render(<ActivityCard action="Reading files" detail="Found 12 files" />);
    expect(screen.getByTestId("activity-card")).toBeTruthy();
    expect(screen.getByText("Reading files")).toBeTruthy();
    expect(screen.getByText("Found 12 files")).toBeTruthy();
  });

  // 3. ApprovalCard renders title, description, and actions
  it("ApprovalCard renders approval request with actions", () => {
    render(
      <ApprovalCard
        request={{
          id: "apr-1",
          title: "Deploy to production?",
          description: "This will push changes to the live site.",
          actions: [
            { id: "yes", label: "Approve", type: "approve" },
            { id: "no", label: "Reject", type: "reject" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("approval-card")).toBeTruthy();
    expect(screen.getByText("Deploy to production?")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Reject")).toBeTruthy();
  });

  // 4. CompletionCard renders summary and artifacts
  it("CompletionCard renders summary and artifact tags", () => {
    render(<CompletionCard summary="Build complete" artifacts={["app.tsx", "styles.css"]} />);
    expect(screen.getByTestId("completion-card")).toBeTruthy();
    expect(screen.getByText("Build complete")).toBeTruthy();
    expect(screen.getByText("app.tsx")).toBeTruthy();
    expect(screen.getByText("styles.css")).toBeTruthy();
  });

  // 5. ErrorCard renders code, message, and recoverable hint
  it("ErrorCard renders error code and message", () => {
    render(<ErrorCard code="E_TIMEOUT" message="Request timed out" recoverable={true} />);
    expect(screen.getByTestId("error-card")).toBeTruthy();
    expect(screen.getByText("E_TIMEOUT")).toBeTruthy();
    expect(screen.getByText("Request timed out")).toBeTruthy();
  });

  // 6. ArtifactCard renders name and type
  it("ArtifactCard renders artifact name and type", () => {
    render(<ArtifactCard artifactType="typescript" name="component.tsx" url="https://example.com" />);
    expect(screen.getByTestId("artifact-card")).toBeTruthy();
    expect(screen.getByText("component.tsx")).toBeTruthy();
    expect(screen.getByText("typescript")).toBeTruthy();
  });

  // 7. ToolResultCard renders tool name and result
  it("ToolResultCard renders tool name and result output", () => {
    render(<ToolResultCard tool="shell" result="Build succeeded" exitCode={0} />);
    expect(screen.getByTestId("tool-result-card")).toBeTruthy();
    expect(screen.getByText(/shell/i)).toBeTruthy();
    expect(screen.getByText("Build succeeded")).toBeTruthy();
  });

  // 8. MessageEventCard dispatcher routes to correct card
  it("MessageEventCard dispatcher renders PlanCard for plan events", () => {
    const event: MessageEventData = {
      type: "plan",
      steps: [{ id: "s1", label: "Step 1", status: "pending" }],
    };
    const { rerender } = render(<MessageEventCard event={event} />);
    expect(screen.getByTestId("plan-card")).toBeTruthy();
  });

  it("MessageEventCard dispatcher renders ErrorCard for error events", () => {
    const event: MessageEventData = {
      type: "error",
      code: "E_FAIL",
      message: "Something broke",
      recoverable: false,
    };
    render(<MessageEventCard event={event} />);
    expect(screen.getByTestId("error-card")).toBeTruthy();
  });

  it("MessageEventCard dispatcher renders CompletionCard for completion events", () => {
    const event: MessageEventData = {
      type: "completion",
      summary: "All done",
    };
    render(<MessageEventCard event={event} />);
    expect(screen.getByTestId("completion-card")).toBeTruthy();
  });
});
