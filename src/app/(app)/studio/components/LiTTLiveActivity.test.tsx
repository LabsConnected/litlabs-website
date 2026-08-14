import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LiTTLiveActivity from "./LiTTLiveActivity";
import {
  useExecutionStore,
  feedSSEEventToExecutionStore,
} from "../stores/useExecutionStore";

// Mock Clerk to avoid provider errors
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ user: null, isLoaded: true }),
  useAuth: () => ({ userId: null, isLoaded: true, getToken: async () => "test-token" }),
}));

// Mock WalletContext
vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 0 }),
}));

describe("LiTTLiveActivity", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("renders empty state when no events", () => {
    render(<LiTTLiveActivity />);
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  it("renders events from the execution store", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().addEvent({
        type: "tool_start",
        summary: "Reading file",
        toolId: "read_file",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("Reading file")).toBeTruthy();
  });

  it("shows phase label in header", () => {
    act(() => {
      useExecutionStore.getState().startRun();
    });

    render(<LiTTLiveActivity />);
    // Phase should be "planning" after startRun
    expect(screen.getByText("Planning")).toBeTruthy();
  });

  it("shows approval card when pendingApproval is set", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().setPendingApproval({
        toolId: "edit_file",
        reason: "File modification requires approval",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("Approval Required")).toBeTruthy();
    expect(screen.getByText("edit file")).toBeTruthy();
  });

  it("shows checkpoint banner when checkpoint is set", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().setCheckpoint({
        label: "pre-edit-checkpoint",
        gitSha: "abc123def456",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("pre-edit-checkpoint")).toBeTruthy();
    expect(screen.getByText("abc123d")).toBeTruthy();
  });

  it("shows finished state after run completes", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().addEvent({
        type: "tool_result",
        summary: "Read file successfully",
        toolId: "read_file",
        success: true,
        durationMs: 150,
      });
      useExecutionStore.getState().addEvent({
        type: "finished",
        summary: "Completed in 1 steps",
        step: 1,
      });
      useExecutionStore.getState().endRun();
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("Read file successfully")).toBeTruthy();
    expect(screen.getByText("Completed in 1 steps")).toBeTruthy();
  });

  it("feeds SSE events through feedSSEEventToExecutionStore", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "tool_execution",
        toolId: "read_file",
        summary: "Reading src/index.ts",
      });
      feedSSEEventToExecutionStore({
        type: "tool_execution",
        toolId: "read_file",
        success: true,
        summary: "Read src/index.ts",
        durationMs: 200,
      });
    });

    const events = useExecutionStore.getState().events;
    // Should have tool_start + tool_result
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe("tool_start");
    expect(events[1].type).toBe("tool_result");
  });

  it("shows Stop button while running", () => {
    const onStop = vi.fn();
    act(() => {
      useExecutionStore.getState().startRun();
    });

    render(<LiTTLiveActivity onStop={onStop} />);
    expect(screen.getByText("Stop")).toBeTruthy();
  });

  it("shows Rollback button when checkpoint exists and not running", () => {
    const onRollback = vi.fn();
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().setCheckpoint({
        label: "checkpoint-1",
        gitSha: "abc123",
      });
      useExecutionStore.getState().endRun();
    });

    render(<LiTTLiveActivity onRollback={onRollback} />);
    expect(screen.getByText("Rollback")).toBeTruthy();
  });

  it("calls onStop when Stop button is clicked", () => {
    const onStop = vi.fn();
    act(() => {
      useExecutionStore.getState().startRun();
    });

    render(<LiTTLiveActivity onStop={onStop} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });

  // ── New event type tests (regression for runtime plumbing fixes) ──

  it("renders model_routing events from SSE", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "model_routing",
        model: "google/gemini-2.5-flash",
        provider: "openrouter",
        fallbackFrom: "openai/gpt-4o",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText(/Switched to google\/gemini-2.5-flash/)).toBeTruthy();
  });

  it("renders model_failed events from SSE", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "model_failed",
        model: "openai/gpt-4o",
        category: "all_fallbacks_exhausted",
        message: "All models failed",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText(/Model openai\/gpt-4o failed/)).toBeTruthy();
  });

  it("renders reasoning/status summary events from SSE", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "reasoning",
        summary: "Inspecting project structure to find landing page components",
      });
      feedSSEEventToExecutionStore({
        type: "status",
        summary: "Step 1: reasoning with google/gemini-2.5-flash",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("Inspecting project structure to find landing page components")).toBeTruthy();
    expect(screen.getByText("Step 1: reasoning with google/gemini-2.5-flash")).toBeTruthy();
  });

  it("renders repair_attempt events from SSE", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "repair_attempt",
        attempt: 1,
        maxAttempts: 3,
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText("Repair attempt 1/3")).toBeTruthy();
  });

  it("model_routing without fallback shows 'Using' instead of 'Switched to'", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      feedSSEEventToExecutionStore({
        type: "model_routing",
        model: "google/gemini-2.5-flash",
        provider: "openrouter",
      });
    });

    render(<LiTTLiveActivity />);
    expect(screen.getByText(/Using google\/gemini-2.5-flash/)).toBeTruthy();
  });
});
