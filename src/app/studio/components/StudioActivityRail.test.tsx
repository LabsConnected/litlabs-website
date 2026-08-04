import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudioActivityRail from "@/app/studio/components/StudioActivityRail";
import type { ChatMessage } from "@/app/studio/stores/useStudioAgentStore";

const baseProps = {
  busy: false,
  activeAgentId: "litt" as const,
  projectName: "Test Project",
  modelLabel: "Test Model",
  terminalStatus: "connected" as const,
  repositoryName: "test-repo",
  branch: "main",
  onOpenTerminal: vi.fn(),
  onSelectAgent: vi.fn(),
};

function makeMessages(): ChatMessage[] {
  const t = 1_700_000_000_000;
  return [
    { id: "u1", role: "user", content: "Build the landing page please", createdAt: t },
    { id: "a1", role: "assistant", agentSlug: "litt", agentMode: "standard", content: "On it — scaffolding the landing page now.", status: "completed", createdAt: t + 1000 },
    { id: "u2", role: "user", content: "Now add a pricing section", createdAt: t + 2000 },
    { id: "a2", role: "assistant", agentSlug: "spark", agentMode: "spark", content: "Pricing section drafted.", status: "completed", createdAt: t + 3000 },
    { id: "a3", role: "assistant", agentSlug: "litt", agentMode: "standard", content: "oops", status: "failed", createdAt: t + 4000 },
  ];
}

/**
 * The Mission Timeline section is collapsed-open by default. Scope queries to
 * the section so unrelated "Activity" header text doesn't collide.
 */
function timeline() {
  return screen.getByText("Mission Timeline").closest("div")!;
}

describe("StudioActivityRail — Mission Timeline log controls", () => {
  it("derives timeline entries from conversation messages", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    // The rail shows the last 8 messages; user + assistant labels appear.
    expect(screen.getAllByText("User message sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/LiTT responded/).length).toBeGreaterThan(0);
    // Spark mode messages show "LiTT · Spark Mode responded"
    // Use getAllByText with a function matcher since the text may be split across elements
    expect(screen.getAllByText((_, node) =>
      Boolean(node?.textContent?.includes("Spark Mode") && node?.textContent?.includes("responded"))
    ).length).toBeGreaterThan(0);
  });

  it("Clear hides visible entries and confirms system history is preserved", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    expect(screen.getAllByText("User message sent").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Clear view/i }));

    // Visible entries are gone from the view…
    expect(screen.queryAllByText("User message sent").length).toBe(0);
    // …but the persistent-log confirmation is shown.
    expect(screen.getByText(/system history preserved/i)).toBeDefined();
  });

  it("Clear does not mutate the source messages (system history intact)", () => {
    const messages = makeMessages();
    render(<StudioActivityRail {...baseProps} messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear view/i }));
    // The caller still owns the full, unmodified history.
    expect(messages.length).toBe(5);
    expect(messages[0].content).toBe("Build the landing page please");
  });

  it("Clear completed archives only success entries, leaving errors visible", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    // Error entry is present before clearing completed.
    expect(screen.getByText(/Response failed/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Clear completed entries from view/i }));

    // Successful assistant responses are archived from view…
    expect(screen.queryByText(/Pricing section drafted/)).toBeNull();
    // …but the failed response stays (important failures are not silently dropped).
    expect(screen.getByText(/Response failed/)).toBeDefined();
  });

  it("Filter chips filter by source", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    // Open the filter row.
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const section = timeline();
    fireEvent.click(within(section).getByRole("button", { name: "User" }));

    expect(screen.getAllByText("User message sent").length).toBeGreaterThan(0);
    expect(screen.queryByText(/LiTT responded/)).toBeNull();
    expect(screen.queryAllByText((_, node) =>
      Boolean(node?.textContent?.includes("Spark Mode") && node?.textContent?.includes("responded"))
    ).length).toBe(0);
  });

  it("Search filters entries by label/detail", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const input = screen.getByLabelText("Search activity");
    // "drafted" only appears in the Spark response detail, not in any user message.
    fireEvent.change(input, { target: { value: "drafted" } });

    expect(screen.getByText(/Pricing section drafted/)).toBeDefined();
    expect(screen.queryAllByText("User message sent").length).toBe(0);
  });

  it("Errors filter shows only error entries", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Errors" }));

    expect(screen.getByText(/Response failed/)).toBeDefined();
    expect(screen.queryByText("User message sent")).toBeNull();
    expect(screen.queryByText(/Pricing section drafted/)).toBeNull();
  });

  it("Collapse all hides entry details", () => {
    render(<StudioActivityRail {...baseProps} messages={makeMessages()} />);
    const detail = "Pricing section drafted.";
    expect(screen.getByText(detail)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Collapse all entries/i }));

    expect(screen.queryByText(detail)).toBeNull();
  });
});
