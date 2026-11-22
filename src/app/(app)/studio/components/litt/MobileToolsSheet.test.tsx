import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MobileToolsSheet from "./MobileToolsSheet";

describe("MobileToolsSheet", () => {
  function renderSheet() {
    const handlers = {
      onOpenCode: vi.fn(),
      onOpenCanvas: vi.fn(),
      onOpenPreview: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenTerminal: vi.fn(),
      onOpenActivity: vi.fn(),
      onOpenImage: vi.fn(),
      onOpenVideo: vi.fn(),
      onOpenAudio: vi.fn(),
      onOpenMusic: vi.fn(),
    };
    render(<MobileToolsSheet {...handlers} />);
    return handlers;
  }

  it("renders the Create tile grid with media tools", () => {
    renderSheet();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    for (const id of ["image", "video", "audio", "music"]) {
      expect(screen.getByTestId(`mobile-tool-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText("Generate images")).toBeInTheDocument();
    expect(screen.getByText("Generate video")).toBeInTheDocument();
    expect(screen.getByText("Voiceover & speech")).toBeInTheDocument();
    expect(screen.getByText("Generate music")).toBeInTheDocument();
  });

  it("routes each create tile to its handler", () => {
    const handlers = renderSheet();
    fireEvent.click(screen.getByTestId("mobile-tool-image"));
    expect(handlers.onOpenImage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-video"));
    expect(handlers.onOpenVideo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-audio"));
    expect(handlers.onOpenAudio).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-music"));
    expect(handlers.onOpenMusic).toHaveBeenCalledTimes(1);
  });

  it("renders all six build tool rows with descriptions", () => {
    renderSheet();
    for (const id of ["code", "canvas", "preview", "files", "terminal", "activity"]) {
      expect(screen.getByTestId(`mobile-tool-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText("Browse and edit workspace files")).toBeInTheDocument();
    expect(screen.getByText("Visual canvas builder")).toBeInTheDocument();
    expect(screen.getByText("Live preview of your project")).toBeInTheDocument();
    expect(screen.getByText("Project file browser")).toBeInTheDocument();
    expect(screen.getByText("Run commands in the workspace")).toBeInTheDocument();
    expect(screen.getByText("Agent activity and tool calls")).toBeInTheDocument();
  });

  it("routes each row to its handler", () => {
    const handlers = renderSheet();
    fireEvent.click(screen.getByTestId("mobile-tool-code"));
    expect(handlers.onOpenCode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-canvas"));
    expect(handlers.onOpenCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-preview"));
    expect(handlers.onOpenPreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-files"));
    expect(handlers.onOpenFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-terminal"));
    expect(handlers.onOpenTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-tool-activity"));
    expect(handlers.onOpenActivity).toHaveBeenCalledTimes(1);
  });

  describe("chat-bar cleanup entries (Larry, 2026-11-20)", () => {
    const baseHandlers = {
      onOpenCode: vi.fn(),
      onOpenCanvas: vi.fn(),
      onOpenPreview: vi.fn(),
      onOpenFiles: vi.fn(),
      onOpenTerminal: vi.fn(),
      onOpenActivity: vi.fn(),
      onOpenImage: vi.fn(),
      onOpenVideo: vi.fn(),
      onOpenAudio: vi.fn(),
      onOpenMusic: vi.fn(),
    };

    it("hides the tucked-in entries when their handlers are not provided", () => {
      render(<MobileToolsSheet {...baseHandlers} />);
      expect(screen.queryByTestId("mobile-tool-selector")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-tool-build-status")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-tool-export-chat")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-execution-mode")).not.toBeInTheDocument();
    });

    it("routes Assistant & model, Build status, and Export chat to their handlers", () => {
      const onOpenSelector = vi.fn();
      const onOpenBuildStatus = vi.fn();
      const onExportChat = vi.fn();
      render(
        <MobileToolsSheet
          {...baseHandlers}
          onOpenSelector={onOpenSelector}
          onOpenBuildStatus={onOpenBuildStatus}
          onExportChat={onExportChat}
        />,
      );
      fireEvent.click(screen.getByTestId("mobile-tool-selector"));
      expect(onOpenSelector).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId("mobile-tool-build-status"));
      expect(onOpenBuildStatus).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId("mobile-tool-export-chat"));
      expect(onExportChat).toHaveBeenCalledTimes(1);
    });

    it("shows the execution mode segmented control and switches modes", () => {
      const onExecutionModeChange = vi.fn();
      render(
        <MobileToolsSheet
          {...baseHandlers}
          executionMode="act"
          onExecutionModeChange={onExecutionModeChange}
        />,
      );
      expect(screen.getByTestId("mobile-execution-mode-act")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mobile-execution-mode-plan")).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByTestId("mobile-execution-mode-plan"));
      expect(onExecutionModeChange).toHaveBeenCalledWith("plan");
    });
  });
});
