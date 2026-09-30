import { describe, expect, it } from "vitest";
import { filterProjectScopedRecords } from "./project-scope";

describe("project-scoped Studio records", () => {
  it("keeps project A records out of project B", () => {
    const records = [
      { id: "a-1", projectId: "project-a" },
      { id: "b-1", projectId: "project-b" },
      { id: "library-1", projectId: null },
    ];

    expect(filterProjectScopedRecords(records, "project-a")).toEqual([
      { id: "a-1", projectId: "project-a" },
    ]);
    expect(filterProjectScopedRecords(records, "project-b")).toEqual([
      { id: "b-1", projectId: "project-b" },
    ]);
    expect(filterProjectScopedRecords(records, null)).toEqual([]);
  });
});
