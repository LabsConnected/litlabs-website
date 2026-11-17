import { describe, expect, it } from "vitest";
import { parseBorderWidth, parseBoxShorthand } from "./ElementInspectorPanel";

/**
 * Box-model parsing (Kimi wiring item 14): the inspector diagram is
 * parsed from the margin/padding/border SHORTHANDS the preview bridge
 * captures from getComputedStyle. The parser must expand 1–4 values
 * by the CSS rules and refuse anything it cannot read honestly.
 */
describe("parseBoxShorthand", () => {
  it("expands one value to all sides", () => {
    expect(parseBoxShorthand("8px")).toEqual({ top: "8px", right: "8px", bottom: "8px", left: "8px" });
  });

  it("expands two values as vertical / horizontal", () => {
    expect(parseBoxShorthand("8px 16px")).toEqual({ top: "8px", right: "16px", bottom: "8px", left: "16px" });
  });

  it("expands three values as top / horizontal / bottom", () => {
    expect(parseBoxShorthand("1px 2px 3px")).toEqual({ top: "1px", right: "2px", bottom: "3px", left: "2px" });
  });

  it("expands four values clockwise from top", () => {
    expect(parseBoxShorthand("1px 2px 3px 4px")).toEqual({ top: "1px", right: "2px", bottom: "3px", left: "4px" });
  });

  it("returns null for missing or unreadable values", () => {
    expect(parseBoxShorthand(undefined)).toBeNull();
    expect(parseBoxShorthand("")).toBeNull();
    expect(parseBoxShorthand("1px 2px 3px 4px 5px")).toBeNull();
  });
});

describe("parseBorderWidth", () => {
  it("prefers a captured border-width", () => {
    expect(parseBorderWidth({ "border-width": "2px", border: "1px solid red" })).toBe("2px");
  });

  it("extracts the width token from the border shorthand", () => {
    expect(parseBorderWidth({ border: "1px solid rgb(242, 244, 243)" })).toBe("1px");
    expect(parseBorderWidth({ border: "0px none rgb(0, 0, 0)" })).toBe("0px");
  });

  it("returns null when no width is captured", () => {
    expect(parseBorderWidth({})).toBeNull();
    expect(parseBorderWidth({ border: "none" })).toBeNull();
  });
});
