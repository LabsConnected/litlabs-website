import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CameraPreview from "./CameraPreview";

function makeTrack(deviceId: string) {
  return {
    kind: "video",
    readyState: "live",
    enabled: true,
    getSettings: () => ({ deviceId }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  };
}

function makeStream(deviceId: string) {
  const track = makeTrack(deviceId);
  return {
    track,
    stream: {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
    } as unknown as MediaStream,
  };
}

const USB_CAM = { deviceId: "usb-cam", kind: "videoinput", label: "USB Webcam" };
const BUILTIN = { deviceId: "builtin", kind: "videoinput", label: "Integrated Camera" };

let getUserMedia: ReturnType<typeof vi.fn>;
let mediaDevices: EventTarget & MediaDevices;

function installMediaDevices() {
  mediaDevices = new EventTarget() as EventTarget & MediaDevices;
  mediaDevices.getUserMedia = getUserMedia as unknown as MediaDevices["getUserMedia"];
  mediaDevices.enumerateDevices = vi
    .fn()
    .mockResolvedValue([USB_CAM, BUILTIN]) as unknown as MediaDevices["enumerateDevices"];
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: mediaDevices,
    configurable: true,
  });
}

describe("CameraPreview", () => {
  beforeEach(() => {
    getUserMedia = vi.fn();
    installMediaDevices();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("opens with an ideal facingMode so USB webcams are accepted", async () => {
    const { stream } = makeStream("usb-cam");
    getUserMedia.mockResolvedValue(stream);

    render(<CameraPreview onClose={vi.fn()} onCapture={vi.fn()} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const video = getUserMedia.mock.calls[0][0].video;
    // Regression: an exact facingMode requirement fails on USB cameras that
    // don't report one — this must remain `ideal`.
    expect(video.facingMode).toEqual({ ideal: "user" });
  });

  it("falls back to the default camera when the facingMode request is rejected", async () => {
    const { stream } = makeStream("usb-cam");
    getUserMedia
      .mockRejectedValueOnce(new DOMException("no facingMode", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    render(<CameraPreview onClose={vi.fn()} onCapture={vi.fn()} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia.mock.calls[1][0].video).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("camera-capture")).not.toBeDisabled(),
    );
  });

  it("switch camera opens the other device, not the one already streaming", async () => {
    const first = makeStream("usb-cam");
    const second = makeStream("builtin");
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);

    render(<CameraPreview onClose={vi.fn()} onCapture={vi.fn()} />);

    const switchButton = await screen.findByRole("button", { name: /switch camera/i });
    await waitFor(() => expect(switchButton).not.toBeDisabled());
    // The device selector must reflect the camera that actually opened.
    expect(screen.getByLabelText("Select camera device")).toHaveValue("usb-cam");

    fireEvent.click(switchButton);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia.mock.calls[1][0].video).toEqual({
      deviceId: { exact: "builtin" },
    });
  });

  it("restarts on a remaining camera when the active one is unplugged", async () => {
    const first = makeStream("usb-cam");
    const second = makeStream("builtin");
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    mediaDevices.enumerateDevices = vi
      .fn()
      .mockResolvedValue([BUILTIN]) as unknown as MediaDevices["enumerateDevices"];

    render(<CameraPreview onClose={vi.fn()} onCapture={vi.fn()} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    // Simulate the USB camera being unplugged: its track ends, then the
    // browser fires devicechange.
    first.track.readyState = "ended";
    await act(async () => {
      mediaDevices.dispatchEvent(new Event("devicechange"));
    });

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });
});
