import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapLegacyToolToDestination, destinationToLegacyTool } from "./studio-destinations";

/**
 * Phase 1.1 integration tests for legacy routing and URL sync.
 * These verify the destination adapter produces correct state changes
 * and URL output — not just pure mapping functions, but the actual
 * behaviors required by the directive.
 */
describe("Phase 1.1 — Legacy routing integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Required legacy URL behaviors", () => {
    it("?tool=home → Studio Work conversation", () => {
      const r = mapLegacyToolToDestination("home");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("work");
      expect(r.legacyTool).toBe("chat");
      expect(r.openDrawer).toBeUndefined();
      expect(r.openInspector).toBeUndefined();
    });

    it("?tool=chat → Studio Work conversation", () => {
      const r = mapLegacyToolToDestination("chat");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("work");
      expect(r.legacyTool).toBe("chat");
    });

    it("?tool=canvas → Studio Files / Canvas surface (NOT Work)", () => {
      const r = mapLegacyToolToDestination("canvas");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("files");
      expect(r.mode).not.toBe("work");
    });

    it("?tool=code → Studio Code surface", () => {
      const r = mapLegacyToolToDestination("code");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("code");
    });

    it("?tool=build → Studio Work with legacyTool=build (Builder adapter, not ChatTool)", () => {
      const r = mapLegacyToolToDestination("build");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("work");
      expect(r.legacyTool).toBe("build");
      // The CommandStudio component uses legacyTool==="build" to render
      // BuilderTool instead of the conversation transcript.
    });

    it("?tool=terminal → Studio Work with drawer open on Terminal", () => {
      const r = mapLegacyToolToDestination("terminal");
      expect(r.destination).toBe("studio");
      expect(r.mode).toBe("work");
      expect(r.openDrawer).toBe("terminal");
    });

    it("?tool=workflows → More / Mission Forge", () => {
      const r = mapLegacyToolToDestination("workflows");
      expect(r.destination).toBe("more");
      expect(r.mode).toBe("workflows");
    });

    it("?tool=image → Create / Image", () => {
      const r = mapLegacyToolToDestination("image");
      expect(r.destination).toBe("create");
      expect(r.mode).toBe("image");
    });

    it("?tool=video → Create / Video", () => {
      const r = mapLegacyToolToDestination("video");
      expect(r.destination).toBe("create");
      expect(r.mode).toBe("video");
    });

    it("?tool=audio → Create / Audio", () => {
      const r = mapLegacyToolToDestination("audio");
      expect(r.destination).toBe("create");
      expect(r.mode).toBe("audio");
    });

    it("?tool=color → Create / Image (color tool removed, legacy redirect)", () => {
      const r = mapLegacyToolToDestination("color");
      expect(r.destination).toBe("create");
      expect(r.mode).toBe("image");
    });

    it("?tool=assets → Assets", () => {
      expect(mapLegacyToolToDestination("assets").destination).toBe("assets");
    });

    it("?tool=agents → Agents", () => {
      expect(mapLegacyToolToDestination("agents").destination).toBe("agents");
    });

    it("plugins/camera/screen/space/clibridge/workflows → More with matching mode", () => {
      expect(mapLegacyToolToDestination("plugins").destination).toBe("more");
      expect(mapLegacyToolToDestination("plugins").mode).toBe("plugins");
      expect(mapLegacyToolToDestination("camera").mode).toBe("camera");
      expect(mapLegacyToolToDestination("screen").mode).toBe("screen");
      expect(mapLegacyToolToDestination("space").mode).toBe("space");
      expect(mapLegacyToolToDestination("clibridge").mode).toBe("clibridge");
      expect(mapLegacyToolToDestination("workflows").mode).toBe("workflows");
    });
  });

  describe("Reverse URL synchronization (destination-specific)", () => {
    // The bug was: studioMode ?? createMode ?? moreMode always resolved
    // to studioMode ("work"), so Video wrote ?tool=image and More tools
    // wrote ?tool=plugins. The fix uses a destination-specific switch.
    it("Video selection writes ?tool=video (not ?tool=image)", () => {
      expect(destinationToLegacyTool("create", "video")).toBe("video");
      expect(destinationToLegacyTool("create", "video")).not.toBe("image");
    });

    it("Music selection writes ?tool=music", () => {
      expect(destinationToLegacyTool("create", "music")).toBe("music");
    });

    it("Studio/Work writes ?tool=chat", () => {
      expect(destinationToLegacyTool("studio", "work")).toBe("chat");
    });

    it("Studio/Files writes ?tool=canvas", () => {
      expect(destinationToLegacyTool("studio", "files")).toBe("canvas");
    });

    it("Studio/Code writes ?tool=code", () => {
      expect(destinationToLegacyTool("studio", "code")).toBe("code");
    });

    it("Studio/Preview writes ?tool=code (shares code workspace URL)", () => {
      expect(destinationToLegacyTool("studio", "preview")).toBe("code");
    });

    it("More/camera writes ?tool=camera (not ?tool=plugins)", () => {
      expect(destinationToLegacyTool("more", "camera")).toBe("camera");
      expect(destinationToLegacyTool("more", "camera")).not.toBe("plugins");
    });

    it("More/screen writes ?tool=screen", () => {
      expect(destinationToLegacyTool("more", "screen")).toBe("screen");
    });

    it("More/space writes ?tool=space", () => {
      expect(destinationToLegacyTool("more", "space")).toBe("space");
    });

    it("More/clibridge writes ?tool=clibridge", () => {
      expect(destinationToLegacyTool("more", "clibridge")).toBe("clibridge");
    });
  });

  describe("Drawer and inspector open flags", () => {
    it("terminal mapping opens drawer on terminal tab", () => {
      expect(mapLegacyToolToDestination("terminal").openDrawer).toBe("terminal");
    });

    it("workflows mapping goes to more destination", () => {
      expect(mapLegacyToolToDestination("workflows").destination).toBe("more");
    });

    it("chat mapping does NOT open drawer or inspector", () => {
      const r = mapLegacyToolToDestination("chat");
      expect(r.openDrawer).toBeUndefined();
      expect(r.openInspector).toBeUndefined();
    });

    it("build mapping does NOT open drawer or inspector", () => {
      const r = mapLegacyToolToDestination("build");
      expect(r.openDrawer).toBeUndefined();
      expect(r.openInspector).toBeUndefined();
    });
  });
});
