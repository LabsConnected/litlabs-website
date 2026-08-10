import { describe, it, expect } from "vitest";
import {
  mapLegacyToolToDestination,
  destinationToLegacyTool,
  DESTINATION_LABELS,
  type StudioDestination,
} from "./studio-destinations";

describe("studio-destinations", () => {
  describe("mapLegacyToolToDestination", () => {
    it("maps home/chat to Studio/Work", () => {
      expect(mapLegacyToolToDestination("home")).toEqual({
        destination: "studio",
        legacyTool: "chat",
        mode: "work",
      });
      expect(mapLegacyToolToDestination("chat")).toEqual({
        destination: "studio",
        legacyTool: "chat",
        mode: "work",
      });
    });

    it("maps canvas to Studio/Files (Canvas surface)", () => {
      expect(mapLegacyToolToDestination("canvas").destination).toBe("studio");
      expect(mapLegacyToolToDestination("canvas").mode).toBe("files");
      expect(mapLegacyToolToDestination("canvas").legacyTool).toBe("canvas");
    });

    it("maps build to Studio/Work with legacyTool=build (Builder adapter, not ChatTool)", () => {
      const result = mapLegacyToolToDestination("build", "next build");
      expect(result.destination).toBe("studio");
      expect(result.mode).toBe("work");
      expect(result.legacyTool).toBe("build");
      expect(result.command).toBe("next build");
    });

    it("maps code to Studio/Code", () => {
      expect(mapLegacyToolToDestination("code").destination).toBe("studio");
      expect(mapLegacyToolToDestination("code").mode).toBe("code");
    });

    it("maps terminal to Studio/Work with drawer open on Terminal", () => {
      const result = mapLegacyToolToDestination("terminal", "ls -la");
      expect(result.destination).toBe("studio");
      expect(result.mode).toBe("work");
      expect(result.command).toBe("ls -la");
      expect(result.openDrawer).toBe("terminal");
    });

    it("maps workflows to Missions / Forge", () => {
      const result = mapLegacyToolToDestination("workflows");
      expect(result.destination).toBe("missions");
      expect(result.mode).toBe("forge");
    });

    it("maps image/video/audio to Create with correct modes", () => {
      expect(mapLegacyToolToDestination("image")).toEqual({
        destination: "create",
        legacyTool: "image",
        mode: "image",
      });
      expect(mapLegacyToolToDestination("video").mode).toBe("video");
      expect(mapLegacyToolToDestination("audio").mode).toBe("audio");
    });

    it("maps legacy color to Create/Image (color tool removed)", () => {
      expect(mapLegacyToolToDestination("color").destination).toBe("create");
      expect(mapLegacyToolToDestination("color").mode).toBe("image");
    });

    it("maps assets to Assets", () => {
      expect(mapLegacyToolToDestination("assets").destination).toBe("assets");
    });

    it("maps agents to Agents", () => {
      expect(mapLegacyToolToDestination("agents").destination).toBe("agents");
    });

    it("maps camera to Studio (capture action, not a destination)", () => {
      expect(mapLegacyToolToDestination("camera").destination).toBe("studio");
    });

    it("maps screen to Studio (capture action, not a destination)", () => {
      expect(mapLegacyToolToDestination("screen").destination).toBe("studio");
    });

    it("maps space to Create / Environment", () => {
      const result = mapLegacyToolToDestination("space");
      expect(result.destination).toBe("create");
      expect(result.mode).toBe("environment");
    });

    it("maps more tools to More with correct modes", () => {
      expect(mapLegacyToolToDestination("plugins").destination).toBe("more");
      expect(mapLegacyToolToDestination("plugins").mode).toBe("plugins");
      expect(mapLegacyToolToDestination("clibridge").destination).toBe("more");
    });

    it("maps pipeline (legacy) to Missions/Forge", () => {
      expect(mapLegacyToolToDestination("workflows").destination).toBe("missions");
      expect(mapLegacyToolToDestination("pipeline").destination).toBe("missions");
    });

    it("falls back to Studio/Work for unknown tools", () => {
      expect(mapLegacyToolToDestination("unknown").destination).toBe("studio");
      expect(mapLegacyToolToDestination(null).destination).toBe("studio");
      expect(mapLegacyToolToDestination("").destination).toBe("studio");
    });
  });

  describe("destinationToLegacyTool", () => {
    it("round-trips Studio destinations back to legacy tools", () => {
      expect(destinationToLegacyTool("studio", "work")).toBe("chat");
      expect(destinationToLegacyTool("studio", "code")).toBe("code");
      expect(destinationToLegacyTool("studio", "files")).toBe("canvas");
      expect(destinationToLegacyTool("studio", "preview")).toBe("code");
    });

    it("round-trips Create destinations back to legacy tools", () => {
      expect(destinationToLegacyTool("create", "image")).toBe("image");
      expect(destinationToLegacyTool("create", "video")).toBe("video");
      expect(destinationToLegacyTool("create", "audio")).toBe("audio");
      expect(destinationToLegacyTool("create", "music")).toBe("music");
      expect(destinationToLegacyTool("create", "environment")).toBe("space");
    });

    it("round-trips Assets and Agents", () => {
      expect(destinationToLegacyTool("assets")).toBe("assets");
      expect(destinationToLegacyTool("agents")).toBe("agents");
    });

    it("round-trips Missions destination to workflows", () => {
      expect(destinationToLegacyTool("missions")).toBe("workflows");
    });

    it("round-trips More destinations back to legacy tools", () => {
      expect(destinationToLegacyTool("more", "plugins")).toBe("plugins");
      expect(destinationToLegacyTool("more", "clibridge")).toBe("clibridge");
    });
  });

  describe("DESTINATION_LABELS", () => {
    it("provides labels for all 6 destinations", () => {
      const destinations: StudioDestination[] = ["studio", "create", "assets", "agents", "missions", "more"];
      destinations.forEach((d) => {
        expect(DESTINATION_LABELS[d]).toBeTruthy();
        expect(typeof DESTINATION_LABELS[d]).toBe("string");
      });
    });

    it("uses the exact required labels", () => {
      expect(DESTINATION_LABELS.studio).toBe("Studio");
      expect(DESTINATION_LABELS.create).toBe("Create");
      expect(DESTINATION_LABELS.assets).toBe("Assets");
      expect(DESTINATION_LABELS.agents).toBe("Agents");
      expect(DESTINATION_LABELS.missions).toBe("Missions");
      expect(DESTINATION_LABELS.more).toBe("More");
    });
  });
});
