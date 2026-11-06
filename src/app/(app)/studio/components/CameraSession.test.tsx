import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CameraSession from "./CameraSession";

const requestVideo = vi.fn();
const enumerateCameras = vi.fn();
const resetPermission = vi.fn();
const hookState = {
  lastError: null as { type: "video"; code: string; message: string } | null,
};

vi.mock("../hooks/useMediaPermissions", () => ({
  useMediaPermissions: () => ({
    lastError: hookState.lastError,
    permission: { audio: "prompt", video: "prompt" },
    requestVideo,
    enumerateCameras,
    resetPermission,
  }),
}));

describe("CameraSession", () => {
  beforeEach(() => {
    requestVideo.mockReset();
    enumerateCameras.mockReset();
    resetPermission.mockReset();
    enumerateCameras.mockResolvedValue([]);
    hookState.lastError = null;
  });

  it("attaches a granted stream after the video element mounts", async () => {
    const stream = {
      getTracks: () => [
        { readyState: "live", addEventListener: vi.fn(), stop: vi.fn(), removeEventListener: vi.fn() },
      ],
      getVideoTracks: () => [
        { readyState: "live", addEventListener: vi.fn(), stop: vi.fn(), removeEventListener: vi.fn() },
      ],
    } as unknown as MediaStream;
    requestVideo.mockResolvedValue(stream);

    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(<CameraSession />);
    fireEvent.click(screen.getByRole("button", { name: /start camera/i }));

    const video = await waitFor(() => {
      const element = document.querySelector("video");
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });

    await waitFor(() => {
      expect(video.srcObject).toBe(stream);
    });
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  it("shows error state when stream acquisition fails", async () => {
    requestVideo.mockResolvedValue(null);

    render(<CameraSession />);
    fireEvent.click(screen.getByRole("button", { name: /start camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not access the camera/i)).toBeTruthy();
    });
  });

  it("labels a missing camera as 'No camera found', not generic 'Camera error'", async () => {
    hookState.lastError = {
      type: "video",
      code: "no_device",
      message: "No camera was detected on this device.",
    };
    requestVideo.mockResolvedValue(null);

    render(<CameraSession />);
    fireEvent.click(screen.getByRole("button", { name: /start camera/i }));

    expect(await screen.findByText("No camera found")).toBeInTheDocument();
    expect(screen.queryByText("Camera error")).not.toBeInTheDocument();
  });

  it("labels denied permission as 'Permission required'", async () => {
    hookState.lastError = {
      type: "video",
      code: "permission_denied",
      message:
        "Camera permission was denied. Please allow access in your browser settings.",
    };
    requestVideo.mockResolvedValue(null);

    render(<CameraSession />);
    fireEvent.click(screen.getByRole("button", { name: /start camera/i }));

    expect(await screen.findByText("Permission required")).toBeInTheDocument();
  });
});
