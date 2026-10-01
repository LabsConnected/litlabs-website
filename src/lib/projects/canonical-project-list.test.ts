import { describe, expect, it } from "vitest";
import {
  mergeCanonicalProjectList,
  studioProjectHref,
} from "./canonical-project-list";

describe("mergeCanonicalProjectList", () => {
  it("merges studio + legacy rows and de-dupes by id", () => {
    const merged = mergeCanonicalProjectList({
      projects: [
        { id: "a", name: "Coffee cart", runtimeStatus: "ready" },
      ],
      legacyOnly: [
        { id: "a", name: "duplicate" },
        { id: "b", name: "Legacy repo" },
      ],
    });
    expect(merged.map((p) => p.id)).toEqual(["a", "b"]);
    expect(merged[0].name).toBe("Coffee cart");
  });

  it("returns [] for missing or malformed payloads", () => {
    expect(mergeCanonicalProjectList(null)).toEqual([]);
    expect(mergeCanonicalProjectList({})).toEqual([]);
    expect(mergeCanonicalProjectList({ projects: undefined })).toEqual([]);
  });
});

describe("studioProjectHref", () => {
  it("always carries the project id (blank first-run projects included)", () => {
    expect(studioProjectHref("d7758a48-0479-4283-b578-d3b86c3328c4")).toBe(
      "/studio?project=d7758a48-0479-4283-b578-d3b86c3328c4",
    );
  });
});
