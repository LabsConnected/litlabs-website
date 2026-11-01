import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ConversationActivityCards from "./ConversationActivityCards";

describe("ConversationActivityCards", () => {
  it("renders truthful completed, running, and failed states", () => {
    render(
      <ConversationActivityCards
        messageStatus="streaming"
        activity={[
          { toolId: "browser_session", summary: "Opening browser", success: true },
          { toolId: "terminal", summary: "Running tests" },
          { toolId: "preview", summary: "Preview failed", success: false },
        ]}
      />,
    );

    expect(screen.getByText("Opening browser")).toBeVisible();
    expect(screen.getByText("Running tests")).toBeVisible();
    expect(screen.getByText("Preview failed")).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByText("In progress")).toBeVisible();
    expect(screen.getByText("Needs attention")).toBeVisible();
  });

  it("does not promote an outcome-less historical record to completed", () => {
    render(
      <ConversationActivityCards
        messageStatus="completed"
        activity={[{ toolId: "files", summary: "Reading project files" }]}
      />,
    );

    expect(screen.getByText("Recorded")).toBeVisible();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });
});
