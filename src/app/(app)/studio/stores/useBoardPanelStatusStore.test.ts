import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_PANEL_STATUS_COLORS,
  useBoardPanelStatusStore,
} from "./useBoardPanelStatusStore";

describe("useBoardPanelStatusStore (Kimi wiring item 2)", () => {
  beforeEach(() => {
    useBoardPanelStatusStore.setState({ statuses: {} });
  });

  it("publishes, replaces, and clears a panel's own status", () => {
    const { setPanelStatus } = useBoardPanelStatusStore.getState();
    setPanelStatus("preview", { tone: "working", label: "Preparing preview…", pulse: true });
    expect(useBoardPanelStatusStore.getState().statuses.preview).toEqual({
      tone: "working",
      label: "Preparing preview…",
      pulse: true,
    });
    setPanelStatus("preview", { tone: "ready", label: "Preview ready" });
    expect(useBoardPanelStatusStore.getState().statuses.preview?.tone).toBe("ready");
    setPanelStatus("preview", null);
    expect(useBoardPanelStatusStore.getState().statuses.preview).toBeUndefined();
  });

  it("keeps panels independent — no blended aggregate", () => {
    const { setPanelStatus } = useBoardPanelStatusStore.getState();
    setPanelStatus("preview", { tone: "ready", label: "Preview ready" });
    setPanelStatus("health", { tone: "error", label: "1 check failing" });
    const { statuses } = useBoardPanelStatusStore.getState();
    expect(statuses.preview?.tone).toBe("ready");
    expect(statuses.health?.tone).toBe("error");
    expect(statuses.deploy).toBeUndefined();
  });

  it("no-ops on an identical republication (no render churn)", () => {
    const { setPanelStatus } = useBoardPanelStatusStore.getState();
    setPanelStatus("terminal", { tone: "ready", label: "Terminal connected" });
    const before = useBoardPanelStatusStore.getState().statuses;
    setPanelStatus("terminal", { tone: "ready", label: "Terminal connected" });
    expect(useBoardPanelStatusStore.getState().statuses).toBe(before);
  });

  it("maps every tone to a dot color", () => {
    expect(BOARD_PANEL_STATUS_COLORS.ready).toBe("#48EE38");
    expect(BOARD_PANEL_STATUS_COLORS.live).toBe("#48EE38");
    expect(BOARD_PANEL_STATUS_COLORS.working).toBe("#e3b341");
    expect(BOARD_PANEL_STATUS_COLORS.error).toBe("#EF4444");
    expect(BOARD_PANEL_STATUS_COLORS.idle).toBe("#6b7280");
  });
});
