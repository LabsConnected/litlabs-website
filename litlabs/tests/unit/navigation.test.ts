import { describe, it, expect } from "vitest";
import { isActive, flattenNav, NAV_GROUPS } from "@/lib/navigation";

const params = (query = "") => new URLSearchParams(query);

describe("isActive", () => {
  it("returns false when href is undefined", () => {
    expect(isActive("/anything", params(), undefined)).toBe(false);
  });

  it("matches an appId against the dashboard app query param", () => {
    expect(isActive("/dashboard", params("app=notes"), "/whatever", "notes")).toBe(true);
    expect(isActive("/dashboard", params("app=other"), "/whatever", "notes")).toBe(false);
    expect(isActive("/settings", params("app=notes"), "/whatever", "notes")).toBe(false);
  });

  it("matches the bare dashboard route only when no app param is present", () => {
    expect(isActive("/dashboard", params(), "/dashboard")).toBe(true);
    expect(isActive("/dashboard", params("app=notes"), "/dashboard")).toBe(false);
  });

  it("matches when all query params in the href are present", () => {
    expect(isActive("/studio", params("tool=image"), "/studio?tool=image")).toBe(true);
    expect(isActive("/studio", params("tool=video"), "/studio?tool=image")).toBe(false);
    expect(isActive("/other", params("tool=image"), "/studio?tool=image")).toBe(false);
  });

  it("falls back to a startsWith match on the path", () => {
    expect(isActive("/gallery/123", params(), "/gallery")).toBe(true);
    expect(isActive("/profile", params(), "/gallery")).toBe(false);
  });

  it("returns false when pathname is null", () => {
    expect(isActive(null, params(), "/gallery")).toBe(false);
  });
});

describe("flattenNav", () => {
  const flat = flattenNav();

  it("returns a non-empty flat list of items with label/href/icon", () => {
    expect(flat.length).toBeGreaterThan(0);
    for (const item of flat) {
      expect(typeof item.label).toBe("string");
      expect(typeof item.href).toBe("string");
      expect(item.href.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });

  it("includes items nested as children of groups", () => {
    const childHrefs = NAV_GROUPS.flatMap((g) =>
      g.items.flatMap((i) => i.children?.map((c) => c.href) ?? []),
    ).filter((h): h is string => Boolean(h));

    for (const href of childHrefs) {
      expect(flat.some((f) => f.href === href)).toBe(true);
    }
  });

  it("only includes entries that have an href", () => {
    expect(flat.every((f) => Boolean(f.href))).toBe(true);
  });
});
