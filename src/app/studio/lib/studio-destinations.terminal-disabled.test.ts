import { describe, it, expect, vi, afterEach } from "vitest";
import { mapLegacyToolToDestination } from "@/app/studio/lib/studio-destinations";

describe("studio-destinations — terminal disabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects terminal to studio chat when disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "false");
    const result = mapLegacyToolToDestination("terminal");
    expect(result.destination).toBe("studio");
    expect(result.legacyTool).toBe("chat");
    expect(result.openDrawer).toBeUndefined();
  });

  it("opens terminal drawer when enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
    const result = mapLegacyToolToDestination("terminal");
    expect(result.destination).toBe("studio");
    expect(result.legacyTool).toBe("terminal");
    expect(result.openDrawer).toBe("terminal");
  });
});
