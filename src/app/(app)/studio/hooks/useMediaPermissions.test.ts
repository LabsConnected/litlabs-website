import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaPermissions } from "./useMediaPermissions";

const fakeStream = { id: "stream-1" } as unknown as MediaStream;

let getUserMedia: ReturnType<typeof vi.fn>;

function installMediaDevices(overrides: Partial<MediaDevices> = {}) {
  const mediaDevices = new EventTarget() as EventTarget & MediaDevices;
  mediaDevices.getUserMedia = getUserMedia as unknown as MediaDevices["getUserMedia"];
  mediaDevices.enumerateDevices = vi
    .fn()
    .mockResolvedValue([]) as unknown as MediaDevices["enumerateDevices"];
  Object.assign(mediaDevices, overrides);
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: mediaDevices,
    configurable: true,
  });
  return mediaDevices;
}

describe("useMediaPermissions.requestVideo", () => {
  beforeEach(() => {
    getUserMedia = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("requests the camera with an ideal facingMode so USB webcams work", async () => {
    installMediaDevices();
    getUserMedia.mockResolvedValue(fakeStream);

    const { result } = renderHook(() => useMediaPermissions());
    let stream: MediaStream | null = null;
    await act(async () => {
      stream = await result.current.requestVideo("user");
    });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const video = getUserMedia.mock.calls[0][0].video;
    // A bare/exact facingMode throws OverconstrainedError on USB cameras that
    // don't report a facing mode — it must stay `ideal`.
    expect(video.facingMode).toEqual({ ideal: "user" });
  });

  it("falls back to the default camera when an exact deviceId is overconstrained", async () => {
    installMediaDevices();
    getUserMedia
      .mockRejectedValueOnce(new DOMException("bad deviceId", "OverconstrainedError"))
      .mockResolvedValueOnce(fakeStream);

    const { result } = renderHook(() => useMediaPermissions());
    let stream: MediaStream | null = null;
    await act(async () => {
      stream = await result.current.requestVideo("user", "stale-usb-device-id");
    });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0].video).toEqual({
      deviceId: { exact: "stale-usb-device-id" },
    });
    expect(getUserMedia.mock.calls[1][0].video).toBe(true);
    expect(result.current.lastError).toBeNull();
  });

  it("falls back when the requested camera was unplugged (NotFoundError)", async () => {
    installMediaDevices();
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
      .mockResolvedValueOnce(fakeStream);

    const { result } = renderHook(() => useMediaPermissions());
    let stream: MediaStream | null = null;
    await act(async () => {
      stream = await result.current.requestVideo("user", "unplugged-device");
    });

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not retry on permission denied", async () => {
    installMediaDevices();
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const { result } = renderHook(() => useMediaPermissions());
    let stream: MediaStream | null = null;
    await act(async () => {
      stream = await result.current.requestVideo("user");
    });

    expect(stream).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.lastError?.code).toBe("permission_denied");
    });
  });

  it("surfaces an error when no camera exists at all", async () => {
    installMediaDevices();
    getUserMedia.mockRejectedValue(new DOMException("none", "NotFoundError"));

    const { result } = renderHook(() => useMediaPermissions());
    let stream: MediaStream | null = null;
    await act(async () => {
      stream = await result.current.requestVideo("user");
    });

    expect(stream).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(result.current.lastError?.code).toBe("no_device");
    });
  });
});
