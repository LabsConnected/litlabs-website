import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import FirstRunWelcome from "./FirstRunWelcome";

vi.mock("./LiTTPresence", () => ({
  default: () => <div data-testid="litt-presence" />,
}));

describe("FirstRunWelcome", () => {
  it("renders welcome headline and prompt", () => {
    render(
      <FirstRunWelcome
        onSubmit={vi.fn()}
        isCreating={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("Welcome to LiTT")).toBeInTheDocument();
    expect(screen.getByText("What do you want to build?")).toBeInTheDocument();
    expect(screen.getByTestId("first-run-idea-input")).toBeInTheDocument();
    expect(screen.getByTestId("first-run-submit")).toBeInTheDocument();
  });

  it("personalizes welcome with display name", () => {
    render(
      <FirstRunWelcome
        displayName="Larry"
        onSubmit={vi.fn()}
        isCreating={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("Welcome, Larry")).toBeInTheDocument();
  });

  it("disables submit when idea is empty", () => {
    render(
      <FirstRunWelcome
        onSubmit={vi.fn()}
        isCreating={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId("first-run-submit")).toBeDisabled();
  });

  it("calls onSubmit with trimmed idea", () => {
    const onSubmit = vi.fn();
    render(
      <FirstRunWelcome
        onSubmit={onSubmit}
        isCreating={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("first-run-idea-input"), {
      target: { value: "  A roofing website  " },
    });
    fireEvent.click(screen.getByTestId("first-run-submit"));
    expect(onSubmit).toHaveBeenCalledWith("A roofing website");
  });

  it("shows creating state", () => {
    render(
      <FirstRunWelcome
        onSubmit={vi.fn()}
        isCreating={true}
        error={null}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText("Creating your project…")).toBeInTheDocument();
    expect(screen.getByTestId("first-run-submit")).toBeDisabled();
  });

  it("shows error with retry", () => {
    const onRetry = vi.fn();
    render(
      <FirstRunWelcome
        onSubmit={vi.fn()}
        isCreating={false}
        error="Network failed"
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId("first-run-error")).toBeInTheDocument();
    expect(screen.getByText("Network failed")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("first-run-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("has no competing CTAs — single action only", () => {
    render(
      <FirstRunWelcome
        onSubmit={vi.fn()}
        isCreating={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    // Only one submit button, no "Start blank" or "Connect GitHub" links
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
