// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dispatchMobileCommand, MOBILE_COMMAND_NAMES } from "../terminal-server/mobile-commands";

describe("mobile-commands", () => {
  describe("dispatchMobileCommand", () => {
    it("dispatches 'litt mobile:check' to the check command", () => {
      const cmd = dispatchMobileCommand("litt mobile:check");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("mobile:check");
      expect(cmd!.shellCommand).toContain("tsc --noEmit");
      expect(cmd!.shellCommand).toContain("expo export");
    });

    it("dispatches 'litt mobile:start' to the start command", () => {
      const cmd = dispatchMobileCommand("litt mobile:start");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("mobile:start");
      expect(cmd!.shellCommand).toContain("expo start");
    });

    it("dispatches 'litt mobile:build' to the EAS build command", () => {
      const cmd = dispatchMobileCommand("litt mobile:build");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("mobile:build");
      expect(cmd!.shellCommand).toContain("eas build");
      expect(cmd!.shellCommand).toContain("android");
    });

    it("dispatches 'litt mobile:doctor' to expo doctor", () => {
      const cmd = dispatchMobileCommand("litt mobile:doctor");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("mobile:doctor");
      expect(cmd!.shellCommand).toContain("expo doctor");
    });

    it("returns null for non-mobile litt commands", () => {
      expect(dispatchMobileCommand("litt scan")).toBeNull();
      expect(dispatchMobileCommand("litt build")).toBeNull();
      expect(dispatchMobileCommand("litt fix")).toBeNull();
    });

    it("returns null for non-litt input", () => {
      expect(dispatchMobileCommand("git status")).toBeNull();
      expect(dispatchMobileCommand("pnpm build")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(dispatchMobileCommand("")).toBeNull();
      expect(dispatchMobileCommand("litt")).toBeNull();
    });

    it("is case-insensitive on the subcommand", () => {
      const cmd = dispatchMobileCommand("litt Mobile:Check");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("mobile:check");
    });

    it("all shell commands cd into the mobile package directory", () => {
      for (const name of MOBILE_COMMAND_NAMES) {
        const cmd = dispatchMobileCommand(`litt ${name}`);
        expect(cmd).not.toBeNull();
        expect(cmd!.shellCommand).toContain("packages/litt-companion");
      }
    });
  });

  describe("MOBILE_COMMAND_NAMES", () => {
    it("lists all 4 mobile commands", () => {
      expect(MOBILE_COMMAND_NAMES).toHaveLength(4);
      expect(MOBILE_COMMAND_NAMES).toContain("mobile:check");
      expect(MOBILE_COMMAND_NAMES).toContain("mobile:start");
      expect(MOBILE_COMMAND_NAMES).toContain("mobile:build");
      expect(MOBILE_COMMAND_NAMES).toContain("mobile:doctor");
    });
  });
});
