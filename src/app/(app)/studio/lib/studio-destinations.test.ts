import { describe, it, expect } from "vitest";
import {
  mapLegacyToolToDestination,
  destinationToLegacyTool,
  DESTINATION_LABELS,
  type StudioDestination,
  type WorkspaceStage,
  type CreatorKind,
  workspaceStageToMode,
  modeToWorkspaceStage,
  CREATOR_KIND_LABELS,
} from "./studio-destinations";

describe("studio-destinations", () => {
  describe("mapLegacyToolToDestination", () => {
    it("maps home/chat to Studio/Work", () => {
      expect(mapLegacyToolToDestination("home")).toEqual({
        destination: "studio",
        legacyTool: "chat",
        mode: "work",
        littMode: "auto",
      });
      expect(mapLegacyToolToDestination("chat")).toEqual({
        destination: "studio",
        legacyTool: "chat",
        mode: "work",
        littMode: "auto",
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

    it("maps preview to Studio/Preview", () => {
      expect(mapLegacyToolToDestination("preview").destination).toBe("studio");
      expect(mapLegacyToolToDestination("preview").mode).toBe("preview");
      expect(mapLegacyToolToDestination("preview").legacyTool).toBe("preview");
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

    it("maps image/video/audio to Studio with LiTT modes (canonical chat surface)", () => {
      expect(mapLegacyToolToDestination("image")).toEqual({
        destination: "studio",
        legacyTool: "chat",
        mode: "work",
        littMode: "image",
      });
      expect(mapLegacyToolToDestination("video").littMode).toBe("video");
      expect(mapLegacyToolToDestination("audio").littMode).toBe("music");
    });

    it("maps legacy color to Studio/Image LiTT mode (color tool removed)", () => {
      expect(mapLegacyToolToDestination("color").destination).toBe("studio");
      expect(mapLegacyToolToDestination("color").littMode).toBe("image");
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

    it("maps space to Studio / Work (skybox is a LiTT capability)", () => {
      const result = mapLegacyToolToDestination("space");
      expect(result.destination).toBe("studio");
      expect(result.mode).toBe("work");
    });

    it("maps game to Studio / Work (routing slot, no visible tab yet)", () => {
      const result = mapLegacyToolToDestination("game");
      expect(result.destination).toBe("studio");
      expect(result.legacyTool).toBe("chat");
      expect(result.mode).toBe("work");
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
      expect(destinationToLegacyTool("studio", "preview")).toBe("preview");
    });

    it("round-trips Create destinations back to legacy tools", () => {
      expect(destinationToLegacyTool("create", "image")).toBe("image");
      expect(destinationToLegacyTool("create", "video")).toBe("video");
      expect(destinationToLegacyTool("create", "audio")).toBe("audio");
      expect(destinationToLegacyTool("create", "music")).toBe("music");
      expect(destinationToLegacyTool("create", "environment")).toBe("space");
      expect(destinationToLegacyTool("create", "game")).toBe("game");
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

  describe("WorkspaceStage", () => {
    it("maps plan to work", () => {
      expect(workspaceStageToMode("plan")).toBe("work");
    });

    it("maps canvas to files", () => {
      expect(workspaceStageToMode("canvas")).toBe("files");
    });

    it("maps code to code", () => {
      expect(workspaceStageToMode("code")).toBe("code");
    });

    it("maps preview to preview", () => {
      expect(workspaceStageToMode("preview")).toBe("preview");
    });

    it("reverse-maps work to plan", () => {
      expect(modeToWorkspaceStage("work")).toBe("plan");
    });

    it("reverse-maps files to canvas", () => {
      expect(modeToWorkspaceStage("files")).toBe("canvas");
    });

    it("reverse-maps code to code", () => {
      expect(modeToWorkspaceStage("code")).toBe("code");
    });

    it("reverse-maps preview to preview", () => {
      expect(modeToWorkspaceStage("preview")).toBe("preview");
    });

    it("returns null for design (design is a creator, not a stage)", () => {
      expect(modeToWorkspaceStage("design")).toBeNull();
    });
  });

  describe("CreatorKind", () => {
    it("includes exactly the seven canonical creators", () => {
      const expectedKinds: CreatorKind[] = [
        "image",
        "video",
        "music",
        "audio",
        "design",
        "game",
        "environment",
      ];
      expectedKinds.forEach((kind) => {
        expect(CREATOR_KIND_LABELS[kind]).toBeTruthy();
      });
      expect(Object.keys(CREATOR_KIND_LABELS)).toHaveLength(7);
    });

    it("labels environment as 360°", () => {
      expect(CREATOR_KIND_LABELS.environment).toBe("360°");
    });

    it("labels design as Design", () => {
      expect(CREATOR_KIND_LABELS.design).toBe("Design");
    });

    it("labels game as Game", () => {
      expect(CREATOR_KIND_LABELS.game).toBe("Game");
    });
  });
});
