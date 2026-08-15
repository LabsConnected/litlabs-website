import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CameraSession from "./CameraSession";

const requestVideo = vi.fn();
const enumerateCameras = vi.fn();
const resetPermission = vi.fn();

vi.mock("../hooks/useMediaPermissions", () => ({
  useMediaPermissions: () => ({
    lastError: null,
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
});
