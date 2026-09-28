import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_ENTRY,
  LITT_ENTRY_POINTS,
  defaultMobileEntry,
  isLittAppEnabled,
  resolveLittAppAccess,
} from "./entry-points";

describe("LiTT entry points", () => {
  it("keeps Studio as the mobile and PWA default", () => {
    expect(DEFAULT_MOBILE_ENTRY).toBe("studio");
    expect(defaultMobileEntry()).toEqual(LITT_ENTRY_POINTS.studio);
    expect(LITT_ENTRY_POINTS.app.path).toBe("/app");
    expect(LITT_ENTRY_POINTS.studio.path).toBe("/studio");
    expect(LITT_ENTRY_POINTS.app.role).toBe("consumer");
    expect(LITT_ENTRY_POINTS.studio.role).toBe("advanced");
  });

  it("does not flip the manifest or the chat/litt redirects", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as { start_url: string };
    expect(manifest.start_url).toBe("/");

    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('source: "/chat", destination: "/studio?tool=chat"');
    expect(config).toContain('source: "/litt", destination: "/studio?tool=chat"');
    expect(config).not.toContain('"/app"');
  });

  it("keeps the app flag off unless it is explicitly enabled", () => {
    expect(isLittAppEnabled({})).toBe(false);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "" })).toBe(false);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "false" })).toBe(false);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "0" })).toBe(false);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "true" })).toBe(true);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: " TRUE " })).toBe(true);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "1" })).toBe(true);
    expect(isLittAppEnabled({ NEXT_PUBLIC_LITT_APP_ENABLED: "on" })).toBe(true);
  });

  it("404s when the flag is off and requires sign-in when it is on", () => {
    expect(resolveLittAppAccess(false, null)).toBe("not_found");
    expect(resolveLittAppAccess(false, "user_1")).toBe("not_found");
    expect(resolveLittAppAccess(true, null)).toBe("sign_in");
    expect(resolveLittAppAccess(true, undefined)).toBe("sign_in");
    expect(resolveLittAppAccess(true, "user_1")).toBe("allow");
  });
});
