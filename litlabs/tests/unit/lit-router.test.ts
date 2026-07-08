import { describe, it, expect } from "vitest";
import { routeFromText } from "@/lib/lit-router";

describe("routeFromText", () => {
  it("returns null when nothing matches", () => {
    expect(routeFromText("hello there, nothing to route")).toBeNull();
  });

  it("matches an explicit phrase before falling back to keywords", () => {
    const action = routeFromText("please take me to gallery now");
    expect(action).toEqual({
      type: "navigate",
      href: "/gallery",
      label: "Gallery",
    });
  });

  it("uses the phrase label, not the bare keyword, when a phrase matches", () => {
    const action = routeFromText("open image");
    expect(action).toEqual({
      type: "navigate",
      href: "/studio?tool=image",
      label: "Image Studio",
    });
  });

  it("falls back to the site-map keyword match", () => {
    const action = routeFromText("I love the wallet feature");
    expect(action).toEqual({
      type: "navigate",
      href: "/wallet",
      label: "wallet",
    });
  });

  it("is case-insensitive", () => {
    expect(routeFromText("GO TO SETTINGS")).toEqual({
      type: "navigate",
      href: "/settings",
      label: "Settings",
    });
  });

  it("requires whole-word keyword matches", () => {
    // "gamer" contains "game" but not as a whole word, so no keyword match.
    expect(routeFromText("gamer")).toBeNull();
  });

  it("maps keyword aliases to the same destination", () => {
    const picture = routeFromText("picture");
    const store = routeFromText("store");
    expect(picture).toMatchObject({ type: "navigate", href: "/studio?tool=image" });
    expect(store).toMatchObject({ type: "navigate", href: "/marketplace" });
  });
});
